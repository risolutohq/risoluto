#!/usr/bin/env node
/**
 * risoluto-grill step 1: load context bundle for grilling a research target.
 *
 * Parses research/targets/<slug>/README.md for "## Candidate features" entries,
 * reads the current roadmap rows, and collects RISOLUTO_FEATURES.md lines that
 * mention the slug. Prints structured JSON to stdout and a one-line summary to
 * stderr. Read-only.
 *
 * Usage:
 *   node skills/risoluto-grill/scripts/preload.mjs <target-slug>
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoadmap } from "../../../scripts/roadmap.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const TARGETS_DIR = path.join(RESEARCH_DIR, "targets");
const FEATURES_FILE = path.join(RESEARCH_DIR, "RISOLUTO_FEATURES.md");
const ROADMAP_FILE = path.join(REPO_ROOT, "docs", "roadmap.md");

function fail(msg) {
  process.stderr.write(`risoluto-grill preload: ${msg}\n`);
  process.exit(1);
}

function checkPreconditions(slug) {
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) {
    fail(`run from the repo root — expected package.json at ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) {
    fail("research/ submodule is not initialised — run `git submodule update --init research`");
  }
  const targetReadme = path.join(TARGETS_DIR, slug, "README.md");
  if (!existsSync(targetReadme)) {
    fail(`target README not found: research/targets/${slug}/README.md — run /risoluto-researcher first`);
  }
  if (!existsSync(ROADMAP_FILE)) {
    fail("docs/roadmap.md not found — the repo is in an unexpected state");
  }
}

/**
 * Valid dedup flags from the pipeline spec.
 * @type {string[]}
 */
const VALID_FLAGS = ["new", "merge", "supersede", "skip"];

/**
 * Parse the "## Candidate features" section of a target README.
 *
 * The researcher (Step 5.1 / buildTargetBody) writes one candidate per bullet:
 *
 *   - <Title> — <one-line summary> [job: <afk-job>] [flag: <new|merge|supersede|skip>[ slug:<row-slug>]]
 *
 * Title is the text before the em-dash; the [job:] and [flag:] markers may appear in
 * any order at the end. A `merge`/`supersede` flag may carry a `slug:<row>` token naming
 * the roadmap row it folds into / replaces. An unresolved `[flag: TBD]` or a missing flag
 * is read as `new`, so the candidate still reaches the grill. Scaffold/placeholder bullets
 * (those still containing `<...>` angle brackets) are skipped.
 *
 * @param {string} raw
 * @returns {Array<{ title: string, summary: string, job: string | null, flag: string, merge_target_slug: string | null }>}
 */
function parseCandidates(raw) {
  const candidatesIdx = raw.search(/^##\s+Candidate features/im);
  if (candidatesIdx === -1) return [];

  // Slice from "## Candidate features" to the next ## heading (or EOF).
  const afterSection = raw.slice(candidatesIdx);
  const nextHeadingMatch = afterSection.slice(1).search(/^##\s+/m);
  const section = nextHeadingMatch === -1 ? afterSection : afterSection.slice(0, nextHeadingMatch + 1);

  const candidates = [];
  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) continue; // candidates are top-level bullets

    const flagMatch = line.match(/\[flag:\s*([^\]]+)\]/i);
    const jobMatch = line.match(/\[job:\s*([^\]]+)\]/i);

    // Drop the leading bullet and the [job:]/[flag:] markers, then split "title — summary".
    const text = line
      .replace(/^-+\s*/, "")
      .replace(/\[(?:job|flag):[^\]]*\]/gi, "")
      .trim();
    const [titlePart, ...rest] = text.split(/\s+—\s+|\s+-\s+/);
    const title = (titlePart ?? "").trim();
    if (!title || title.includes("<")) continue; // skip scaffold placeholders like "<feature name>"
    const summary = rest.join(" — ").trim();

    let flag = "new";
    let mergeTargetSlug = null;
    if (flagMatch) {
      const tokens = flagMatch[1].trim().split(/\s+/);
      const word = (tokens[0] ?? "").toLowerCase();
      flag = VALID_FLAGS.includes(word) ? word : "new"; // TBD / unknown → new (unresolved reaches the grill)
      const slugTok = tokens.find((t) => t.toLowerCase().startsWith("slug:"));
      if (slugTok) mergeTargetSlug = slugTok.slice("slug:".length);
    }
    const job = jobMatch ? jobMatch[1].trim() : null;
    candidates.push({ title, summary, job, flag, merge_target_slug: mergeTargetSlug });
  }
  return candidates;
}

