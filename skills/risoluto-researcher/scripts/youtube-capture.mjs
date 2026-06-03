#!/usr/bin/env node
/**
 * risoluto-researcher: capture a YouTube video (info + transcript + channel stats) into
 * research/targets/<channel>/.
 *
 * Reads one video via `yt-dlp` (no API key — yt-dlp scrapes the watch page): dumps the full
 * metadata JSON, downloads the best English subtitle track (manual preferred over auto, with
 * a fall-back to the original language for the agent to translate), downloads the thumbnail,
 * extracts links from the description into a discovery queue, and writes one schema-valid
 * source file by delegating to research.mjs (the already-validated writer).
 *
 * Capture policy (per the YouTube-capture design):
 *   - transcript: best available English subtitles, de-timestamped + de-duplicated into raw
 *     prose. The skill's LLM layer then rewrites it clean and translates if the source is not
 *     English ("Generate clean text transcripts by the llm, in English").
 *   - info:       comprehensive — channel details + statistics, duration, views/likes/comments,
 *     tags, categories, chapters.
 *   - discover:   every external link in the description becomes a follow-on capture candidate.
 *
 * Usage:
 *   node skills/risoluto-researcher/scripts/youtube-capture.mjs --video <url-or-id> \
 *     [--sub-lang en] [--no-media] [--no-subs] [--force] [--dry-run] \
 *     [--from-json <info.json>] [--target-slug <channel>]
 *
 * --from-json reads a saved `yt-dlp -J` info dump instead of calling yt-dlp — used to resume
 * and to test the transforms without network access (no subtitle fetch in that mode).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { slugify, classifyDiscovery, suggestSlug, isMainEntry } from "./capture-lib.mjs";

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
 * yt-dlp `-J` returns the video object directly for a watch URL, or a playlist wrapper for a
 * search/playlist URL. Unwrap to the first video either way.
 * @param {string | object} rawOrObj
 * @returns {object} the video info object
 */
export function parseInfo(rawOrObj) {
  const info = typeof rawOrObj === "string" ? JSON.parse(rawOrObj) : rawOrObj;
  if (info?._type === "playlist" && Array.isArray(info.entries) && info.entries.length) return info.entries[0];
  return info;
}

/** YouTube video id from a watch / youtu.be / shorts URL, or a bare 11-char id. */
export function videoIdFromInput(input) {
  const s = String(input || "");
  const m =
    /[?&]v=([A-Za-z0-9_-]{11})/.exec(s) ||
    /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(s) ||
    /shorts\/([A-Za-z0-9_-]{11})/.exec(s) ||
    /\/live\/([A-Za-z0-9_-]{11})/.exec(s);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 11);
}

/** `20250213` (yt-dlp upload_date) → `2025-02-13`; passthrough anything else. */
export function formatUploadDate(yyyymmdd) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(yyyymmdd || ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : String(yyyymmdd || "?");
}

/** Human-readable count with thousands separators (no Intl dependency, deterministic). */
export function fmtCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "?";
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Decide which subtitle track to fetch from the info dump: manual English beats auto English
 * beats the video's original language (which the agent then translates). Returns the exact
 * track key yt-dlp expects plus flags describing provenance for the transcript header.
 * @param {object} info
 * @returns {{ lang: string, auto: boolean, translate: boolean } | null}
 */
export function chooseSubtitleTrack(info) {
  const manual = Object.keys(info?.subtitles || {});
  const auto = Object.keys(info?.automatic_captions || {});
  const isEn = (k) => /^en(-|$)/i.test(k);
  const manualEn = manual.find(isEn);
  if (manualEn) return { lang: manualEn, auto: false, translate: false };
  const autoEn = auto.find(isEn);
  if (autoEn) return { lang: autoEn, auto: true, translate: false };
  const orig = manual[0] || String(info?.language || "").split("-")[0] || auto[0] || "";
  if (!orig) return null;
  return { lang: orig, auto: !manual.includes(orig), translate: true };
}

