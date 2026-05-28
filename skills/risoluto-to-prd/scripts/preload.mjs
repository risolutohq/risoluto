#!/usr/bin/env node
/**
 * risoluto-to-prd: print the context bundle + mode (create | sync).
 *
 * Phase 3.2 of docs/research-to-shipping-pipeline.md. Read-only.
 * Decides mode from the idea README frontmatter:
 *   - linear_project == null  → mode: "create"  (PRD + Linear Project + PR)
 *   - linear_project set      → mode: "sync"    (overwrite Linear description)
 *
 * Usage:
 *   node skills/risoluto-to-prd/scripts/preload.mjs <idea-slug>
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const IDEAS_DIR = path.join(RESEARCH_DIR, "ideas");
const TARGETS_DIR = path.join(RESEARCH_DIR, "targets");
const FEATURES_FILE = path.join(RESEARCH_DIR, "RISOLUTO_FEATURES.md");
const BACKLOG_FILE = path.join(REPO_ROOT, "docs", "capability-backlog.md");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");

const WHY_US_HEADING = "## Why us / why now";
const SMALLEST_SHAPE_HEADING = "## Smallest shippable shape";

function fail(message) {
  console.error(`risoluto-to-prd: ${message}`);
  process.exit(1);
}

function checkPreconditions(slug) {
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) {
    fail(`run from the repo root — expected package.json at ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) {
    fail("research/ submodule is not initialised — run `git submodule update --init research`");
  }
  if (!existsSync(path.join(IDEAS_DIR, slug, "README.md"))) {
    fail(`idea not found: research/ideas/${slug}/README.md — run /risoluto-synthesizer first`);
  }
  if (!existsSync(BACKLOG_FILE)) fail(`expected docs/capability-backlog.md at ${BACKLOG_FILE}`);
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) throw new Error("missing YAML frontmatter");
  const end = raw.indexOf("\n---", 3);
  if (end === -1) throw new Error("unterminated YAML frontmatter");
  return parseYaml(raw.slice(3, end).replace(/^\r?\n/, "")) ?? {};
}

function readSectionBody(raw, heading) {
  const idx = raw.indexOf(heading);
  if (idx === -1) return null;
  const afterHeading = raw.indexOf("\n", idx + heading.length);
  if (afterHeading === -1) return "";
  const rest = raw.slice(afterHeading + 1);
  const next = rest.search(/\n## /);
  const body = next === -1 ? rest : rest.slice(0, next);
  return body.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function readIdea(slug) {
  const ideaPath = path.join(IDEAS_DIR, slug, "README.md");
  const raw = readFileSync(ideaPath, "utf8");
  const fm = parseFrontmatter(raw);
  return {
    path: path.relative(REPO_ROOT, ideaPath),
    raw,
    evidence_targets: fm.evidence_targets ?? [],
    evidence_sources: fm.evidence_sources ?? [],
    linear_project: fm.linear_project ?? null,
    prd_file: fm.prd_file ?? null,
    why_us_filled: (readSectionBody(raw, WHY_US_HEADING) ?? "").length > 0,
    smallest_shape_filled: (readSectionBody(raw, SMALLEST_SHAPE_HEADING) ?? "").length > 0,
  };
}

function collectTargetPaths(targetSlugs) {
  return targetSlugs
    .map((s) => path.join(TARGETS_DIR, s, "README.md"))
    .filter(existsSync)
    .map((p) => path.relative(REPO_ROOT, p));
}

function collectSourcePaths(sourcePaths) {
  return sourcePaths.map((rel) => path.join(RESEARCH_DIR, rel)).filter(existsSync).map((p) => path.relative(REPO_ROOT, p));
}

function findFeaturesMentions(slug) {
  if (!existsSync(FEATURES_FILE)) return [];
  const lines = readFileSync(FEATURES_FILE, "utf8").split("\n");
  const needles = [slug.toLowerCase(), slug.replace(/-/g, " ").toLowerCase()];
  return lines.flatMap((line, i) => {
    const lower = line.toLowerCase();
    return needles.some((n) => lower.includes(n)) ? [{ line: i + 1, text: line.trim() }] : [];
  });
}

function findBacklogRow(slug) {
  const lines = readFileSync(BACKLOG_FILE, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7 || cells[1] !== slug) continue;
    return { slug, name: cells[2], category: cells[3], status: cells[4], evidence_idea: cells[5] };
  }
  return null;
}

function main() {
  const slug = process.argv[2];
  if (!slug) fail("usage: preload.mjs <idea-slug>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`invalid idea slug: ${slug}`);
  checkPreconditions(slug);
  const idea = readIdea(slug);
  const mode = idea.linear_project ? "sync" : "create";
  const prdPath = path.join(PRDS_DIR, `${slug}.md`);
  const prdExists = existsSync(prdPath);
  const bundle = {
    slug,
    mode,
    idea: idea.path,
    why_us_filled: idea.why_us_filled,
    smallest_shape_filled: idea.smallest_shape_filled,
    evidence_targets: idea.evidence_targets,
    evidence_sources: idea.evidence_sources,
    linear_project: idea.linear_project,
    prd_file: idea.prd_file,
    prd_path: path.relative(REPO_ROOT, prdPath),
    prd_exists: prdExists,
    targets: collectTargetPaths(idea.evidence_targets),
    sources: collectSourcePaths(idea.evidence_sources),
    features_mentions: findFeaturesMentions(slug),
    backlog_row: findBacklogRow(slug),
    backlog_file: path.relative(REPO_ROOT, BACKLOG_FILE),
  };
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
  const summary = [
    `risoluto-to-prd: preload ${slug} (mode=${mode})`,
    `  targets: ${bundle.targets.length}`,
    `  sources: ${bundle.sources.length}`,
    `  RISOLUTO_FEATURES.md mentions: ${bundle.features_mentions.length}`,
    `  backlog status: ${bundle.backlog_row?.status ?? "(no row)"}`,
    `  why_us_filled: ${idea.why_us_filled}`,
    `  smallest_shape_filled: ${idea.smallest_shape_filled}`,
    `  linear_project: ${idea.linear_project ?? "(none)"}`,
    `  prd_exists: ${prdExists}`,
  ].join("\n");
  console.error(summary);
}

main();
