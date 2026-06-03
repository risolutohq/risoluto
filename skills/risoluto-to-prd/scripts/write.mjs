#!/usr/bin/env node
/**
 * risoluto-to-prd: write the PRD file + flip the roadmap row to building.
 *
 * Stage 1 of docs/research-to-shipping-pipeline.md. Idempotent on re-run:
 * CREATE writes docs/prds/<slug>.md + flips roadmap row (next -> building),
 * commits both files on pipeline/<slug>-prd, pushes, prints gh pr create.
 * SYNC bumps synced_at in the existing PRD (row is already building).
 *
 * The Linear MCP calls themselves happen in the agent — this script handles
 * file IO + git only.
 *
 * Usage:
 *   node skills/risoluto-to-prd/scripts/write.mjs <slug> \
 *     --mode create --body-file <path> --linear-project <url> \
 *     [--dry-run]
 *
 *   node skills/risoluto-to-prd/scripts/write.mjs <slug> \
 *     --mode sync [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { findRowBySlug, parseRoadmap, renderRoadmap, setStatus } from "../../../scripts/roadmap.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const ROADMAP_FILE = path.join(REPO_ROOT, "docs", "roadmap.md");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");

function fail(message) {
  console.error(`risoluto-to-prd: ${message}`);
  process.exit(1);
}

function log(message) {
  console.error(`risoluto-to-prd: ${message}`);
}

function parseArgs(argv) {
  const args = { slug: null, mode: null, bodyFile: null, linearProject: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i];
    else if (a === "--body-file") args.bodyFile = argv[++i];
    else if (a === "--linear-project") args.linearProject = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (!a.startsWith("--") && args.slug == null) args.slug = a;
    else fail(`unknown argument: ${a}`);
  }
  if (!args.slug) fail("usage: write.mjs <slug> --mode create|sync [--body-file <path>] [--linear-project <url>] [--dry-run]");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) fail(`invalid slug: ${args.slug}`);
  if (!["create", "sync"].includes(args.mode)) fail("missing or invalid --mode (create|sync)");
  return args;
}

function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) throw new Error("missing YAML frontmatter");
  const end = raw.indexOf("\n---", 3);
  if (end === -1) throw new Error("unterminated YAML frontmatter");
  return { fm: parseYaml(raw.slice(3, end).replace(/^\r?\n/, "")) ?? {}, body: raw.slice(end + 4).replace(/^\r?\n/, "") };
}

function renderFrontmatter(fm, body) {
  return `---\n${stringifyYaml(fm).trimEnd()}\n---\n${body}`;
}

function nowIso() {
  return new Date().toISOString();
}

function git(args, opts = {}) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: opts.silent ? ["ignore", "pipe", "pipe"] : "pipe" }).trim();
  } catch (err) {
    if (opts.allowFail) return null;
    const stderr = err.stderr?.toString() ?? err.message;
    fail(`git ${args.join(" ")} failed:\n${stderr}`);
  }
}

function checkPreconditions(slug) {
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) fail(`run from the repo root — expected package.json at ${REPO_ROOT}`);
  if (!existsSync(ROADMAP_FILE)) fail(`roadmap not found: ${ROADMAP_FILE}`);
  const model = parseRoadmap(readFileSync(ROADMAP_FILE, "utf8"));
  if (!model.found) fail("roadmap plan table not found in docs/roadmap.md");
  const row = findRowBySlug(model, slug);
  if (!row) fail(`no roadmap row with slug "${slug}" — add the row to docs/roadmap.md first`);
  return model;
}

function ensureCleanWorkingTree(slug) {
  const prdRel = `docs/prds/${slug}.md`;
  const roadmapRel = "docs/roadmap.md";
  const status = git(["status", "--porcelain", "--", prdRel, roadmapRel]);
  if (status) fail(`uncommitted changes at ${prdRel} or ${roadmapRel}:\n${status}\n— commit or stash before running`);
}

function ensureBranchAvailable(branchName) {
  const existing = git(["branch", "--list", branchName]);
  if (existing) fail(`feature branch already exists: ${branchName} — delete it first if re-running CREATE mode`);
}

function writePrdFile(slug, bodyFile, linearProject, dryRun) {
  if (!bodyFile || !existsSync(bodyFile)) fail(`--body-file required and must exist: ${bodyFile}`);
  const body = readFileSync(bodyFile, "utf8").replace(/^\s+/, "").replace(/\s+$/, "") + "\n";
  const fm = {
    slug,
    linear_project: linearProject,
    synced_at: nowIso(),
    source: `docs/roadmap.md#${slug}`,
    status: "draft",
  };
  const out = renderFrontmatter(fm, body);
  const target = path.join(PRDS_DIR, `${slug}.md`);
  if (dryRun) {
    log(`[dry-run] would write ${path.relative(REPO_ROOT, target)} (${out.length} bytes)`);
    return target;
  }
  mkdirSync(PRDS_DIR, { recursive: true });
  writeFileSync(target, out);
  log(`wrote ${path.relative(REPO_ROOT, target)} (${out.length} bytes)`);
  return target;
}

function flipRoadmapRow(slug, linearProject, dryRun) {
  const raw = readFileSync(ROADMAP_FILE, "utf8");
  const model = parseRoadmap(raw);
  const { changed } = setStatus(model, slug, "building", linearProject);
  if (dryRun) {
    log(`[dry-run] would flip roadmap row "${slug}" to building (link: ${linearProject})`);
    return;
  }
  if (!changed) {
    log(`roadmap row "${slug}" already at building — no change`);
    return;
  }
  writeFileSync(ROADMAP_FILE, renderRoadmap(model));
  log(`flipped roadmap row "${slug}" to [building](${linearProject})`);
}

function commitAndPush(slug, branchName, dryRun) {
  const originalBranch = git(["branch", "--show-current"]);
  if (dryRun) {
    log(`[dry-run] would create branch ${branchName} from ${originalBranch}, commit docs/prds/${slug}.md + docs/roadmap.md, push`);
    return { originalBranch, branchName };
  }
  git(["switch", "-c", branchName]);
  git(["add", `docs/prds/${slug}.md`, "docs/roadmap.md"]);
  git(["commit", "-m", `docs: add PRD for ${slug}`]);
  git(["push", "-u", "origin", branchName]);
  log(`pushed branch ${branchName}`);
  git(["switch", originalBranch]);
  log(`returned to branch ${originalBranch}`);
  return { originalBranch, branchName };
}

function suggestPrCommand(slug, branchName) {
  const title = `docs: add PRD for ${slug}`;
  const body = [
    `Adds \`docs/prds/${slug}.md\` and flips the roadmap row for \`${slug}\` to \`building\`.`,
    "",
    "Generated by /risoluto-to-prd (Stage 1 of docs/research-to-shipping-pipeline.md). PRD is canonical in git; Linear Project description is a generated mirror.",
  ].join("\n");
  log("---");
  log("branch pushed but PR NOT opened (skill is operator-driven for PR creation).");
  log("to open the PR, run:");
  log(`  gh pr create --base master --head ${branchName} \\`);
  log(`    --title ${JSON.stringify(title)} \\`);
  log(`    --body ${JSON.stringify(body)}`);
}

function runCreate(args) {
  if (!args.linearProject) fail("--linear-project <url> required for CREATE mode");
  const prdPath = path.join(PRDS_DIR, `${args.slug}.md`);
  if (existsSync(prdPath)) fail(`PRD already exists: docs/prds/${args.slug}.md — CREATE is for new PRDs only; use --mode sync`);
  const branchName = `pipeline/${args.slug}-prd`;

  checkPreconditions(args.slug);
  ensureCleanWorkingTree(args.slug);
  if (!args.dryRun) ensureBranchAvailable(branchName);

  writePrdFile(args.slug, args.bodyFile, args.linearProject, args.dryRun);
  flipRoadmapRow(args.slug, args.linearProject, args.dryRun);
  commitAndPush(args.slug, branchName, args.dryRun);
  if (!args.dryRun) suggestPrCommand(args.slug, branchName);
  log("---");
  log(`CREATE mode complete for ${args.slug}`);
  log(`  Linear: ${args.linearProject}`);
  log(`  branch: ${branchName} (pushed to origin)`);
}

function runSync(args) {
  checkPreconditions(args.slug);
  const prdPath = path.join(PRDS_DIR, `${args.slug}.md`);
  if (!existsSync(prdPath)) fail(`PRD does not exist: docs/prds/${args.slug}.md — cannot sync; use --mode create`);
  const raw = readFileSync(prdPath, "utf8");
  const { fm, body } = splitFrontmatter(raw);
  const prev = fm.synced_at ?? "(unset)";
  const updated = { ...fm, synced_at: nowIso() };
  const out = renderFrontmatter(updated, body);
  if (args.dryRun) {
    log(`[dry-run] would bump synced_at in docs/prds/${args.slug}.md (${prev} → ${updated.synced_at})`);
    return;
  }
  writeFileSync(prdPath, out);
  log(`SYNC mode complete for ${args.slug}`);
  log(`  synced_at: ${prev} → ${updated.synced_at}`);
  log(`  next: commit docs/prds/${args.slug}.md if you want to persist the synced_at bump`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "create") runCreate(args);
  else runSync(args);
}

main();
