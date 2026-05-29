#!/usr/bin/env node
/**
 * risoluto-grill step 3: write grill results into docs/roadmap.md.
 *
 * Reads the results JSON produced after the grill conversation and makes
 * surgical edits to the roadmap table via scripts/roadmap.mjs:
 *   - new      -> appendRow
 *   - merge    -> setCell on the existing row's "Why now"
 *   - supersede -> setStatus(old, "superseded") + appendRow(new)
 *   - out/skip -> no write
 *
 * Usage:
 *   node skills/risoluto-grill/scripts/grill-write.mjs <target-slug> \
 *     --results-file <path> [--dry-run]
 *
 * Results JSON shape:
 *   {
 *     in:  [{ slug, title, why_now, size, status, flag, merge_target_row? }],
 *     out: [{ slug, title }]
 *   }
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoadmap, appendRow, setCell, setStatus, renderRoadmap } from "../../../scripts/roadmap.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const ROADMAP_FILE = path.join(REPO_ROOT, "docs", "roadmap.md");

function fail(msg) {
  process.stderr.write(`risoluto-grill write: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { slug: null, resultsFile: null, dryRun: false };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--results-file") {
      args.resultsFile = argv[i + 1];
      i += 2;
    } else if (a === "--dry-run") {
      args.dryRun = true;
      i += 1;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: grill-write.mjs <target-slug> --results-file <path> [--dry-run]\n\n" +
          "Results JSON shape:\n" +
          '  { in: [{ slug, title, why_now, size, status, flag, merge_target_row? }], out: [{ slug, title }] }\n\n' +
          "Flags:\n" +
          "  new       -> appendRow (status from result, default idea)\n" +
          "  merge     -> setCell on merge_target_row's Why now\n" +
          "  supersede -> setStatus(merge_target_row, superseded) + appendRow(new row)\n",
      );
      process.exit(0);
    } else if (!a.startsWith("--") && args.slug == null) {
      args.slug = a;
      i += 1;
    } else {
      fail(`unknown argument: ${a}`);
    }
  }
  return args;
}

function checkPreconditions(slug) {
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) {
    fail(`run from the repo root — expected package.json at ${REPO_ROOT}`);
  }
  if (!existsSync(ROADMAP_FILE)) {
    fail("docs/roadmap.md not found — the repo is in an unexpected state");
  }
  if (slug && !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    fail(`invalid target slug: ${slug}`);
  }
}

/**
 * Build the Research link cell value pointing at the target's README.
 * @param {string} targetSlug
 * @returns {string}
 */
function researchLink(targetSlug) {
  return `research/targets/${targetSlug}/README.md`;
}

/**
 * Process one "in" candidate entry against the roadmap model.
 * @param {object} model - mutable roadmap model from parseRoadmap
 * @param {string} targetSlug
 * @param {{ slug: string, title: string, why_now: string, size: string, status: string, flag: string, merge_target_row?: string }} entry
 * @returns {{ action: string, slug: string, changed: boolean }}
 */
function processEntry(model, targetSlug, entry) {
  const { slug, title, why_now, size, status, flag, merge_target_row } = entry;
  const link = researchLink(targetSlug);

  if (flag === "new") {
    const { added } = appendRow(model, {
      slug,
      item: title,
      whyNow: why_now ?? "",
      size: size ?? "",
      status: status ?? "idea",
      researchLink: link,
    });
    return { action: "new", slug, changed: added };
  }

  if (flag === "merge") {
    if (!merge_target_row) {
      process.stderr.write(`risoluto-grill write: merge entry ${slug} missing merge_target_row — skipping\n`);
      return { action: "merge", slug, changed: false };
    }
    const { changed } = setCell(model, merge_target_row, "Why now", why_now ?? "");
    return { action: "merge", slug: merge_target_row, changed };
  }

  if (flag === "supersede") {
    if (!merge_target_row) {
      process.stderr.write(`risoluto-grill write: supersede entry ${slug} missing merge_target_row — skipping\n`);
      return { action: "supersede", slug, changed: false };
    }
    setStatus(model, merge_target_row, "superseded", null);
    const { added } = appendRow(model, {
      slug,
      item: title,
      whyNow: why_now ?? "",
      size: size ?? "",
      status: status ?? "idea",
      researchLink: link,
    });
    return { action: "supersede", slug, changed: added };
  }

  process.stderr.write(`risoluto-grill write: unknown flag "${flag}" for ${slug} — skipping\n`);
  return { action: "unknown", slug, changed: false };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.slug) fail("usage: grill-write.mjs <target-slug> --results-file <path> [--dry-run]");
  if (!args.resultsFile) fail("--results-file <path> is required");
  if (!existsSync(args.resultsFile)) fail(`results file not found: ${args.resultsFile}`);

  checkPreconditions(args.slug);

  const resultsRaw = readFileSync(args.resultsFile, "utf8");
  let results;
  try {
    results = JSON.parse(resultsRaw);
  } catch {
    fail(`results file is not valid JSON: ${args.resultsFile}`);
  }

  if (!Array.isArray(results.in)) fail('results JSON must have an "in" array');
  if (!Array.isArray(results.out)) fail('results JSON must have an "out" array');

  const roadmapRaw = readFileSync(ROADMAP_FILE, "utf8");
  const model = parseRoadmap(roadmapRaw);
  if (!model.found) fail("roadmap plan table not found in docs/roadmap.md");

  let added = 0;
  let edited = 0;

  for (const entry of results.in) {
    const { action, slug, changed } = processEntry(model, args.slug, entry);
    if (!changed) continue;
    if (action === "new" || action === "supersede") added += 1;
    if (action === "merge") edited += 1;
  }

  const rendered = renderRoadmap(model);

  if (args.dryRun) {
    process.stderr.write(`risoluto-grill write: [dry-run] would add ${added} rows, edit ${edited} rows, drop ${results.out.length} candidates\n`);
    process.stdout.write(rendered);
    return;
  }

  writeFileSync(ROADMAP_FILE, rendered, "utf8");
  process.stderr.write(`risoluto-grill write: added ${added} rows, edited ${edited} rows, dropped ${results.out.length} candidates\n`);
}

main();
