#!/usr/bin/env node
/**
 * risoluto-researcher: capture a Reddit thread (post + full comment tree) into
 * research/targets/<subreddit>/.
 *
 * Reads one thread via `rdt-cli` (public-clis/rdt-cli — cookie auth + Chrome TLS
 * fingerprint, the access path Reddit now requires after disabling unauthenticated
 * .json), downloads the post media, extracts references (links / r-subreddits /
 * u-users) into a discovery queue, and writes one schema-valid source file by
 * delegating to research.mjs (the already-validated writer).
 *
 * Capture policy (per the Reddit-capture design):
 *   - comments: the FULL tree, sorted by top (`rdt read -s top --expand-more`), nothing
 *     dropped — Reddit's comment tree is genuinely the post's replies (no recommendation
 *     pollution like X), so "capture everything" is the intent.
 *   - media:    the post URL is downloaded when it points to an image/video host.
 *   - discover: every external link / cross-subreddit / user mention becomes a follow-on
 *     capture candidate (discovery-queue.md).
 *
 * Usage:
 *   node skills/risoluto-researcher/scripts/reddit-capture.mjs --post <url-or-id> \
 *     [--comment-sort top] [--no-media] [--force] [--dry-run] \
 *     [--from-json <thread.json>] [--target-slug <subreddit>]
 *
 * --from-json reads a saved `rdt read --json` envelope instead of calling rdt — used to
 * resume and to test the transforms without browser-cookie auth.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { slugify, classifyDiscovery, suggestSlug } from "./capture-lib.mjs";

// Re-exported so this script's fixture tests keep a stable import surface.
export { slugify, classifyDiscovery, suggestSlug };

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const TARGETS_DIR = path.join(RESEARCH_DIR, "targets");
const RESEARCH_SCRIPT = path.join(SCRIPT_DIR, "research.mjs");

// ---------------------------------------------------------------------------
// Pure transforms (exported for fixture testing — no I/O, no network)
// ---------------------------------------------------------------------------

/**
 * Unwrap rdt-cli's `{ ok, schema_version, data, error }` envelope (same shape as twitter-cli).
 * Accepts a raw JSON string or a parsed object.
 * @param {string | object} rawOrObj
 * @returns {object} the `data` payload (a PostDetail: { post, comments, ... })
 */
export function parseEnvelope(rawOrObj) {
  const payload = typeof rawOrObj === "string" ? JSON.parse(rawOrObj) : rawOrObj;
  if (payload && payload.ok === false) {
    const err = payload.error || {};
    throw new Error(`rdt-cli error: ${err.code || "unknown"} — ${err.message || "no message"}`);
  }
  return payload?.data ?? payload;
}

/** Reddit post id from a thread URL (`/comments/<id>/...`) or a bare id. */
export function postIdFromInput(input) {
  const m = /comments\/([a-z0-9]+)/i.exec(String(input || ""));
  if (m) return m[1];
  return String(input || "").replace(/[^a-z0-9]/gi, "");
}

/** Does this URL point at a downloadable image/video, not an HTML page? */
export function isRedditMedia(url) {
  return (
    /(i\.redd\.it|v\.redd\.it|preview\.redd\.it|i\.imgur\.com)\//i.test(url || "") ||
    /\.(jpe?g|png|gif|gifv|webp|mp4)(\?|$)/i.test(url || "")
  );
}

/** File extension for a media URL, defaulting to jpg. */
export function mediaExt(url) {
  const m = /\.(jpe?g|png|gif|gifv|webp|mp4)(?:\?|$)/i.exec(url || "");
  return m ? m[1].toLowerCase().replace("jpeg", "jpg").replace("gifv", "mp4") : "jpg";
}

/** Count every comment in the tree (for the "## Comments (N)" header). */
export function countComments(comments) {
  return (comments || []).reduce((n, c) => n + 1 + countComments(c.replies), 0);
}

/**
 * Render the full comment tree as indented markdown bullets, preserving rdt's top-sort order
 * at every level. Nothing is dropped — removed/deleted bodies are kept as-is so the thread
 * structure stays faithful ("capture everything").
 * @param {object[]} comments
 * @param {number} depth
 * @returns {string[]} markdown lines
 */
export function renderComments(comments, depth) {
  const lines = [];
  for (const c of comments || []) {
    const indent = "  ".repeat(depth);
    const body = String(c.body || "")
      .replace(/\s+/g, " ")
      .trim();
    lines.push(`${indent}- **u/${c.author || "?"}** _(${c.score ?? 0})_ — ${body || "_[no text]_"}`);
    if (c.replies?.length) lines.push(...renderComments(c.replies, depth + 1));
  }
  return lines;
}

