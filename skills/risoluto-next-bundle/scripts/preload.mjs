#!/usr/bin/env node
/**
 * risoluto-next-bundle: emit a starter manifest of known PRDs for the agent to
 * query Linear against at run time.
 *
 * Reads every docs/prds/<slug>.md (excluding README.md), extracts YAML
 * frontmatter (slug, status, linear_project), derives the Linear label
 * "from:prd-<slug>", and optionally annotates with the roadmap Item title via
 * scripts/roadmap.mjs.
 *
 * Usage:
 *   node skills/risoluto-next-bundle/scripts/preload.mjs
 *
 * Stdout: JSON { prds: [...] }
 * Stderr: one-line summary
 * Exit 0 always (no PRDs is a valid clean state, not an error).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { parseRoadmap, slugFromItem } from "../../../scripts/roadmap.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");
const ROADMAP_FILE = path.join(REPO_ROOT, "docs", "roadmap.md");

/** Extract YAML frontmatter from a markdown file. Returns {} on any failure. */
function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return {};
  try {
    return parseYaml(raw.slice(3, end).replace(/^\r?\n/, "")) ?? {};
  } catch {
    return {};
  }
}

/** Build a slug -> roadmap Item title map from docs/roadmap.md. */
function buildRoadmapIndex() {
  if (!existsSync(ROADMAP_FILE)) return {};
  const model = parseRoadmap(readFileSync(ROADMAP_FILE, "utf8"));
  /** @type {Record<string, string>} */
  const index = {};
  for (const row of model.rows) {
    if (row.slug) {
      // Item cell is cells[1]; strip the slug comment to get the display title.
      const itemCell = row.cells[1] ?? "";
      const title = itemCell.replace(/<!--\s*slug:[a-z0-9][a-z0-9-]*\s*-->/, "").trim();
      index[row.slug] = title;
    }
  }
  return index;
}

function checkPreconditions() {
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) {
    process.stderr.write(
      "risoluto-next-bundle: run from the repo root — package.json not found\n",
    );
    process.exit(1);
  }
  if (!existsSync(PRDS_DIR)) {
    process.stderr.write(
      "risoluto-next-bundle: docs/prds/ not found — no PRDs exist yet; run /risoluto-to-prd first\n",
    );
    process.exit(0);
  }
}

function listPrdFiles() {
  return readdirSync(PRDS_DIR)
    .filter((name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md")
    .map((name) => path.join(PRDS_DIR, name));
}

function buildPrdEntry(filePath, roadmapIndex) {
  const raw = readFileSync(filePath, "utf8");
  const fm = parseFrontmatter(raw);
  const slug = fm.slug ?? path.basename(filePath, ".md");
  return {
    slug,
    status: fm.status ?? null,
    linear_project: fm.linear_project ?? null,
    label: `from:prd-${slug}`,
    roadmap_item: roadmapIndex[slug] ?? null,
  };
}

function main() {
  checkPreconditions();

  const prdFiles = listPrdFiles();

  if (prdFiles.length === 0) {
    process.stderr.write("risoluto-next-bundle: 0 PRDs found — nothing to bundle\n");
    process.stdout.write(JSON.stringify({ prds: [] }, null, 2) + "\n");
    return;
  }

  const roadmapIndex = buildRoadmapIndex();
  const prds = prdFiles.map((f) => buildPrdEntry(f, roadmapIndex));

  const statusSummary = prds.map((p) => p.status ?? "unknown").join(", ");
  process.stderr.write(
    `risoluto-next-bundle: ${prds.length} PRD(s) found [${statusSummary}]\n`,
  );

  process.stdout.write(JSON.stringify({ prds }, null, 2) + "\n");
}

main();
