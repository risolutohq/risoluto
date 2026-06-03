#!/usr/bin/env node
/**
 * risoluto-to-issues: print the context bundle for PRD → Linear Issues.
 *
 * Stage 2 of docs/research-to-shipping-pipeline.md. Read-only.
 * Gathers the PRD body, roadmap row, and derived category so the agent
 * can extract slices and create Linear Issues.
 *
 * Usage:
 *   node skills/risoluto-to-issues/scripts/preload.mjs <prd-slug>
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { parseRoadmap, findRowBySlug } from "../../../scripts/roadmap.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");
const ROADMAP_FILE = path.join(REPO_ROOT, "docs", "roadmap.md");

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
    prd_path: path.relative(REPO_ROOT, prdPath),
    body,
    linear_project: fm.linear_project ?? null,
    source: fm.source ?? null,
  };
}

/** Extract an explicit Category line from the PRD body, e.g. "**Category:** foo". */
function extractCategoryFromBody(body) {
  const match = body.match(/^\*{0,2}[Cc]ategory[:\*]{0,2}\s*\**\s*(.+?)\s*\**\s*$/m);
  return match ? match[1].trim() : null;
}

/** Derive a category from the roadmap Item cell (first word of the title). */
function inferCategoryFromItem(itemCell) {
  // Strip the slug comment and any markdown link syntax, then take the first word
  const clean = itemCell
    .replace(/<!--.*?-->/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
  return clean.split(/\s+/)[0]?.toLowerCase() ?? null;
}

function readRoadmapRow(slug) {
  if (!existsSync(ROADMAP_FILE)) return null;
  const raw = readFileSync(ROADMAP_FILE, "utf8");
  const model = parseRoadmap(raw);
  const row = findRowBySlug(model, slug);
  if (!row) return null;
  const [, item, whyNow, size, status, researchLink] = row.cells;
  return { item: item ?? "", why_now: whyNow ?? "", size: size ?? "", status: status ?? "", research_link: researchLink ?? "" };
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

  const roadmapRow = readRoadmapRow(slug);

  const category =
    extractCategoryFromBody(prd.body) ??
    (roadmapRow ? inferCategoryFromItem(roadmapRow.item) : null);

  const bundle = {
    slug,
    linear_project: prd.linear_project,
    prd_path: prd.prd_path,
    prd_body: prd.body,
    source: prd.source,
    roadmap_row: roadmapRow,
    category,
  };

  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);

  const summary = [
    `risoluto-to-issues: preload ${slug}`,
    `  linear_project : ${prd.linear_project}`,
    `  prd_body       : ${prd.body.split("\n").length} lines`,
    `  source         : ${prd.source ?? "(none)"}`,
    `  roadmap_row    : ${roadmapRow ? `${roadmapRow.item} [${roadmapRow.status}]` : "(not in roadmap)"}`,
    `  category       : ${category ?? "(not derived)"}`,
  ].join("\n");
  console.error(summary);
}

main();