/**
 * Strip a WebVTT subtitle file to flowing plain text: drop headers, cue indices, timestamp
 * lines and inline timing tags, decode the handful of entities YouTube emits, and collapse the
 * "rolling" duplication of auto-captions (each cue repeats the previous line plus new words).
 * The result is raw-but-readable; the skill's LLM layer does the final clean + translation.
 * @param {string} raw
 * @returns {string}
 */
export function cleanVtt(raw) {
  const decoded = String(raw || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  const kept = [];
  for (const rawLine of decoded.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "WEBVTT") continue;
    if (/^(Kind|Language|NOTE|STYLE|REGION)\b/.test(line)) continue;
    if (/-->/.test(line) || /^\d+$/.test(line)) continue;
    const prev = kept[kept.length - 1];
    if (line === prev) continue; // exact repeat
    if (prev && line.startsWith(prev))
      kept[kept.length - 1] = line; // rolling extension → keep the longer
    else if (prev && prev.startsWith(line))
      continue; // shorter prefix of what we already have
    else kept.push(line);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

/** External links found in the video description, de-duplicated, trailing punctuation trimmed. */
export function extractDescriptionLinks(description) {
  const urls = [...String(description || "").matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0].replace(/[.,)]+$/, ""));
  return [...new Set(urls)].filter((u) => !/youtube\.com\/(watch|channel|@)|youtu\.be\//i.test(u));
}

/** One-line, slug-safe-ish title for the source H1. */
export function deriveTitle(info) {
  const t = String(info?.title || "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > 90 ? `${t.slice(0, 87)}...` : t || `YouTube video ${info?.id || ""}`;
}

const TRANSCRIPT_SOURCE = {
  manual: "manual captions",
  auto: "auto-generated captions, lightly de-duplicated",
  translate: "auto-generated, NOT English — agent: translate to English",
};

/**
 * Compose the source body markdown for one video. mediaPaths are relative to the source file.
 * `track` describes the transcript provenance (null = no subtitles found). The transcript is
 * raw; the "Transcript" note tells the agent to rewrite it clean / translate it. The "Why this
 * matters" section is left for the agent's judgment layer.
 */
export function composeBody(info, mediaPaths, links, transcript, track) {
  const stat = (label, v) => `${label}: ${fmtCount(v)}`;
  const lines = [
    `> YouTube video by ${info.channel || info.uploader || "?"} — ${info.duration_string || "?"} · ` +
      `${fmtCount(info.view_count)} views · ${fmtCount(info.like_count)} likes · ` +
      `published ${formatUploadDate(info.upload_date)}`,
    "",
    "## Channel",
    "",
    `- **${info.channel || info.uploader || "?"}** (${info.uploader_id || "?"}) — ` +
      `${fmtCount(info.channel_follower_count)} subscribers`,
    `- ${info.channel_url || info.uploader_url || "?"}`,
    "",
    "## Stats",
    "",
    `- ${stat("Views", info.view_count)} · ${stat("Likes", info.like_count)} · ` +
      `${stat("Comments", info.comment_count)} · Duration ${info.duration_string || "?"} · ` +
      `Published ${formatUploadDate(info.upload_date)}`,
  ];
  if (info.categories?.length) lines.push(`- Categories: ${info.categories.join(", ")}`);
  if (info.tags?.length) lines.push(`- Tags: ${info.tags.slice(0, 20).join(", ")}`);

  if (mediaPaths.length) {
    lines.push("", "## Media", "");
    mediaPaths.forEach((p) => lines.push(`- ![media](${p})`));
  }

  lines.push("", "## Description", "", String(info.description || "").trim() || "_(no description)_");

  if (info.chapters?.length) {
    lines.push("", "## Chapters", "");
    info.chapters.forEach((c) => {
      const mm = Math.floor((c.start_time || 0) / 60);
      const ss = String(Math.round((c.start_time || 0) % 60)).padStart(2, "0");
      lines.push(`- ${mm}:${ss} — ${c.title || ""}`);
    });
  }

  if (links.length) {
    lines.push("", "## References", "");
    links.forEach((u) => lines.push(`- ${u}  _(→ discovery: ${classifyDiscovery(u)})_`));
  }

  const provenance = track ? TRANSCRIPT_SOURCE[track.translate ? "translate" : track.auto ? "auto" : "manual"] : "";
  lines.push("", `## Transcript${track ? ` (${track.lang}, ${track.auto ? "auto" : "manual"})` : ""}`, "");
  if (transcript) {
    if (track && (track.auto || track.translate)) lines.push(`_${provenance}._`, "");
    lines.push(transcript);
  } else {
    lines.push("_(no subtitles available)_");
  }

  lines.push(
    "",
    "## Why this matters for Risoluto",
    "",
    "TODO — agent fills: which AFK job / capability does this video surface? Promote any",
    "follow-on references from the discovery queue to their own `/risoluto-researcher` runs.",
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// I/O orchestration (not exported)
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`youtube-capture: ${msg}`);
  process.exit(1);
}

function parseArgs(raw) {
  const args = {
    video: "",
    subLang: "",
    noMedia: false,
    noSubs: false,
    force: false,
    dryRun: false,
    fromJson: "",
    targetSlug: "",
  };
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case "--video":
        args.video = raw[++i] ?? "";
        break;
      case "--sub-lang":
        args.subLang = raw[++i] ?? "";
        break;
      case "--no-media":
        args.noMedia = true;
        break;
      case "--no-subs":
        args.noSubs = true;
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
    fail("research/.schemas/ missing — frontmatter schemas are not present");
  }
  if (!args.video && !args.fromJson) fail("usage: youtube-capture.mjs --video <url-or-id>");
  if (!args.fromJson) {
    try {
      execFileSync("yt-dlp", ["--version"], { stdio: "ignore" });
    } catch {
      fail("yt-dlp not found — install it (`pacman -S yt-dlp` / `uv tool install yt-dlp`); no API key needed");
    }
  }
}

function ytdlp(cliArgs) {
  return execFileSync("yt-dlp", cliArgs, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
}

function loadInfo(args) {
  if (args.fromJson) return parseInfo(readFileSync(args.fromJson, "utf8"));
  const id = videoIdFromInput(args.video);
  const info = parseInfo(ytdlp(["-J", "--skip-download", "--no-warnings", `https://www.youtube.com/watch?v=${id}`]));
  if (!info?.id) fail(`no video returned for ${args.video}`);
  return info;
}

/** Download the chosen subtitle track to a temp dir and return its cleaned transcript text. */
function fetchTranscript(info, args, track) {
  if (args.noSubs || args.fromJson || !track) return "";
  const lang = args.subLang || track.lang;
  const outDir = path.join(tmpdir(), `yt-subs-${info.id}`);
  mkdirSync(outDir, { recursive: true });
  const flag = track.auto ? "--write-auto-subs" : "--write-subs";
  try {
    ytdlp([
      "--skip-download",
      flag,
      "--sub-langs",
      lang,
      "--sub-format",
      "vtt",
      "--no-warnings",
      "-o",
      path.join(outDir, "%(id)s.%(ext)s"),
      `https://www.youtube.com/watch?v=${info.id}`,
    ]);
  } catch (error) {
    console.error(`youtube-capture: subtitle fetch failed (${lang}) — ${error.message}`);
    return "";
  }
  const vtt = readdirSync(outDir).find((f) => f.endsWith(".vtt"));
  if (!vtt) return "";
  return cleanVtt(readFileSync(path.join(outDir, vtt), "utf8"));
}

function downloadThumbnail(info, slug, targetSlug, dryRun) {
  const url = info.thumbnail;
  if (!url) return [];
  const ext = (/\.(jpe?g|png|webp)(?:\?|$)/i.exec(url) || [])[1]?.toLowerCase().replace("jpeg", "jpg") || "jpg";
  const fileName = `0.${ext}`;
  const rel = `../media/${slug}/${fileName}`;
  if (dryRun) return [rel];
  const destDir = path.join(TARGETS_DIR, targetSlug, "media", slug);
  mkdirSync(destDir, { recursive: true });
  try {
    execFileSync("curl", ["-sL", "--fail", "-o", path.join(destDir, fileName), url], { stdio: "ignore" });
    return [rel];
  } catch {
    console.error(`youtube-capture: thumbnail download failed for ${slug}`);
    return [];
  }
}

function writeSource(info, slug, targetSlug, body, dryRun) {
  const bodyFile = path.join(tmpdir(), `yt-${slug}.md`);
  writeFileSync(bodyFile, body);
  const cliArgs = [
    RESEARCH_SCRIPT,
    "--url",
    info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
    "--target-slug",
    targetSlug,
    "--category",
    "reference",
    "--source-type",
    "video",
    "--source-slug",
    slug,
    "--title",
    deriveTitle(info),
    "--description",
    `YouTube channel ${info.channel || info.uploader || targetSlug} — videos captured as research source material.`,
    "--body-file",
    bodyFile,
  ];
  if (dryRun) cliArgs.push("--dry-run");
  try {
    execFileSync("node", cliArgs, { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch (error) {
    console.error(`youtube-capture: research.mjs failed for ${slug} — ${error.message}`);
    return false;
  }
}

function writeDiscoveryQueue(links, targetSlug, dryRun) {
  const seen = new Set();
  const rows = [];
  for (const u of links) {
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(`| ${u} | ${classifyDiscovery(u)} | \`${suggestSlug(u)}\` |`);
  }
  const content = [
    `# Discovery queue — from ${targetSlug}`,
    "",
    "Follow-on capture candidates extracted from captured videos. Each row is a reference",
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  checkPreconditions(args);

  const info = loadInfo(args);
  // YouTube ids are case-sensitive and may contain `_`, but research.mjs slugs must match
  // /^[a-z0-9][a-z0-9-]*$/. slugify lowercases and dashes any offending char; the true-case
  // id stays in the canonical url and every yt-dlp call.
  const slug = `video-${slugify(videoIdFromInput(info.id))}`;
  const targetSlug = args.targetSlug || slugify(info.channel || info.uploader || info.channel_id) || "youtube";

  const sourcePath = path.join(TARGETS_DIR, targetSlug, "sources", `${slug}.md`);
  if (existsSync(sourcePath) && !args.force && !args.dryRun) {
    fail(`already captured: ${sourcePath} (use --force to overwrite)`);
  }

  const track = chooseSubtitleTrack(info);
  const transcript = fetchTranscript(info, args, track);
  const mediaPaths = downloadThumbnail(info, slug, targetSlug, args.dryRun || args.noMedia);
  const links = extractDescriptionLinks(info.description);
  const body = composeBody(info, mediaPaths, links, transcript, track);
  const written = writeSource(info, slug, targetSlug, body, args.dryRun) ? 1 : 0;
  const discoveryRows = writeDiscoveryQueue(links, targetSlug, args.dryRun);

  const subNote = track
    ? `${track.lang} ${track.auto ? "auto" : "manual"}${track.translate ? " (needs translation)" : ""}`
    : "none";
  console.error(
    `youtube-capture: ${args.dryRun ? "[dry-run] " : ""}video ${info.id} by ${info.channel || "?"} → ` +
      `${written} source written (target ${targetSlug}), transcript ${transcript ? `${transcript.length} chars` : "—"} ` +
      `[${subNote}], ${mediaPaths.length} media, ${discoveryRows} discovery candidates`,
  );
  if (!args.dryRun) console.error("youtube-capture: run `pnpm validate:research` to verify the corpus.");
}

if (isMainEntry(import.meta.url)) {
  main();
}
