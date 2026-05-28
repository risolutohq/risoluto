#!/usr/bin/env node
/**
 * risoluto-to-prd: write the PRD file + idea README frontmatter,
 * and (in CREATE mode) open a PR for the PRD file.
 *
 * Phase 3.2 of docs/research-to-shipping-pipeline.md. Idempotent on re-run:
 * CREATE creates Linear Project + PRD + PR; SYNC overwrites the existing
 * PRD's synced_at after the agent has pushed the existing body to Linear.
 *
 * The Linear MCP calls themselves happen in the agent — this script handles
 * file IO + git only.
 *
 * Usage:
 *   node skills/risoluto-to-prd/scripts/write.mjs <idea-slug> \
 *     --mode create --body-file <path> --linear-project <url> \
 *     [--linear-name <name>] [--dry-run]
 *
 *   node skills/risoluto-to-prd/scripts/write.mjs <idea-slug> \
 *     --mode sync [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const IDEAS_DIR = path.join(RESEARCH_DIR, "ideas");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");

function fail(message) {
  console.error(`risoluto-to-prd: ${message}`);
  process.exit(1);
}

function log(message) {
  console.error(`risoluto-to-prd: ${message}`);
}

function parseArgs(argv) {
  const args = { slug: null, mode: null, bodyFile: null, linearProject: null, linearName: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i];
    else if (a === "--body-file") args.bodyFile = argv[++i];
    else if (a === "--linear-project") args.linearProject = argv[++i];
    else if (a === "--linear-name") args.linearName = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (!a.startsWith("--") && args.slug == null) args.slug = a;
    else fail(`unknown argument: ${a}`);
  }
  if (!args.slug) fail("missing <idea-slug>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) fail(`invalid idea slug: ${args.slug}`);
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

function git(cwd, args, opts = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: opts.silent ? ["ignore", "pipe", "pipe"] : "pipe" }).trim();
  } catch (err) {
    if (opts.allowFail) return null;
    const stderr = err.stderr?.toString() ?? err.message;
    fail(`git ${args.join(" ")} (in ${path.relative(REPO_ROOT, cwd) || "."}) failed:\n${stderr}`);
  }
}

function checkPreconditionsCommon(slug) {
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) fail(`run from the repo root — expected package.json at ${REPO_ROOT}`);
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) fail("research/ submodule not initialised");
  const ideaPath = path.join(IDEAS_DIR, slug, "README.md");
  if (!existsSync(ideaPath)) fail(`idea not found: ${path.relative(REPO_ROOT, ideaPath)}`);
}

function readIdeaFm(slug) {
  const ideaPath = path.join(IDEAS_DIR, slug, "README.md");
  return { ideaPath, ...splitFrontmatter(readFileSync(ideaPath, "utf8")) };
}

function nowIso() {
  return new Date().toISOString();
}

function buildPrdFrontmatter(slug, linearProject, statusFromExisting) {
  return {
    slug,
    linear_project: linearProject,
    synced_at: nowIso(),
    source_idea: `research/ideas/${slug}/README.md`,
    status: statusFromExisting ?? "draft",
  };
}

function ensureCleanSuperprojectTargets(slug) {
  // Only check the PRD path. Submodule pointer drift in `research` is benign here
  // — the submodule's own clean-tree state is checked by ensureCleanSubmodule().
  const status = git(REPO_ROOT, ["status", "--porcelain", "--", `docs/prds/${slug}.md`]);
  if (status) fail(`superproject has uncommitted changes at docs/prds/${slug}.md:\n${status}\n— commit or stash before running`);
}

function ensureCleanSubmodule() {
  const status = git(RESEARCH_DIR, ["status", "--porcelain"]);
  if (status) fail(`research/ submodule has uncommitted changes:\n${status}\n— commit or stash before running`);
  const branch = git(RESEARCH_DIR, ["branch", "--show-current"]);
  if (branch !== "master") fail(`research/ submodule is on branch "${branch}" — expected "master" before running`);
}

function ensureBranchAvailable(branchName) {
  const existing = git(REPO_ROOT, ["branch", "--list", branchName]);
  if (existing) fail(`feature branch already exists: ${branchName} — delete it first if re-running CREATE mode`);
}

function writePrdFile(slug, bodyFile, linearProject, dryRun) {
  if (!bodyFile || !existsSync(bodyFile)) fail(`--body-file required and must exist: ${bodyFile}`);
  const body = readFileSync(bodyFile, "utf8").replace(/^\s+/, "").replace(/\s+$/, "") + "\n";
  const fm = buildPrdFrontmatter(slug, linearProject, null);
  const out = renderFrontmatter(fm, body);
  const target = path.join(PRDS_DIR, `${slug}.md`);
  if (dryRun) {
    log(`[dry-run] would write ${path.relative(REPO_ROOT, target)} (${out.length} bytes)`);
    return target;
  }
  writeFileSync(target, out);
  log(`wrote ${path.relative(REPO_ROOT, target)} (${out.length} bytes)`);
  return target;
}

function updateIdeaReadme(slug, linearProject, dryRun) {
  const { ideaPath, fm, body } = readIdeaFm(slug);
  const updated = { ...fm, linear_project: linearProject, prd_file: `docs/prds/${slug}.md` };
  const out = renderFrontmatter(updated, body);
  if (dryRun) {
    log(`[dry-run] would update ${path.relative(REPO_ROOT, ideaPath)} frontmatter (linear_project, prd_file)`);
    return;
  }
  writeFileSync(ideaPath, out);
  log(`updated ${path.relative(REPO_ROOT, ideaPath)} frontmatter`);
}

function commitSubmodule(slug, linearProject, dryRun) {
  if (dryRun) {
    log(`[dry-run] would commit research/ submodule (master) linking ${slug} → ${linearProject}`);
    return;
  }
  git(RESEARCH_DIR, ["add", `ideas/${slug}/README.md`]);
  const subject = `research: link ${slug} idea to PRD (linear_project)`;
  git(RESEARCH_DIR, ["commit", "-m", subject]);
  log(`committed research/ submodule: ${subject}`);
}

function commitAndPushSuperproject(slug, branchName, dryRun) {
  const originalBranch = git(REPO_ROOT, ["branch", "--show-current"]);
  if (dryRun) {
    log(`[dry-run] would create branch ${branchName} from ${originalBranch}, commit docs/prds/${slug}.md, push`);
    return { originalBranch, branchName };
  }
  git(REPO_ROOT, ["switch", "-c", branchName]);
  git(REPO_ROOT, ["add", `docs/prds/${slug}.md`]);
  const subject = `docs: add PRD for ${slug}`;
  git(REPO_ROOT, ["commit", "-m", subject]);
  // --recurse-submodules=no: the submodule's linear_project commit lives only locally
  // until the operator pushes it explicitly. Default git behaviour ("check") refuses
  // the superproject push in that state — we want to push the PRD branch regardless.
  git(REPO_ROOT, ["push", "--recurse-submodules=no", "-u", "origin", branchName]);
  log(`pushed superproject branch ${branchName}`);
  git(REPO_ROOT, ["switch", originalBranch]);
  log(`returned to branch ${originalBranch}`);
  return { originalBranch, branchName };
}

function suggestPrCommand(slug, branchName) {
  // The skill stops short of `gh pr create` by design — opening the PR is an operator
  // decision (memory: feedback-skills-no-auto-pr). Print the command they would run.
  const title = `docs: add PRD for ${slug}`;
  const body = [
    `Adds docs/prds/${slug}.md and links the idea README at research/ideas/${slug}/README.md to its matching Linear Project.`,
    "",
    "Generated by /risoluto-to-prd (Phase 3.2 of docs/research-to-shipping-pipeline.md). PRD is canonical in git; Linear Project description is a generated mirror.",
    "",
    "## Next step for the operator",
    "",
    `- Push the research/ submodule (git -C research push origin master) so the merged superproject's submodule pointer references a SHA that exists on risolutohq/risoluto-research.`,
  ].join("\n");
  log("---");
  log(`branch pushed but PR NOT opened (skill is operator-driven for PR creation).`);
  log(`to open the PR, run:`);
  log(`  gh pr create --base master --head ${branchName} \\`);
  log(`    --title ${JSON.stringify(title)} \\`);
  log(`    --body ${JSON.stringify(body)}`);
}

function runCreate(args) {
  checkPreconditionsCommon(args.slug);
  if (!args.linearProject) fail("--linear-project <url> required for CREATE mode");
  const { fm: ideaFm } = readIdeaFm(args.slug);
  if (ideaFm.linear_project) fail(`idea README already has linear_project=${ideaFm.linear_project} — use --mode sync, or null it first`);
  const prdPath = path.join(PRDS_DIR, `${args.slug}.md`);
  if (existsSync(prdPath)) fail(`PRD already exists: ${path.relative(REPO_ROOT, prdPath)} — CREATE is for new PRDs only`);
  const branchName = `pipeline/${args.slug}-prd`;
  ensureCleanSuperprojectTargets(args.slug);
  ensureCleanSubmodule();
  ensureBranchAvailable(branchName);
  writePrdFile(args.slug, args.bodyFile, args.linearProject, args.dryRun);
  updateIdeaReadme(args.slug, args.linearProject, args.dryRun);
  commitSubmodule(args.slug, args.linearProject, args.dryRun);
  commitAndPushSuperproject(args.slug, branchName, args.dryRun);
  if (!args.dryRun) suggestPrCommand(args.slug, branchName);
  log("---");
  log(`CREATE mode complete for ${args.slug}`);
  log(`  Linear: ${args.linearProject}`);
  log(`  branch: ${branchName} (pushed to origin)`);
  log(`  next: open the PR with the command above, and push the research/ submodule (\`git -C research push origin master\`).`);
}

function runSync(args) {
  checkPreconditionsCommon(args.slug);
  const { fm: ideaFm } = readIdeaFm(args.slug);
  if (!ideaFm.linear_project) fail("idea README has no linear_project — use --mode create, not sync");
  const prdPath = path.join(PRDS_DIR, `${args.slug}.md`);
  if (!existsSync(prdPath)) fail(`PRD does not exist: ${path.relative(REPO_ROOT, prdPath)} — cannot sync`);
  const raw = readFileSync(prdPath, "utf8");
  const { fm, body } = splitFrontmatter(raw);
  const updated = { ...fm, synced_at: nowIso() };
  const out = renderFrontmatter(updated, body);
  if (args.dryRun) {
    log(`[dry-run] would bump synced_at in ${path.relative(REPO_ROOT, prdPath)} (${fm.synced_at} → ${updated.synced_at})`);
    return;
  }
  writeFileSync(prdPath, out);
  log(`SYNC mode complete for ${args.slug}`);
  log(`  synced_at: ${fm.synced_at ?? "(unset)"} → ${updated.synced_at}`);
  log(`  Linear project (already linked): ${ideaFm.linear_project}`);
  log(`  next: commit docs/prds/${args.slug}.md if you want to persist the synced_at bump`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "create") runCreate(args);
  else runSync(args);
}

main();
