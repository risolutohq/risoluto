#!/usr/bin/env node
/**
 * risoluto-researcher: bulk-capture X/Twitter bookmarks into research/targets/<slug>/.
 *
 * Harvests every bookmark via `twitter-cli`, downloads all attached media, extracts
 * references (links / quoted tweets / @mentions) into a discovery queue, optionally
 * fetches and engagement-ranks the most useful replies, then writes one schema-valid
 * source file per bookmark by delegating to research.mjs (the already-validated writer).
 *
 * Decisions baked in (per the X-capture design):
 *   - comments: fetched ONLY for high-signal bookmarks (metrics.replies >= --comments-min-replies)
 *   - media:    ALL types downloaded (photo + video + animated_gif)
 *   - discover: every reference becomes a follow-on capture candidate (discovery-queue.md)
 *
 * Usage:
 *   node skills/risoluto-researcher/scripts/x-bookmarks.mjs \
 *     [--max 100] [--limit 0] [--comments-min-replies 5] [--comments-top 5] \
 *     [--no-media] [--force] [--dry-run] [--from-json <bookmarks.json>] [--target-slug x-bookmarks]
 *
 * --from-json reads a saved bookmarks envelope instead of calling twitter-cli — used to
 * resume a harvest and to test the transforms without browser-cookie auth.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const TARGETS_DIR = path.join(RESEARCH_DIR, "targets");
const RESEARCH_SCRIPT = path.join(SCRIPT_DIR, "research.mjs");

const TARGET_DESCRIPTION =
  "Captured X/Twitter bookmarks — a staging intake target. High-value items are promoted " +
  "to their own targets via discovery-queue.md; the rest stay here as raw source material.";

// Engagement weights mirror twitter-cli's filter.py DEFAULT_WEIGHTS so "useful" means the
// same thing on both sides of the seam.
const REPLY_WEIGHTS = { likes: 1.0, retweets: 3.0, replies: 2.0, bookmarks: 5.0, viewsLog: 0.5 };
const NOISE_MIN_CHARS = 15; // a reply with <15 chars of real text is noise, not signal

// ---------------------------------------------------------------------------
// Pure transforms (exported for fixture testing — no I/O, no network)
// ---------------------------------------------------------------------------

/**
 * Unwrap twitter-cli's `{ ok, data, pagination }` envelope.
 * Accepts a raw JSON string or a parsed object; tolerates a bare array.
 * @param {string | object} rawOrObj
 * @returns {{ data: object[], nextCursor: string | null }}
 */
export function parseEnvelope(rawOrObj) {
  const payload = typeof rawOrObj === "string" ? JSON.parse(rawOrObj) : rawOrObj;
  if (Array.isArray(payload)) return { data: payload, nextCursor: null };
  if (payload && payload.ok === false) {
    const err = payload.error || {};
    throw new Error(`twitter-cli error: ${err.code || "unknown"} — ${err.message || "no message"}`);
  }
  const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
  const nextCursor = payload?.pagination?.nextCursor ?? null;
  return { data, nextCursor };
}

/** @param {object} tweet @returns {string} stable, slug-safe source id */
export function deriveSourceSlug(tweet) {
  return `tweet-${String(tweet.id).replace(/[^a-z0-9]/gi, "")}`;
}

/** Canonical tweet URL from author + id. @param {object} tweet @returns {string} */
export function tweetUrl(tweet) {
  const handle = tweet.author?.screenName || "i";
  return `https://x.com/${handle}/status/${tweet.id}`;
}

/** Weighted engagement score — mirrors filter.py score_tweet. @param {object} m metrics */
export function scoreReply(m) {
  const met = m || {};
  return (
    REPLY_WEIGHTS.likes * (met.likes || 0) +
    REPLY_WEIGHTS.retweets * (met.retweets || 0) +
    REPLY_WEIGHTS.replies * (met.replies || 0) +
    REPLY_WEIGHTS.bookmarks * (met.bookmarks || 0) +
    REPLY_WEIGHTS.viewsLog * Math.log10(Math.max(met.views || 0, 1))
  );
}

/**
 * A reply is noise if, after stripping mentions / links / emoji / punctuation, it carries
 * fewer than NOISE_MIN_CHARS of real text — or if it is a promoted/ad reply.
 * @param {object} reply
 * @returns {boolean}
 */
