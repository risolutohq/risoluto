#!/usr/bin/env node
/**
 * risoluto-vault: apply the canonical Obsidian config into `research/`.
 *
 * Phase 1.2 of docs/research-to-shipping-pipeline.md. Idempotent — repeated
 * runs detect drift and restore the canonical bytes from
 * `skills/risoluto-vault/assets/` without clobbering operator-owned files
 * (currently just `.obsidian/appearance.json`).
 *
 * Usage:
 *   node skills/risoluto-vault/scripts/apply.mjs [--dry-run] [--force]
 *
 *   --dry-run  Print the plan, write nothing.
 *   --force    Apply even when `research/` has uncommitted changes.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS_DIR = path.join(SKILL_DIR, "assets");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const FORCE = args.has("--force");

/** @typedef {{ src: string, dest: string, mode: "canonical" | "seed-only" }} Plan */

function fail(message) {
  console.error(`risoluto-vault: ${message}`);
  process.exit(1);
}

function checkPreconditions() {
  if (!existsSync(path.join(REPO_ROOT, "package.json")) || !existsSync(path.join(REPO_ROOT, ".gitmodules"))) {
    fail(`run from the repo root — expected package.json + .gitmodules at ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) {
    fail("research/ submodule is not initialised — run `git submodule update --init research`");
  }
  if (FORCE) return;
  let porcelain = "";
  try {
    porcelain = execSync("git status --porcelain", { cwd: RESEARCH_DIR, encoding: "utf8" }).trim();
  } catch (error) {
    fail(`could not read research/ git status: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (porcelain.length > 0) {
    console.error("risoluto-vault: research/ has uncommitted changes — commit/stash first, or re-run with --force:");
    for (const line of porcelain.split("\n")) console.error(`  ${line}`);
    process.exit(1);
  }
}

/** Files that have been retired from the canonical set and must not be deployed. */
const EXCLUDED_ASSETS = new Set(["idea-readme.md", "ideas-thin-evidence.md"]);

async function listAssetFiles(subdir) {
  const dir = path.join(ASSETS_DIR, subdir);
  const entries = await readdir(dir);
  return entries.filter((name) => !EXCLUDED_ASSETS.has(name)).map((name) => path.join(dir, name));
}

async function buildPlan() {
  /** @type {Plan[]} */
  const plan = [];
  for (const src of await listAssetFiles("obsidian-config")) {
    const name = path.basename(src);
    const mode = name === "appearance.json" ? "seed-only" : "canonical";
    plan.push({ src, dest: path.join(RESEARCH_DIR, ".obsidian", name), mode });
  }
  for (const src of await listAssetFiles("templates")) {
    plan.push({ src, dest: path.join(RESEARCH_DIR, "templates", path.basename(src)), mode: "canonical" });
  }
  for (const src of await listAssetFiles("dataview")) {
    plan.push({ src, dest: path.join(RESEARCH_DIR, "views", path.basename(src)), mode: "canonical" });
  }
  return plan;
}

/** @returns {Promise<"WRITE" | "REPAIR" | "KEEP">} */
async function classify(entry) {
  if (!existsSync(entry.dest)) return "WRITE";
  if (entry.mode === "seed-only") return "KEEP";
  const [srcBytes, destBytes] = await Promise.all([readFile(entry.src), readFile(entry.dest)]);
  return srcBytes.equals(destBytes) ? "KEEP" : "REPAIR";
}

async function applyEntry(entry, action) {
  if (action === "KEEP") return;
  if (DRY_RUN) return;
  await mkdir(path.dirname(entry.dest), { recursive: true });
  const bytes = await readFile(entry.src);
  await writeFile(entry.dest, bytes);
}

function readPinnedPlugins() {
  const pinned = path.join(ASSETS_DIR, "obsidian-config", "community-plugins.json");
  const raw = readFileSync(pinned, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) fail("community-plugins.json must be a JSON array of plugin ids");
  return parsed;
}

function checkPlugin(id) {
  const pluginDir = path.join(RESEARCH_DIR, ".obsidian", "plugins", id);
  try {
    return statSync(pluginDir).isDirectory();
  } catch {
    return false;
  }
}

function reportPluginGaps(missing) {
  if (missing.length === 0) return;
  console.log(
    `risoluto-vault: ${missing.length} community plugin(s) not yet installed — open the vault in Obsidian and install:`,
  );
  for (const id of missing) console.log(`  - ${id}`);
}

function summarise(actions, missingPlugins) {
  const counts = { WRITE: 0, REPAIR: 0, KEEP: 0 };
  for (const a of actions) counts[a] += 1;
  const verb = DRY_RUN ? "would write" : "written";
  const verb2 = DRY_RUN ? "would repair" : "repaired";
  console.log(
    `risoluto-vault: ${counts.WRITE} file(s) ${verb}, ${counts.REPAIR} ${verb2}, ${counts.KEEP} kept.`,
  );
  reportPluginGaps(missingPlugins);
}

async function main() {
  checkPreconditions();
  console.log(`risoluto-vault: ${DRY_RUN ? "[dry-run] " : ""}applying canonical config to research/`);
  const plan = await buildPlan();
  const actions = [];
  for (const entry of plan) {
    const action = await classify(entry);
    actions.push(action);
    const rel = path.relative(REPO_ROOT, entry.dest);
    console.log(`  ${action.padEnd(6)} ${rel}`);
    await applyEntry(entry, action);
  }
  const missingPlugins = readPinnedPlugins().filter((id) => !checkPlugin(id));
  summarise(actions, missingPlugins);
}

main().catch((error) => {
  console.error("risoluto-vault: unexpected error");
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
