#!/usr/bin/env node
/**
 * risoluto-to-issues: print the context bundle for PRD → Linear Issues.
 *
 * Phase 4.1 of docs/research-to-shipping-pipeline.md. Read-only.
 * Gathers the PRD body, source idea, and backlog row so the agent
 * can extract slices and create Linear Issues.
 *
 * Usage:
 *   node skills/risoluto-to-issues/scripts/preload.mjs <prd-slug>
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const BACKLOG_FILE = path.join(REPO_ROOT, "docs", "capability-backlog.md");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");

function fail(message) {
  console.error(`risoluto-to-issues: ${message}`);
  process.exit(1);
}

function checkPreconditions(slug) {
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) {
    fail(`run from the repo root — expected package.json at ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) {
    fail("research/ submodule is not initialised — run `git submodule update --init research`");
  }
  if (!existsSync(path.join(PRDS_DIR, `${slug}.md`))) {
    fail(`PRD not found: docs/prds/${slug}.md — run /risoluto-to-prd ${slug} first`);
  }
  if (!existsSync(BACKLOG_FILE)) fail(`expected docs/capability-backlog.md at ${BACKLOG_FILE}`);
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) throw new Error("missing YAML frontmatter");
  const end = raw.indexOf("\n---", 3);
  if (end === -1) throw new Error("unterminated YAML frontmatter");
  return parseYaml(raw.slice(3, end).replace(/^\r?\n/, "")) ?? {};
}

function readPrd(slug) {
  const prdPath = path.join(PRDS_DIR, `${slug}.md`);
  const raw = readFileSync(prdPath, "utf8");
  const fm = parseFrontmatter(raw);
  const fmEnd = raw.indexOf("\n---", 3);
  const bodyStart = raw.indexOf("\n", fmEnd + 3) + 1;
  const body = raw.slice(bodyStart);
  return {
    path: path.relative(REPO_ROOT, prdPath),
    body,
    linear_project: fm.linear_project ?? null,
    source_idea: fm.source_idea ?? null,
  };
}

function findBacklogRow(slug) {
  const lines = readFileSync(BACKLOG_FILE, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 6 || cells[1] !== slug) continue;
    return { slug, name: cells[2], category: cells[3], status: cells[4] };
  }
  return null;
}

function main() {
  const slug = process.argv[2];
  if (!slug) fail("usage: preload.mjs <prd-slug>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`invalid PRD slug: ${slug}`);
  checkPreconditions(slug);

  const prd = readPrd(slug);
  if (!prd.linear_project) {
    fail(`PRD docs/prds/${slug}.md has no linear_project — run /risoluto-to-prd ${slug} first`);
  }

  const ideaPath = prd.source_idea ?? `research/ideas/${slug}/README.md`;
  const ideaFullPath = path.join(REPO_ROOT, ideaPath);
  const ideaExists = existsSync(ideaFullPath);

  const backlogRow = findBacklogRow(slug);

  const bundle = {
    slug,
    linear_project: prd.linear_project,
    prd_path: prd.path,
    prd_body: prd.body,
    source_idea: prd.source_idea,
    idea_path: ideaExists ? ideaPath : null,
    category: backlogRow?.category ?? null,
    backlog_row: backlogRow,
  };

  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);

  const summary = [
    `risoluto-to-issues: preload ${slug}`,
    `  linear_project: ${prd.linear_project}`,
    `  prd_body: ${prd.body.split("\n").length} lines`,
    `  source_idea: ${prd.source_idea ?? "(none)"}`,
    `  idea_exists: ${ideaExists}`,
    `  category: ${backlogRow?.category ?? "(no backlog row)"}`,
    `  backlog status: ${backlogRow?.status ?? "(no row)"}`,
  ].join("\n");
  console.error(summary);
}

main();