/** Concatenate every comment body in the tree (for reference scanning). */
function allBodies(comments) {
  return (comments || []).flatMap((c) => [String(c.body || ""), ...allBodies(c.replies)]).join("\n");
}

/**
 * Extract follow-on references from a thread: external links (post URL for link posts, plus
 * any links in the selftext and comments), cross-subreddit mentions, and user mentions.
 * @param {object} post
 * @param {object[]} comments
 * @returns {{ urls: string[], subs: string[], users: string[] }}
 */
export function extractRedditRefs(post, comments) {
  const text = `${post.selftext || ""}\n${allBodies(comments)}`;
  const urls = [...text.matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0].replace(/[.,)]+$/, ""));
  if (post.url && !post.is_self && !isRedditMedia(post.url)) urls.push(post.url);
  const subs = [...text.matchAll(/\br\/([A-Za-z0-9_]{2,})/g)].map((m) => m[1]);
  const users = [...text.matchAll(/\bu\/([A-Za-z0-9_-]{2,})/g)].map((m) => m[1]);
  return {
    urls: [...new Set(urls)].filter((u) => !/redd\.it|reddit\.com/i.test(u) || !isRedditMedia(u)),
    subs: [...new Set(subs)],
    users: [...new Set(users)],
  };
}

/** One-line, slug-safe-ish title for the source H1. */
export function deriveTitle(post) {
  const t = String(post.title || "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > 90 ? `${t.slice(0, 87)}...` : t || `Reddit post ${post.id}`;
}

/**
 * Compose the source body markdown for one thread. mediaPaths are relative to the source file.
 * The "Why this matters" section is left for the agent's judgment layer.
 */
export function composeBody(post, mediaPaths, refs, commentLines, commentCount) {
  const date = post.created_utc ? new Date(post.created_utc * 1000).toISOString().slice(0, 10) : "?";
  const lines = [
    `> Reddit thread in r/${post.subreddit} by u/${post.author} — ${post.score ?? 0} points · ` +
      `${post.num_comments ?? 0} comments · posted ${date}${post.over_18 ? " · ⚠️ NSFW" : ""}`,
    "",
    "## Post",
    "",
    String(post.selftext || "").trim() || (post.is_self ? "_(no body)_" : `**Link:** ${post.url}`),
  ];

  if (mediaPaths.length) {
    lines.push("", "## Media", "");
    mediaPaths.forEach((p) => lines.push(`- ![media](${p})`));
  }

  const hasRefs = refs.urls.length || refs.subs.length || refs.users.length;
  if (hasRefs) {
    lines.push("", "## References", "");
    refs.urls.forEach((u) => lines.push(`- ${u}  _(→ discovery: ${classifyDiscovery(u)})_`));
    if (refs.subs.length) lines.push(`- Subreddits: ${refs.subs.map((s) => `r/${s}`).join(" ")}`);
    if (refs.users.length) lines.push(`- Users: ${refs.users.map((u) => `u/${u}`).join(" ")}`);
  }

  lines.push("", `## Comments (${commentCount}, sorted by top)`, "");
  lines.push(...(commentLines.length ? commentLines : ["_(no comments)_"]));

  lines.push(
    "",
    "## Why this matters for Risoluto",
    "",
    "TODO — agent fills: which AFK job / capability does this thread surface? Promote any",
    "follow-on references from the discovery queue to their own `/risoluto-researcher` runs.",
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// I/O orchestration (not exported)
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`reddit-capture: ${msg}`);
  process.exit(1);
}

function parseArgs(raw) {
  const args = {
    post: "",
    commentSort: "top",
    noMedia: false,
    force: false,
    dryRun: false,
    fromJson: "",
    targetSlug: "",
  };
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case "--post":
        args.post = raw[++i] ?? "";
        break;
      case "--comment-sort":
        args.commentSort = raw[++i] ?? "top";
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
  if (!args.post && !args.fromJson) fail("usage: reddit-capture.mjs --post <url-or-id>");
  if (!args.fromJson) {
    try {
      execFileSync("rdt", ["--help"], { stdio: "ignore" });
    } catch {
      fail("rdt-cli not found — `uv tool install rdt-cli`, then `rdt login` (Reddit now requires session cookies)");
    }
  }
}

function rdt(cliArgs) {
  return execFileSync("rdt", cliArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function loadThread(args) {
  if (args.fromJson) return parseEnvelope(readFileSync(args.fromJson, "utf8"));
  const id = postIdFromInput(args.post);
  const data = parseEnvelope(rdt(["read", id, "-s", args.commentSort, "--expand-more", "--json"]));
  if (!data?.post) fail(`no post returned for ${args.post}`);
  return data;
}

function downloadMedia(post, slug, targetSlug, dryRun) {
  if (!post.url || !isRedditMedia(post.url)) return [];
  const ext = mediaExt(post.url);
  const fileName = `0.${ext}`;
  const rel = `../media/${slug}/${fileName}`;
  if (dryRun) return [rel];
  const destDir = path.join(TARGETS_DIR, targetSlug, "media", slug);
  mkdirSync(destDir, { recursive: true });
  try {
    execFileSync("curl", ["-sL", "--fail", "-o", path.join(destDir, fileName), post.url], { stdio: "ignore" });
    return [rel];
  } catch {
    console.error(`reddit-capture: media download failed for ${slug} (${post.url})`);
    return [];
  }
}

function writeSource(post, slug, targetSlug, body, dryRun) {
  const bodyFile = path.join(tmpdir(), `rdt-${slug}.md`);
  writeFileSync(bodyFile, body);
  const url = post.permalink
    ? `https://www.reddit.com${post.permalink}`
    : post.url || `https://www.reddit.com/comments/${post.id}`;
  const cliArgs = [
    RESEARCH_SCRIPT,
    "--url",
    url,
    "--target-slug",
    targetSlug,
    "--category",
    "reference",
    "--source-type",
    "reddit",
    "--source-slug",
    slug,
    "--title",
    deriveTitle(post),
    "--description",
    `Reddit community r/${post.subreddit} — threads captured as research source material.`,
    "--body-file",
    bodyFile,
  ];
  if (dryRun) cliArgs.push("--dry-run");
  try {
    execFileSync("node", cliArgs, { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch (error) {
    console.error(`reddit-capture: research.mjs failed for ${slug} — ${error.message}`);
    return false;
  }
}

function writeDiscoveryQueue(discoveries, targetSlug, dryRun) {
  const rows = [...discoveries.values()].map((d) => `| ${d.ref} | ${d.type} | \`${d.suggestedSlug}\` |`);
  const content = [
    `# Discovery queue — from r/${targetSlug}`,
    "",
    "Follow-on capture candidates extracted from captured threads. Each row is a reference",
    "worth its own `/risoluto-researcher` run. Promote it, then delete the row.",
    "",
    "| Reference | Type | Suggested slug |",
    "| --------- | ---- | -------------- |",
    ...rows,
    "",
  ].join("\n");
  if (!dryRun) {
    const dest = path.join(TARGETS_DIR, targetSlug, "discovery-queue.md");
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return rows.length;
}

function collectDiscoveries(refs) {
  const discoveries = new Map();
  const add = (ref, type, slug) => {
    const key = ref.toLowerCase();
    if (!discoveries.has(key)) discoveries.set(key, { ref, type, suggestedSlug: slug });
  };
  refs.urls.forEach((u) => add(u, classifyDiscovery(u), suggestSlug(u)));
  refs.subs.forEach((s) => add(`https://www.reddit.com/r/${s}`, "reddit", slugify(s)));
  refs.users.forEach((u) => add(`https://www.reddit.com/user/${u}`, "reddit", slugify(u)));
  return discoveries;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  checkPreconditions(args);

  const thread = loadThread(args);
  const post = thread.post;
  const comments = thread.comments || [];
  const slug = `post-${String(post.id).replace(/[^a-z0-9]/gi, "")}`;
  const targetSlug = args.targetSlug || slugify(post.subreddit) || "reddit";

  const mediaPaths = downloadMedia(post, slug, targetSlug, args.dryRun || args.noMedia);
  const refs = extractRedditRefs(post, comments);
  const commentLines = renderComments(comments, 0);
  const commentCount = countComments(comments);
  const body = composeBody(post, mediaPaths, refs, commentLines, commentCount);
  const written = writeSource(post, slug, targetSlug, body, args.dryRun) ? 1 : 0;

  const discoveries = collectDiscoveries(refs);
  const discoveryRows = writeDiscoveryQueue(discoveries, targetSlug, args.dryRun);

  console.error(
    `reddit-capture: ${args.dryRun ? "[dry-run] " : ""}thread ${post.id} in r/${post.subreddit} → ` +
      `${written} source written (target r/${targetSlug}), ${commentCount} comments (sorted ${args.commentSort}), ` +
      `${mediaPaths.length} media, ${discoveryRows} discovery candidates`,
  );
  if (!args.dryRun) console.error("reddit-capture: run `pnpm validate:research` to verify the corpus.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