export function isNoiseReply(reply) {
  if (reply.isPromoted) return true;
  const cleaned = String(reply.text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@\w+/g, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
  return cleaned.length < NOISE_MIN_CHARS;
}

/**
 * Is this item an actual reply to the root author, not a recommended/related tweet? A
 * `twitter tweet` payload mixes real replies with "discover more" content; genuine replies
 * address the author by handle. With no handle to match against, keep it (can't tell).
 * @param {string} text
 * @param {string} rootHandle  lowercased author handle of the root tweet
 * @returns {boolean}
 */
export function isReplyTo(text, rootHandle) {
  if (!rootHandle) return true;
  return new RegExp(`@${rootHandle}(?![a-z0-9_])`, "i").test(String(text || ""));
}

/**
 * Rank replies by engagement, drop noise + non-replies, keep the top N. A `twitter tweet`
 * payload contains the root tweet AND recommended tweets alongside the real replies — both
 * are filtered out (recommendations would otherwise dominate by raw engagement) so only
 * genuine replies, which @-mention the root author, get ranked.
 * @param {object[]} items  data from `twitter tweet <id>` (root + replies + recommendations)
 * @param {object} root     the root tweet — supplies its id and author handle
 * @param {number} topN
 * @returns {Array<{ author: string, score: number, text: string }>}
 */
export function rankComments(items, root, topN) {
  const rootId = String(root?.id ?? "");
  const rootHandle = (root?.author?.screenName || "").toLowerCase();
  return (items || [])
    .filter((t) => String(t.id) !== rootId)
    .filter((t) => isReplyTo(t.text, rootHandle))
    .filter((t) => !isNoiseReply(t))
    .map((t) => ({
      author: t.author?.screenName || "unknown",
      score: Math.round(scoreReply(t.metrics) * 10) / 10,
      text: String(t.text || "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/**
 * Split a `twitter tweet <url>` payload into the root tweet and its replies. The root is the
 * item whose id matches the URL's status id (falling back to the first item). Single-tweet
 * capture uses this because the replies arrive in the same call — no separate fetch needed.
 * @param {object[]} items
 * @param {string} url
 * @returns {{ root: object | null, replies: object[] }}
 */
export function splitRootAndReplies(items, url) {
  const list = Array.isArray(items) ? items : [];
  const statusId = (/status\/(\d+)/.exec(url || "") || [])[1] || null;
  const root = (statusId && list.find((t) => String(t.id) === statusId)) || list[0] || null;
  const replies = root ? list.filter((t) => String(t.id) !== String(root.id)) : [];
  return { root, replies };
}

/**
 * Extract every follow-on reference from a tweet: external links, the quoted tweet, and
 * @mentions in the body. These feed the discovery queue.
 * @param {object} tweet
 * @returns {{ urls: string[], quoted: object | null, mentions: string[] }}
 */
export function extractReferences(tweet) {
  const self = (tweet.author?.screenName || "").toLowerCase();
  const mentions = [...String(tweet.text || "").matchAll(/@(\w{1,15})/g)]
    .map((m) => m[1])
    .filter((h) => h.toLowerCase() !== self); // the author mentioning themselves is not a discovery target
  return {
    urls: Array.isArray(tweet.urls) ? [...new Set(tweet.urls)] : [],
    quoted: tweet.quotedTweet
      ? { screenName: tweet.quotedTweet.author?.screenName || "", text: tweet.quotedTweet.text || "" }
      : null,
    mentions: [...new Set(mentions)],
  };
}

/** Map a reference URL to a research source-type so the queue suggests the right capture path. */
export function classifyDiscovery(url) {
  const u = url.toLowerCase();
  if (/github\.com/.test(u)) return "repo";
  if (/youtube\.com|youtu\.be/.test(u)) return "video";
  if (/arxiv\.org/.test(u)) return "paper";
  if (/reddit\.com/.test(u)) return "reddit";
  if (/x\.com|twitter\.com/.test(u)) return "x";
  return "article";
}

/** File extension for a media item, from its URL or its declared type. */
export function mediaExt(media) {
  const fmt = /[?&]format=(\w+)/.exec(media.url || "");
  if (fmt) return fmt[1];
  const pathExt = /\.(\w{3,4})(?:\?|$)/.exec(media.url || "");
  if (pathExt) return pathExt[1];
  return media.type === "photo" ? "jpg" : "mp4";
}

/**
 * Compose the source body markdown for one bookmark. mediaPaths are relative to the source
 * file (e.g. "../media/<id>/0.jpg"). The "Why this matters" section is left for the agent's
 * judgment layer — the script captures facts, the agent extracts candidate features.
 */
export function composeBody(tweet, mediaPaths, refs, comments) {
  const m = tweet.metrics || {};
  const lines = [
    `> Bookmarked X post by @${tweet.author?.screenName || "?"}` +
      `${tweet.author?.verified ? " ✓" : ""} — posted ${tweet.createdAtISO || tweet.createdAt || "?"}`,
    "",
    "## Tweet",
    "",
    String(tweet.text || "").trim() || "_(no text)_",
    "",
    `**Engagement:** ${m.likes || 0} likes · ${m.retweets || 0} RT · ${m.replies || 0} replies · ` +
      `${m.bookmarks || 0} bookmarks · ${m.views || 0} views`,
  ];

  if (mediaPaths.length) {
    lines.push("", "## Media", "");
    mediaPaths.forEach((p) => lines.push(`- ![media](${p})`));
  }

  const hasRefs = refs.urls.length || refs.quoted || refs.mentions.length;
  if (hasRefs) {
    lines.push("", "## References", "");
    refs.urls.forEach((u) => lines.push(`- ${u}  _(→ discovery: ${classifyDiscovery(u)})_`));
    if (refs.quoted) lines.push(`- Quoted @${refs.quoted.screenName}: "${refs.quoted.text}"`);
    if (refs.mentions.length) lines.push(`- Mentions: ${refs.mentions.map((h) => `@${h}`).join(" ")}`);
  }

  if (comments.length) {
    lines.push("", "## Useful replies", "", "_Top replies by engagement, noise filtered._", "");
    comments.forEach((c) => lines.push(`- **@${c.author}** _(score ${c.score})_ — ${c.text}`));
  }

  lines.push(
    "",
    "## Why this matters for Risoluto",
    "",
    "TODO — agent fills: which AFK job / capability does this bookmark surface? Promote any",
    "follow-on references from the discovery queue to their own `/risoluto-researcher` runs.",
    "",
  );
  return lines.join("\n");
}

/** First-line, slug-safe title for the source H1. */
export function deriveTitle(tweet) {
  const text = String(tweet.text || "")
    .replace(/\s+/g, " ")
    .trim();
  const snippet = text.length > 70 ? `${text.slice(0, 67)}...` : text || "(no text)";
  return `@${tweet.author?.screenName || "?"}: ${snippet}`;
}

// ---------------------------------------------------------------------------
// I/O orchestration (not exported)
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`x-bookmarks: ${msg}`);
  process.exit(1);
}

function parseArgs(raw) {
  const args = {
    max: 100,
    limit: 0,
    commentsMinReplies: 5,
    commentsTop: 5,
    noMedia: false,
    force: false,
    dryRun: false,
    fromJson: "",
    tweet: "",
    targetSlug: "x-bookmarks",
  };
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case "--max":
        args.max = Number(raw[++i]);
        break;
      case "--limit":
        args.limit = Number(raw[++i]);
        break;
      case "--comments-min-replies":
        args.commentsMinReplies = Number(raw[++i]);
        break;
      case "--comments-top":
        args.commentsTop = Number(raw[++i]);
        break;
      case "--no-media":
        args.noMedia = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--from-json":
        args.fromJson = raw[++i] ?? "";
        break;
      case "--tweet":
        args.tweet = raw[++i] ?? "";
        break;
      case "--target-slug":
        args.targetSlug = raw[++i] ?? "";
        break;
      default:
        fail(`unknown flag: ${raw[i]}`);
    }
  }
  return args;
}

function checkPreconditions(args) {
  if (!existsSync(path.join(REPO_ROOT, "package.json")) || !existsSync(path.join(REPO_ROOT, ".gitmodules"))) {
    fail(`run from the repo root — expected package.json + .gitmodules at ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) {
    fail("research/ submodule is not initialised — run `git submodule update --init research`");
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".schemas"))) {
    fail("research/.schemas/ missing — Phase 1.1 schemas are not present");
  }
  if (!args.fromJson) {
    try {
      execFileSync("twitter", ["--help"], { stdio: "ignore" });
    } catch {
      fail(
        "twitter-cli not found — `uv tool install twitter-cli` and authenticate (cookies / TWITTER_AUTH_TOKEN+TWITTER_CT0)",
      );
    }
  }
}

function twitter(cliArgs) {
  return execFileSync("twitter", cliArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function harvestBookmarks(args) {
  if (args.fromJson) {
    const { data } = parseEnvelope(readFileSync(args.fromJson, "utf8"));
    return args.limit > 0 ? data.slice(0, args.limit) : data;
  }
  const all = [];
  let cursor = null;
  let pages = 0;
  do {
    const cliArgs = ["bookmarks", "--json", "--full-text", "--max", String(args.max)];
    if (cursor) cliArgs.push("--cursor", cursor);
    const { data, nextCursor } = parseEnvelope(twitter(cliArgs));
    all.push(...data);
    cursor = nextCursor;
    pages += 1;
  } while (cursor && (args.limit === 0 || all.length < args.limit));
  console.error(`x-bookmarks: harvested ${all.length} bookmarks across ${pages} page(s)`);
  return args.limit > 0 ? all.slice(0, args.limit) : all;
}

function loadSingleTweet(args) {
  const { data } = parseEnvelope(twitter(["tweet", args.tweet, "--json", "--full-text"]));
  const { root, replies } = splitRootAndReplies(data, args.tweet);
  if (!root) fail(`no tweet returned for ${args.tweet}`);
  console.error(
    `x-bookmarks: single tweet ${root.id} by @${root.author?.screenName || "?"} (${replies.length} replies in payload)`,
  );
  return { root, replies };
}

function downloadMedia(tweet, slug, targetSlug, dryRun) {
  const mediaList = Array.isArray(tweet.media) ? tweet.media : [];
  if (!mediaList.length) return [];
  const destDir = path.join(TARGETS_DIR, targetSlug, "media", slug);
  const rel = [];
  mediaList.forEach((media, i) => {
    const ext = mediaExt(media);
    const fileName = `${i}.${ext}`;
    rel.push(`../media/${slug}/${fileName}`);
    if (dryRun) return;
    mkdirSync(destDir, { recursive: true });
    try {
      execFileSync("curl", ["-sL", "--fail", "-o", path.join(destDir, fileName), media.url], { stdio: "ignore" });
    } catch {
      console.error(`x-bookmarks: media download failed for ${slug} #${i} (${media.url})`);
    }
  });
  return rel;
}

function fetchComments(tweet, args) {
  const replies = tweet.metrics?.replies || 0;
  if (args.dryRun || args.fromJson || replies < args.commentsMinReplies) return [];
  try {
    const { data } = parseEnvelope(twitter(["tweet", String(tweet.id), "--json", "--full-text"]));
    return rankComments(data, tweet, args.commentsTop);
  } catch (error) {
    console.error(`x-bookmarks: comment fetch failed for ${tweet.id} — ${error.message}`);
    return [];
  }
}

function writeSource(tweet, slug, body, args) {
  const bodyFile = path.join(tmpdir(), `x-bm-${slug}.md`);
  writeFileSync(bodyFile, body);
  const cliArgs = [
    RESEARCH_SCRIPT,
    "--url",
    tweetUrl(tweet),
    "--target-slug",
    args.targetSlug,
    "--category",
    "reference",
    "--source-type",
    "x",
    "--source-slug",
    slug,
    "--title",
    deriveTitle(tweet),
    "--description",
    TARGET_DESCRIPTION,
    "--body-file",
    bodyFile,
  ];
  if (args.dryRun) cliArgs.push("--dry-run");
  try {
    execFileSync("node", cliArgs, { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch (error) {
    console.error(`x-bookmarks: research.mjs failed for ${slug} — ${error.message}`);
    return false;
  }
}

function writeDiscoveryQueue(discoveries, args) {
  const dest = path.join(TARGETS_DIR, args.targetSlug, "discovery-queue.md");
  const rows = [...discoveries.values()]
    .sort((a, b) => b.seenIn.length - a.seenIn.length)
    .map((d) => `| ${d.ref} | ${d.type} | ${d.seenIn.length} | \`${d.suggestedSlug}\` |`);
  const content = [
    "# Discovery queue — from x-bookmarks",
    "",
    "Follow-on capture candidates extracted from bookmarked tweets. Each row is a reference",
    "worth its own `/risoluto-researcher` run. Promote it, then delete the row.",
    "",
    "| Reference | Type | Seen in (#) | Suggested slug |",
    "| --------- | ---- | ----------- | -------------- |",
    ...rows,
    "",
  ].join("\n");
  if (!args.dryRun) {
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return rows.length;
}

export function suggestSlug(ref) {
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const repo = /github\.com\/[^/]+\/([^/?#]+)/.exec(ref);
  if (repo) return slugify(repo[1]);
  // An X/Twitter handle URL → the handle itself, not the bare "x" hostname. Reserved
  // first-segments (/i/, /home, /search) are not handles, so fall through to the host.
  const xHandle = /(?:x|twitter)\.com\/([A-Za-z0-9_]+)(?:$|[/?#])/.exec(ref);
  if (xHandle && !["i", "home", "search", "explore", "status"].includes(xHandle[1].toLowerCase())) {
    return slugify(xHandle[1]);
  }
  const host = /https?:\/\/(?:www\.)?([^/]+)/.exec(ref);
  if (host) return slugify(host[1].split(".")[0]);
  return slugify(ref).slice(0, 40);
}

function collectDiscoveries(discoveries, refs, slug, selfHandle) {
  const self = (selfHandle || "").toLowerCase();
  const add = (ref, type) => {
    const key = ref.toLowerCase();
    if (!discoveries.has(key)) discoveries.set(key, { ref, type, seenIn: [], suggestedSlug: suggestSlug(ref) });
    discoveries.get(key).seenIn.push(slug);
  };
  refs.urls.forEach((u) => add(u, classifyDiscovery(u)));
  // A self-quote (quoting your own earlier tweet) is thread continuation, not a follow-on target.
  if (refs.quoted?.screenName && refs.quoted.screenName.toLowerCase() !== self) {
    add(`https://x.com/${refs.quoted.screenName}`, "x");
  }
  refs.mentions.forEach((h) => add(`https://x.com/${h}`, "x"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  checkPreconditions(args);

  const single = args.tweet ? loadSingleTweet(args) : null;
  // A single pasted tweet defaults to a target named after its author, not the bookmarks staging target.
  if (single && args.targetSlug === "x-bookmarks") {
    args.targetSlug = suggestSlug(`https://x.com/${single.root.author?.screenName || "i"}`);
  }
  const bookmarks = single ? [single.root] : harvestBookmarks(args);

  const discoveries = new Map();
  let written = 0;
  let skipped = 0;
  let mediaCount = 0;
  let commentedCount = 0;

  for (const tweet of bookmarks) {
    const slug = deriveSourceSlug(tweet);
    const sourcePath = path.join(TARGETS_DIR, args.targetSlug, "sources", `${slug}.md`);
    if (existsSync(sourcePath) && !args.force) {
      skipped += 1;
      continue;
    }
    const mediaPaths = downloadMedia(tweet, slug, args.targetSlug, args.dryRun || args.noMedia);
    mediaCount += mediaPaths.length;
    const refs = extractReferences(tweet);
    collectDiscoveries(discoveries, refs, slug, tweet.author?.screenName);
    // Single mode already holds the replies (same payload) and the user explicitly chose this
    // tweet, so rank them unconditionally; bulk mode fetches them and gates on the reply threshold.
    const comments = single ? rankComments(single.replies, single.root, args.commentsTop) : fetchComments(tweet, args);
    if (comments.length) commentedCount += 1;
    const body = composeBody(tweet, mediaPaths, refs, comments);
    if (writeSource(tweet, slug, body, args)) written += 1;
  }

  const discoveryRows = writeDiscoveryQueue(discoveries, args);

  const noun = single ? "tweet" : "bookmarks";
  console.error(
    `x-bookmarks: ${args.dryRun ? "[dry-run] " : ""}` +
      `${bookmarks.length} ${noun} → ${written} sources written, ${skipped} already-captured (skipped), ` +
      `${mediaCount} media files, comments ranked for ${commentedCount} high-signal tweets, ` +
      `${discoveryRows} discovery candidates`,
  );
  if (!args.dryRun) console.error("x-bookmarks: run `pnpm validate:research` to verify the corpus.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
