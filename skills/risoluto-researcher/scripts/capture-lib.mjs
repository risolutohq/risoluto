/**
 * risoluto-researcher: shared capture helpers.
 *
 * Extracted at the third consumer (x-bookmarks, reddit-capture, youtube-capture all needed
 * the same slug + discovery-classification logic). These are pure, network-free transforms;
 * each capture script imports what it needs and re-exports for its own fixture tests so its
 * public surface is unchanged. Envelope parsing stays per-script — twitter-cli, rdt-cli, and
 * yt-dlp each emit a different JSON shape, so there is nothing to share there.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SLUGIFY_RE = /[^a-z0-9-]/g;

/**
 * True when `metaUrl` belongs to the module Node launched as the process entry point —
 * the run-only-when-invoked-directly guard, robust to symlinked invocation.
 *
 * Skills are reached via `.claude/skills/risoluto-researcher/...`, a symlink to the real
 * `skills/risoluto-researcher/...`. `import.meta.url` resolves that link while
 * `process.argv[1]` keeps the `.claude/...` path, so a raw `===` compare never matches and
 * `main()` silently never runs. Resolving argv[1] through `realpathSync` first makes both
 * sides the canonical path, so the guard fires on either invocation path.
 * @param {string} metaUrl - the caller's `import.meta.url`
 * @returns {boolean}
 */
export function isMainEntry(metaUrl) {
  return realpathSync(process.argv[1]) === fileURLToPath(metaUrl);
}

/**
 * Lowercase, slug-safe: non-`[a-z0-9-]` runs become dashes, edges trimmed.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(SLUGIFY_RE, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Map a reference URL to a research source-type so the discovery queue suggests the right
 * capture path for the follow-on run.
 * @param {string} url
 * @returns {"repo" | "video" | "paper" | "reddit" | "x" | "article"}
 */
export function classifyDiscovery(url) {
  const u = String(url || "").toLowerCase();
  if (/github\.com/.test(u)) return "repo";
  if (/youtube\.com|youtu\.be/.test(u)) return "video";
  if (/arxiv\.org/.test(u)) return "paper";
  if (/reddit\.com/.test(u)) return "reddit";
  if (/x\.com|twitter\.com/.test(u)) return "x";
  return "article";
}

/**
 * The brand label of a URL's host — its second-level domain, not the leading subdomain
 * (news.ycombinator.com → ycombinator, docs.python.org → python, www.cursor.com → cursor).
 * Returns "" if no host is found. (Multi-part TLDs like .co.uk are out of scope.)
 * @param {string} url
 * @returns {string}
 */
export function hostLabel(url) {
  const host = (/https?:\/\/(?:www\.)?([^/]+)/.exec(url || "") || [])[1] || "";
  const labels = host.split(".").filter(Boolean);
  const sld = labels.length >= 2 ? labels[labels.length - 2] : labels[0] || "";
  return slugify(sld);
}

/**
 * Slug suggestion for a discovered external URL: a repo name, an X/Twitter handle (not the
 * bare host, and not a reserved first-segment like /i/ or /home), or the host's brand label.
 * @param {string} ref
 * @returns {string}
 */
export function suggestSlug(ref) {
  const repo = /github\.com\/[^/]+\/([^/?#]+)/.exec(ref);
  if (repo) return slugify(repo[1]);
  const xHandle = /(?:x|twitter)\.com\/([A-Za-z0-9_]+)(?:$|[/?#])/.exec(ref);
  if (xHandle && !["i", "home", "search", "explore", "status"].includes(xHandle[1].toLowerCase())) {
    return slugify(xHandle[1]);
  }
  return hostLabel(ref) || slugify(ref).slice(0, 40);
}
