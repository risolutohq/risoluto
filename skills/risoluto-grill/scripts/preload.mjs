#!/usr/bin/env node
/**
 * risoluto-grill: print the context bundle for grilling an idea.
 *
 * Phase 3.1 of docs/planning-pipeline-roadmap.md. Read-only.
 * Emits JSON listing every file the agent should load before opening the
 * grill loop: the idea README, every cited target README + source, the
 * matching backlog row, and any RISOLUTO_FEATURES.md entries that mention
 * the idea slug. The agent reads the files itself via standard tooling.
 *
 * Usage:
 *   node skills/risoluto-grill/scripts/preload.mjs <idea-slug>
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

function fail(message) {
  console.error(`risoluto-grill: ${message}`);
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
  if (!existsSync(BACKLOG_FILE)) {
    fail(`expected docs/capability-backlog.md at ${BACKLOG_FILE}`);
  }
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) throw new Error("missing YAML frontmatter");
  const end = raw.indexOf("\n---", 3);
  if (end === -1) throw new Error("unterminated YAML frontmatter");
  const block = raw.slice(3, end).replace(/^\r?\n/, "");
  return parseYaml(block) ?? {};
}

function readIdea(slug) {
  const ideaPath = path.join(IDEAS_DIR, slug, "README.md");
  const fm = parseFrontmatter(readFileSync(ideaPath, "utf8"));
  return {
    path: path.relative(REPO_ROOT, ideaPath),
    evidence_targets: fm.evidence_targets ?? [],
    evidence_sources: fm.evidence_sources ?? [],
    linear_project: fm.linear_project ?? null,
    prd_file: fm.prd_file ?? null,
  };
}

function collectTargetPaths(targetSlugs) {
  const paths = [];
  for (const slug of targetSlugs) {
    const readmePath = path.join(TARGETS_DIR, slug, "README.md");
    if (existsSync(readmePath)) {
      paths.push(path.relative(REPO_ROOT, readmePath));
    }
  }
  return paths;
}

function collectSourcePaths(sourcePaths) {
  const out = [];
  for (const rel of sourcePaths) {
    const abs = path.join(RESEARCH_DIR, rel);
    if (existsSync(abs)) out.push(path.relative(REPO_ROOT, abs));
  }
  return out;
}

function findFeaturesMentions(slug) {
  if (!existsSync(FEATURES_FILE)) return [];
  const raw = readFileSync(FEATURES_FILE, "utf8");
  const lines = raw.split("\n");
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

function findBacklogRow(slug) {
  const raw = readFileSync(BACKLOG_FILE, "utf8");
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7) continue;
    if (cells[1] === slug) {
      return { slug, name: cells[2], category: cells[3], status: cells[4], evidence_idea: cells[5] };
    }
  }
  return null;
}

function main() {
  const slug = process.argv[2];
  if (!slug) fail("usage: preload.mjs <idea-slug>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`invalid idea slug: ${slug}`);
  checkPreconditions(slug);
  const idea = readIdea(slug);
  const targets = collectTargetPaths(idea.evidence_targets);
  const sources = collectSourcePaths(idea.evidence_sources);
  const features = findFeaturesMentions(slug);
  const backlog = findBacklogRow(slug);
  const bundle = {
    slug,
    idea: idea.path,
    evidence_targets: idea.evidence_targets,
    evidence_sources: idea.evidence_sources,
    linear_project: idea.linear_project,
    prd_file: idea.prd_file,
    targets,
    sources,
    features_mentions: features,
    backlog_row: backlog,
    backlog_file: path.relative(REPO_ROOT, BACKLOG_FILE),
  };
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
  const summary = [
    `risoluto-grill: preload ${slug}`,
    `  targets: ${targets.length}`,
    `  sources: ${sources.length}`,
    `  RISOLUTO_FEATURES.md mentions: ${features.length}`,
    `  backlog status: ${backlog?.status ?? "(no row)"}`,
  ].join("\n");
  console.error(summary);
}

main();
