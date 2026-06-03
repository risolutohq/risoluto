#!/usr/bin/env node
/**
 * risoluto-to-prd: print the context bundle + mode (create | sync).
 *
 * Stage 1 of docs/research-to-shipping-pipeline.md. Read-only.
 * Reads the roadmap row for <slug> and decides mode:
 *   - docs/prds/<slug>.md does NOT exist  → mode: "create"
 *   - docs/prds/<slug>.md exists          → mode: "sync"
 *
 * Usage:
 *   node skills/risoluto-to-prd/scripts/preload.mjs <slug>
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findRowBySlug, parseRoadmap } from "../../../scripts/roadmap.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const TARGETS_DIR = path.join(RESEARCH_DIR, "targets");
const WIKI_DIR = path.join(RESEARCH_DIR, "wiki");
const FEATURES_FILE = path.join(RESEARCH_DIR, "RISOLUTO_FEATURES.md");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");
const ROADMAP_FILE = path.join(REPO_ROOT, "docs", "roadmap.md");

function fail(message) {
  console.error(`risoluto-to-prd: ${message}`);
  process.exit(1);
}

function checkPreconditions() {
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) {
    fail(`run from the repo root — expected package.json at ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git")) && !existsSync(path.join(RESEARCH_DIR, "README.md"))) {
    fail("research/ submodule is not initialised — run `git submodule update --init research`");
  }
  if (!existsSync(ROADMAP_FILE)) {
    fail(`roadmap not found: ${ROADMAP_FILE}`);
  }
}

/** Extract the first markdown link URL from a cell, or return null. */
function extractResearchPath(researchLink) {
  if (!researchLink || researchLink === "—" || researchLink === "-") return null;
  const match = researchLink.match(/\[.*?\]\((.*?)\)/);
  if (match) return match[1];
  // bare path
  if (researchLink.trim().startsWith("research/")) return researchLink.trim();
  return null;
}

/** Given the Research link cell, find the file on disk and return its relative path or null. */
function resolveResearchPath(researchLink, slug) {
  const linked = extractResearchPath(researchLink);
  if (linked) {
    const abs = path.join(REPO_ROOT, linked);
    if (existsSync(abs)) return linked;
  }
  // Fallback: research/targets/<slug>/README.md
  const targetPath = path.join(TARGETS_DIR, slug, "README.md");
  if (existsSync(targetPath)) return path.relative(REPO_ROOT, targetPath);
  // Fallback: research/wiki/<slug>.md
  const wikiPath = path.join(WIKI_DIR, `${slug}.md`);
  if (existsSync(wikiPath)) return path.relative(REPO_ROOT, wikiPath);
  return null;
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

function main() {
  const slug = process.argv[2];
  if (!slug) fail("usage: preload.mjs <slug>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`invalid slug: ${slug}`);

  checkPreconditions();

  const roadmapRaw = readFileSync(ROADMAP_FILE, "utf8");
  const model = parseRoadmap(roadmapRaw);
  if (!model.found) fail("roadmap plan table not found in docs/roadmap.md — is the file intact?");

  const row = findRowBySlug(model, slug);
  if (!row) fail(`no roadmap row with slug "${slug}" — add the row to docs/roadmap.md first`);

  const [, item, whyNow, size, status, researchLink] = row.cells;

  const researchPath = resolveResearchPath(researchLink ?? "", slug);
  const prdPath = path.join(PRDS_DIR, `${slug}.md`);
  const prdExists = existsSync(prdPath);
  const mode = prdExists ? "sync" : "create";
  const featuresMentions = findFeaturesMentions(slug);

  const bundle = {
    slug,
    mode,
    roadmap_row: {
      item: item ?? "",
      why_now: whyNow ?? "",
      size: size ?? "",
      status: status ?? "",
      research_link: researchLink ?? "",
    },
    research_path: researchPath,
    prd_path: path.relative(REPO_ROOT, prdPath),
    prd_exists: prdExists,
    features_mentions: featuresMentions,
  };

  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);

  const summary = [
    `risoluto-to-prd: preload ${slug} (mode=${mode})`,
    `  roadmap status: ${status ?? "(empty)"}`,
    `  research_path: ${researchPath ?? "(none found)"}`,
    `  RISOLUTO_FEATURES.md mentions: ${featuresMentions.length}`,
    `  prd_exists: ${prdExists}`,
  ].join("\n");
  console.error(summary);
}

main();