/**
 * Collect RISOLUTO_FEATURES.md lines that mention the slug, each tagged with its `status`:
 *
 *   - "active"  — inside a live feature entry → "Risoluto ships this" (saturation / differentiation signal)
 *   - "removed" — inside a `⚠️ Removed` tombstone → "Risoluto built this and deliberately dropped it"
 *                 (the OPPOSITE of shipped — re-proposing it must clear a higher bar; never read as covered)
 *   - "meta"    — inside `## Run history` or `## Changed since last spine` (a ledger/diff row, not an entry)
 *
 * The status lets the grill avoid treating a tombstone as evidence the capability is shipped — see SKILL.md.
 *
 * @param {string} slug
 * @returns {Array<{ line: number, text: string, status: "active" | "removed" | "meta" }>}
 */
function findFeaturesHits(slug) {
  if (!existsSync(FEATURES_FILE)) return [];
  const lines = readFileSync(FEATURES_FILE, "utf8").split("\n");
  const needle = slug.toLowerCase();
  const altNeedle = slug.replace(/-/g, " ").toLowerCase();
  const hits = [];
  let section = ""; // current `## ` heading, lowercased
  let entryStatus = "active"; // status of the current `### ` entry
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const h3 = line.match(/^###\s+(.*)/);
    if (h3) {
      entryStatus = /⚠️|removed in /i.test(h3[1]) ? "removed" : "active";
    } else {
      const h2 = line.match(/^##\s+(.*)/);
      if (h2) {
        section = h2[1].toLowerCase();
        entryStatus = "active";
      }
    }
    const lower = line.toLowerCase();
    if (lower.includes(needle) || lower.includes(altNeedle)) {
      const isMeta = section.includes("run history") || section.includes("changed since last spine");
      hits.push({ line: i + 1, text: line.trim(), status: isMeta ? "meta" : entryStatus });
    }
  }
  return hits;
}

function main() {
  const slug = process.argv[2];
  if (!slug) fail("usage: preload.mjs <target-slug>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`invalid target slug: ${slug}`);
  checkPreconditions(slug);

  const targetReadme = path.join(TARGETS_DIR, slug, "README.md");
  const raw = readFileSync(targetReadme, "utf8");
  const candidates = parseCandidates(raw);

  const roadmapRaw = readFileSync(ROADMAP_FILE, "utf8");
  const roadmapModel = parseRoadmap(roadmapRaw);
  const roadmapRows = roadmapModel.rows.map((r) => ({
    slug: r.slug,
    item: r.cells[1] ?? "",
    status: r.cells[4] ?? "",
  }));

  const featuresSpine = findFeaturesHits(slug);

  const bundle = {
    target: slug,
    candidates,
    roadmap_rows: roadmapRows,
    features_spine: featuresSpine,
  };
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);

  const surviving = candidates.filter((c) => c.flag !== "skip").length;
  const spineActive = featuresSpine.filter((h) => h.status === "active").length;
  const spineRemoved = featuresSpine.filter((h) => h.status === "removed").length;
  process.stderr.write(
    `risoluto-grill preload: loaded ${slug} — ${candidates.length} candidates (${surviving} surviving), ` +
      `${roadmapRows.length} roadmap rows, ${featuresSpine.length} features-spine hits ` +
      `(${spineActive} active, ${spineRemoved} tombstoned)\n`,
  );
}

main();
