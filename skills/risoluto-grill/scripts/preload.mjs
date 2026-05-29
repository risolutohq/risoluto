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
 * Parse "## Candidate features" section from a target README.
 * Each candidate is a markdown block of the form:
 *
 *   ### <Title>
 *   <summary lines>
 *   [flag: <new|merge|supersede|skip>]
 *
 * The [flag: ...] marker may appear anywhere in the candidate block.
 *
 * @param {string} raw
 * @returns {Array<{ title: string, flag: string, summary: string }>}
 */
function parseCandidates(raw) {
  const FLAG_RE = /\[flag:\s*([a-z]+)\]/i;
  const candidatesIdx = raw.search(/^##\s+Candidate features/im);
  if (candidatesIdx === -1) return [];

  // Slice from "## Candidate features" to the next ## heading (or EOF)
  const afterSection = raw.slice(candidatesIdx);
  const nextHeadingMatch = afterSection.slice(1).search(/^##\s+/m);
  const section = nextHeadingMatch === -1 ? afterSection : afterSection.slice(0, nextHeadingMatch + 1);

  // Split into ### sub-headings
  const parts = section.split(/^###\s+/m).slice(1); // first part is the ## heading itself
  const candidates = [];
  for (const part of parts) {
    const titleEnd = part.indexOf("\n");
    const title = (titleEnd === -1 ? part : part.slice(0, titleEnd)).trim();
    const body = titleEnd === -1 ? "" : part.slice(titleEnd + 1).trim();
    const flagMatch = body.match(FLAG_RE);
    const flag = flagMatch ? flagMatch[1].toLowerCase() : "new";
    const validFlag = VALID_FLAGS.includes(flag) ? flag : "new";
    // Strip the flag marker from summary
    const summary = body.replace(FLAG_RE, "").trim();
    if (title) candidates.push({ title, flag: validFlag, summary });
  }
  return candidates;
}

/**
 * Collect RISOLUTO_FEATURES.md lines that mention the slug.
 * @param {string} slug
 * @returns {Array<{ line: number, text: string }>}
 */
function findFeaturesHits(slug) {
  if (!existsSync(FEATURES_FILE)) return [];
  const lines = readFileSync(FEATURES_FILE, "utf8").split("\n");
  const needle = slug.toLowerCase();
  const altNeedle = slug.replace(/-/g, " ").toLowerCase();
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    if (lower.includes(needle) || lower.includes(altNeedle)) {
      hits.push({ line: i + 1, text: lines[i].trim() });
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
  process.stderr.write(
    `risoluto-grill preload: loaded ${slug} — ${candidates.length} candidates (${surviving} surviving), ` +
      `${roadmapRows.length} roadmap rows, ${featuresSpine.length} features-spine hits\n`,
  );
}

main();
