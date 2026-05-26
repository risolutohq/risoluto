#!/usr/bin/env node
/**
 * risoluto-grill: write `## Why us / why now` and
 * `## Smallest shippable shape` into research/ideas/<slug>/README.md,
 * and optionally flip the matching backlog row to status: ready.
 *
 * Phase 3.1 of docs/planning-pipeline-roadmap.md. Idempotent: re-running
 * with the same inputs is a no-op; re-running with new inputs re-grills.
 *
 * Usage:
 *   node skills/risoluto-grill/scripts/grill-write.mjs <idea-slug> \
 *     --why-us-file <path> \
 *     --smallest-shape-file <path> \
 *     [--flip-to-ready] [--dry-run]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const IDEAS_DIR = path.join(RESEARCH_DIR, "ideas");
const BACKLOG_FILE = path.join(REPO_ROOT, "docs", "capability-backlog.md");

const WHY_US_HEADING = "## Why us / why now";
const SMALLEST_SHAPE_HEADING = "## Smallest shippable shape";

function fail(message) {
  console.error(`risoluto-grill: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { slug: null, whyUs: null, smallest: null, flip: false, dryRun: false };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--why-us-file") {
      args.whyUs = argv[i + 1];
      i += 2;
    } else if (a === "--smallest-shape-file") {
      args.smallest = argv[i + 1];
      i += 2;
    } else if (a === "--flip-to-ready") {
      args.flip = true;
      i += 1;
    } else if (a === "--dry-run") {
      args.dryRun = true;
      i += 1;
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
  if (!existsSync(path.join(IDEAS_DIR, slug, "README.md"))) {
    fail(`idea not found: research/ideas/${slug}/README.md`);
  }
  if (!existsSync(BACKLOG_FILE)) fail(`expected docs/capability-backlog.md at ${BACKLOG_FILE}`);
}

function readSectionBody(filePath, label) {
  if (!filePath) fail(`missing required flag: --${label}-file`);
  if (!existsSync(filePath)) fail(`file not found: ${filePath}`);
  return readFileSync(filePath, "utf8").replace(/\s+$/, "");
}

function replaceSection(raw, heading, newBody) {
  const idx = raw.indexOf(heading);
  if (idx === -1) fail(`section heading not found: ${heading}`);
  const afterHeading = raw.indexOf("\n", idx + heading.length);
  if (afterHeading === -1) fail(`malformed section heading: ${heading}`);
  const nextHeadingIdx = findNextSectionHeading(raw, afterHeading + 1);
  const head = raw.slice(0, afterHeading + 1);
  const tail = nextHeadingIdx === -1 ? "" : raw.slice(nextHeadingIdx);
  const body = newBody.trim().length === 0 ? "" : `\n${newBody.trim()}\n`;
  const separator = tail.length === 0 ? "" : "\n";
  return `${head}${body}${separator}${tail}`;
}

function findNextSectionHeading(raw, fromIdx) {
  const lines = raw.slice(fromIdx).split("\n");
  let offset = fromIdx;
  for (const line of lines) {
    if (line.startsWith("## ")) return offset;
    offset += line.length + 1;
  }
  return -1;
}

function writeIdea(slug, raw, dryRun) {
  const target = path.join(IDEAS_DIR, slug, "README.md");
  if (dryRun) {
    console.error(`risoluto-grill: [dry-run] would write ${path.relative(REPO_ROOT, target)}`);
    return;
  }
  writeFileSync(target, raw);
}

function flipBacklog(slug, dryRun) {
  const raw = readFileSync(BACKLOG_FILE, "utf8");
  const lines = raw.split("\n");
  let changed = false;
  let noop = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7 || cells[1] !== slug) continue;
    if (cells[4] !== "idea") {
      noop = true;
      console.error(`risoluto-grill: backlog row ${slug} is at status ${cells[4]} — leaving as-is`);
      break;
    }
    const updated = line.replace(/\|\s*idea\s*\|/, (m) => m.replace("idea", "ready"));
    lines[i] = updated;
    changed = true;
    break;
  }
  if (!changed && !noop) fail(`backlog row not found for slug: ${slug}`);
  if (!changed) return { changed: false };
  if (dryRun) {
    console.error(`risoluto-grill: [dry-run] would flip ${slug} idea → ready in capability-backlog.md`);
    return { changed: true };
  }
  writeFileSync(BACKLOG_FILE, lines.join("\n"));
  return { changed: true };
}

function diffLineCounts(before, after) {
  if (before === after) return { added: 0, removed: 0 };
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  return { added: Math.max(0, afterLines.length - beforeLines.length), removed: Math.max(0, beforeLines.length - afterLines.length) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug) fail("usage: grill-write.mjs <idea-slug> --why-us-file <p> --smallest-shape-file <p> [--flip-to-ready] [--dry-run]");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) fail(`invalid idea slug: ${args.slug}`);
  checkPreconditions(args.slug);
  const whyUs = readSectionBody(args.whyUs, "why-us");
  const smallest = readSectionBody(args.smallest, "smallest-shape");
  const target = path.join(IDEAS_DIR, args.slug, "README.md");
  const before = readFileSync(target, "utf8");
  const afterWhy = replaceSection(before, WHY_US_HEADING, whyUs);
  const afterBoth = replaceSection(afterWhy, SMALLEST_SHAPE_HEADING, smallest);
  if (afterBoth === before) {
    console.error(`risoluto-grill: ${args.slug} unchanged — both sections already match input`);
  } else {
    const { added, removed } = diffLineCounts(before, afterBoth);
    console.error(`risoluto-grill: ${args.dryRun ? "[dry-run] " : ""}rewrote 2 section(s) in research/ideas/${args.slug}/README.md (+${added}/-${removed} lines)`);
    writeIdea(args.slug, afterBoth, args.dryRun);
  }
  if (args.flip) flipBacklog(args.slug, args.dryRun);
}

main();
