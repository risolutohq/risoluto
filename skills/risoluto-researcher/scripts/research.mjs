#!/usr/bin/env node
/**
 * risoluto-researcher: capture a URL (+ optional paste) into `research/targets/<slug>/`.
 *
 * Phase 1.3 of docs/research-to-shipping-pipeline.md. Creates folder-shaped target
 * READMEs, source files with pipeline-valid frontmatter, and regenerates
 * `research/INDEX.md` on every run. Idempotent per source — re-runs update
 * derived fields without clobbering operator-owned prose sections.
 *
 * Usage:
 *   node skills/risoluto-researcher/scripts/research.mjs \
 *     --url "https://..." --target-slug "name" --category "peer" \
 *     --source-type "article" --source-slug "slug" \
 *     [--ideas "tag1,tag2"] [--title "Page Title"] \
 *     [--description "Target description"] [--body-file "/path/to/body.md"] \
 *     [--dry-run]
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const TARGETS_DIR = path.join(RESEARCH_DIR, "targets");

const CATEGORIES = new Set(["peer", "reference", "adjacent"]);
const SOURCE_TYPES = new Set(["article", "reddit", "x", "repo", "video", "paper", "talk"]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\//;

function fail(message) {
  console.error(`risoluto-researcher: ${message}`);
  process.exit(1);
}

function parseArgs(raw) {
  const args = {
    url: "",
    targetSlug: "",
    category: "",
    sourceType: "",
    sourceSlug: "",
    ideas: "",
    title: "",
    description: "",
    bodyFile: "",
    dryRun: false,
  };
  let i = 0;
  while (i < raw.length) {
    const flag = raw[i];
    switch (flag) {
      case "--url": { args.url = raw[++i] ?? ""; break; }
      case "--target-slug": { args.targetSlug = raw[++i] ?? ""; break; }
      case "--category": { args.category = raw[++i] ?? ""; break; }
      case "--source-type": { args.sourceType = raw[++i] ?? ""; break; }
      case "--source-slug": { args.sourceSlug = raw[++i] ?? ""; break; }
      case "--ideas": { args.ideas = raw[++i] ?? ""; break; }
      case "--title": { args.title = raw[++i] ?? ""; break; }
      case "--description": { args.description = raw[++i] ?? ""; break; }
      case "--body-file": { args.bodyFile = raw[++i] ?? ""; break; }
      case "--dry-run": { args.dryRun = true; break; }
      default: {
        fail(`unknown flag: ${flag}`);
      }
    }
    i++;
  }
  return args;
}

function validateArgs(args) {
  if (!args.url) fail("--url is required");
  if (!URL_RE.test(args.url)) fail(`--url must start with https?://, got: ${args.url}`);
  if (!args.targetSlug) fail("--target-slug is required");
  if (!SLUG_RE.test(args.targetSlug)) fail(`--target-slug must match ${SLUG_RE}, got: ${args.targetSlug}`);
  if (!args.category) fail("--category is required");
  if (!CATEGORIES.has(args.category)) fail(`--category must be one of: ${[...CATEGORIES].join(", ")}, got: ${args.category}`);
  if (!args.sourceType) fail("--source-type is required");
  if (!SOURCE_TYPES.has(args.sourceType)) fail(`--source-type must be one of: ${[...SOURCE_TYPES].join(", ")}, got: ${args.sourceType}`);
  if (!args.sourceSlug) fail("--source-slug is required");
  if (!SLUG_RE.test(args.sourceSlug)) fail(`--source-slug must match ${SLUG_RE}, got: ${args.sourceSlug}`);
}

function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * The Risoluto source sha this capture was researched against — provenance for the
 * dedup step (Step 5.2 compares candidates against docs/roadmap.md + RISOLUTO_FEATURES.md,
 * both tied to the PARENT repo). A later re-run compares this against the current HEAD to
 * tell when a target's dedup has gone stale. Reads the parent repo HEAD, not research/'s
 * own — the submodule's sha would be circular (this file lives in it) and is already
 * implied by last_researched_at. Returns "pending" if HEAD can't be resolved.
 */
function risolutoSourceSha() {
  try {
    const result = execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    return result || "pending";
  } catch {
    return "pending";
  }
}

function parseIdeas(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort();
}

/**
 * Very basic YAML frontmatter block writer. Only writes the subset of types
 * needed by the pipeline schemas — strings, arrays of strings, integers.
 * This avoids pulling in a full YAML library for a tiny write pathway.
 */
function yamlLine(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return `${key}:\n${value.map((v) => `  - ${v}`).join("\n")}`;
  }
  if (typeof value === "number") return `${key}: ${value}`;
  return `${key}: ${String(value)}`;
}

function buildTargetFrontmatter(args, existingSourceCount, allIdeas, sha) {
  const fields = [
    ["slug", args.targetSlug],
    ["canonical_url", args.url],
    ["category", args.category],
    ["last_researched_at", todayYMD()],
    ["last_researched_sha", sha],
    ["ideas", allIdeas],
    ["source_count", existingSourceCount],
  ];
  return `---\n${fields.map(([k, v]) => yamlLine(k, v)).join("\n")}\n---`;
}

function buildSourceFrontmatter(args, capturedAt) {
  const fields = [
    ["target", args.targetSlug],
    ["source_type", args.sourceType],
    ["url", args.url],
    ["captured_at", capturedAt],
    ["captured_by", "risoluto-researcher"],
    ["ideas", parseIdeas(args.ideas)],
  ];
  return `---\n${fields.map(([k, v]) => yamlLine(k, v)).join("\n")}\n---`;
}

function buildTargetBody(args) {
  const desc = args.description || `TODO — one paragraph: what ${args.targetSlug} is, what it ships, why we track it.`;
  return [
    "",
    `# ${args.targetSlug}`,
    "",
    "## What is this target?",
    "",
    desc,
    "",
    "## Capabilities observed",
    "",
    "TODO — bullet list of capabilities seen in `sources/`. Derived from source `ideas:` frontmatter tags.",
    "",
    "## Candidate features",
    "",
    // Flag meanings: new = no roadmap overlap → send to /risoluto-grill; merge = fold into existing roadmap row;
    // supersede = replaces a row (old row should be dropped/updated); skip = already shipped or fully covered.
    "<!-- dedup flags: new=no overlap->grill | merge=fold into existing row | supersede=replaces a row | skip=already shipped/covered -->",
    // AFK job = the value lens; a candidate that serves none is a shiny object (see docs/product-spine.md).
    "<!-- afk jobs: observability-trust | failure-recovery | cost-control | coordination-parallelism | review-handoff -->",
    "",
    "TODO — one bullet per candidate feature extracted from this target. For each, name the AFK job it serves",
    "(the value lens) and fill the dedup flag after comparing against `docs/roadmap.md` rows and",
    "`research/RISOLUTO_FEATURES.md`. A candidate that serves no AFK job belongs under Leech takeaways, not here.",
    "",
    "- <feature name> — <one-line description> [job: <afk-job>] [flag: new|merge|supersede|skip]",
    "",
    "## Leech takeaways",
    "",
    "TODO — what to borrow from this target even if none of its features become roadmap rows.",
    "Focus on framing, patterns, and UX decisions worth stealing regardless of feature overlap.",
    "",
    "- <pattern or UX decision> — <why it's worth borrowing>",
    "",
    "## Sources",
    "",
    `See \`sources/*.md\`.`,
    "",
    "## Analyst notes",
    "",
    "TODO — operator-owned. Not regenerated.",
    "",
  ].join("\n");
}

function buildSourceBody(args, bodyContent) {
  const title = args.title || args.sourceSlug;
  if (bodyContent) {
    return `\n# ${title}\n\n${bodyContent}\n`;
  }
  return [
    "",
    `# ${title}`,
    "",
    "> Source captured from the canonical URL. Replace this with a pasted excerpt or summary.",
    "",
    "## Why this matters for Risoluto",
    "",
    "TODO — one paragraph: what capability does this source show? Which target ships it?",
    "",
    "## Quotes worth tagging",
    "",
    "- TODO",
    "",
    "## Open questions",
    "",
    "- TODO",
    "",
  ].join("\n");
}

async function existingSources(sourcesDir) {
  try {
    const entries = await readdir(sourcesDir);
    return entries.filter((e) => e.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

async function existingIdeas(sourcesDir) {
  /** @type {string[]} */
  const all = [];
  try {
    const entries = await readdir(sourcesDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const raw = await readFile(path.join(sourcesDir, entry), "utf8");
      const fm = extractFrontmatter(raw);
      if (fm && Array.isArray(fm.ideas)) all.push(...fm.ideas);
    }
  } catch {
    // sourcesDir doesn't exist yet — no ideas
  }
  return [...new Set(all)].sort();
}

function extractFrontmatter(raw) {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = raw.slice(3, end);
  return parseFrontmatterBlock(block);
}

/**
 * Minimal YAML frontmatter parser for the fields we need to merge.
 * Handles strings, arrays (dash lists), and integers.
 */
function parseFrontmatterBlock(block) {
  /** @type {Record<string, unknown>} */
  const result = {};
  const lines = block.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.startsWith("#")) { i++; continue; }
    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!keyMatch) { i++; continue; }
    const key = keyMatch[1];
    const rest = keyMatch[2];
    if (rest === "" || rest === "[]") {
      // Could be start of array
      if (rest === "[]") {
        result[key] = [];
      } else if (i + 1 < lines.length && lines[i + 1].startsWith("  - ")) {
        /** @type {string[]} */
        const arr = [];
        while (i + 1 < lines.length && lines[i + 1].startsWith("  - ")) {
          i++;
          arr.push(lines[i].replace(/^\s*-\s*/, ""));
        }
        result[key] = arr;
      } else {
        result[key] = "";
      }
    } else {
      // Scalar value
      const num = Number(rest);
      result[key] = Number.isNaN(num) ? rest : num;
    }
    i++;
  }
  return result;
}

async function regenerateIndex() {
  /** @type {Array<{slug: string, category: string, sources: number, date: string, ideas: string[]}>} */
  const rows = [];
  try {
    const slugs = await readdir(TARGETS_DIR);
    for (const slug of slugs) {
      const readmePath = path.join(TARGETS_DIR, slug, "README.md");
      let raw;
      try {
        raw = await readFile(readmePath, "utf8");
      } catch {
        continue;
      }
      const fm = extractFrontmatter(raw);
      if (!fm) continue;
      const sourcesDir = path.join(TARGETS_DIR, slug, "sources");
      const count = await existingSources(sourcesDir);
      rows.push({
        slug: String(fm.slug ?? slug),
        category: String(fm.category ?? "peer"),
        sources: count,
        date: String(fm.last_researched_at ?? "-"),
        ideas: Array.isArray(fm.ideas) ? fm.ideas : [],
      });
    }
  } catch {
    // TARGETS_DIR doesn't exist — empty index
  }
  rows.sort((a, b) => a.slug.localeCompare(b.slug));

  const header = "| Target | Category | Sources | Last Researched | Ideas |";
  const sep = "| ------ | -------- | ------- | --------------- | ----- |";
  const body = rows.map((r) => {
    const ideasStr = r.ideas.length > 0 ? r.ideas.join(", ") : "-";
    return `| ${r.slug} | ${r.category} | ${r.sources} | ${r.date} | ${ideasStr} |`;
  });

  return `# Research Index\n\n${header}\n${sep}\n${body.join("\n")}\n`;
}

async function writeIndex(indexContent, dryRun) {
  const dest = path.join(RESEARCH_DIR, "INDEX.md");
  const rel = path.relative(REPO_ROOT, dest);
  const action = existsSync(dest) ? "REPAIR" : "WRITE";
  console.log(`  ${action.padEnd(6)} ${rel}`);
  if (!dryRun) {
    await writeFile(dest, indexContent);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);

  if (!existsSync(path.join(REPO_ROOT, "package.json")) || !existsSync(path.join(REPO_ROOT, ".gitmodules"))) {
    fail(`run from the repo root — expected package.json + .gitmodules at ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) {
    fail("research/ submodule is not initialised — run `git submodule update --init research`");
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".schemas"))) {
    fail("research/.schemas/ missing — Phase 1.1 schemas are not present");
  }

  const capturedAt = todayYMD();
  const sha = risolutoSourceSha(); // parent Risoluto repo HEAD — the code version this was researched against

  const targetDir = path.join(TARGETS_DIR, args.targetSlug);
  const sourcesDir = path.join(targetDir, "sources");

  // Count existing sources BEFORE we create the new one (for source_count).
  // But the source file we're writing may already exist (idempotent overwrite),
  // so we need to check: if the file already exists, count stays the same.
  // If it's new, count = existing + 1.
  const sourceFilePath = path.join(sourcesDir, `${args.sourceSlug}.md`);
  const sourceAlreadyExists = existsSync(sourceFilePath);
  const prevSourceCount = await existingSources(sourcesDir);
  const newSourceCount = sourceAlreadyExists ? prevSourceCount : prevSourceCount + 1;

  // Merge ideas: existing sources' ideas + new source's ideas
  const prevIdeas = await existingIdeas(sourcesDir);
  const newIdeas = parseIdeas(args.ideas);
  const allIdeas = [...new Set([...prevIdeas, ...newIdeas])].sort();

  // Read body content
  let bodyContent = "";
  if (args.bodyFile) {
    try {
      bodyContent = await readFile(args.bodyFile, "utf8");
    } catch (error) {
      fail(`cannot read --body-file ${args.bodyFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`risoluto-researcher: ${args.dryRun ? "[dry-run] " : ""}capturing target "${args.targetSlug}" / source "${args.sourceSlug}"`);

  // 1. Write source file
  const sourceFm = buildSourceFrontmatter(args, capturedAt);
  const sourceBody = buildSourceBody(args, bodyContent);
  const sourceContent = `${sourceFm}${sourceBody}`;
  const sourceRel = path.relative(REPO_ROOT, sourceFilePath);
  const sourceAction = sourceAlreadyExists ? "REPAIR" : "WRITE";
  console.log(`  ${sourceAction.padEnd(6)} ${sourceRel}`);
  if (!args.dryRun) {
    await mkdir(path.dirname(sourceFilePath), { recursive: true });
    await writeFile(sourceFilePath, sourceContent);
  }

  // 2. Write target README
  const targetReadmePath = path.join(targetDir, "README.md");
  const targetExists = existsSync(targetReadmePath);
  const targetRel = path.relative(REPO_ROOT, targetReadmePath);

  if (targetExists && !args.dryRun) {
    // Idempotent re-run: update derived fields only, preserve operator-owned body
    const raw = await readFile(targetReadmePath, "utf8");
    const existingFm = extractFrontmatter(raw);
    const operatorSlug = existingFm?.slug ?? args.targetSlug;
    const operatorUrl = existingFm?.canonical_url ?? args.url;
    const operatorCategory = existingFm?.category ?? args.category;

    const updatedFm = [
      "---",
      yamlLine("slug", operatorSlug),
      yamlLine("canonical_url", operatorUrl),
      yamlLine("category", operatorCategory),
      yamlLine("last_researched_at", todayYMD()),
      yamlLine("last_researched_sha", sha),
      yamlLine("ideas", allIdeas),
      yamlLine("source_count", newSourceCount),
      "---",
    ].join("\n");

    // Preserve the body after frontmatter
    const bodyStart = raw.indexOf("\n---", 3);
    if (bodyStart !== -1) {
      const preservedBody = raw.slice(bodyStart + 4); // skip "\n---\n"
      const updatedContent = `${updatedFm}\n${preservedBody}`;
      console.log(`  REPAIR  ${targetRel}`);
      if (!args.dryRun) {
        await writeFile(targetReadmePath, updatedContent);
      }
    } else {
      // Malformed — rewrite entirely
      console.log(`  REPAIR  ${targetRel}`);
      if (!args.dryRun) {
        const targetFm = buildTargetFrontmatter(args, newSourceCount, allIdeas, sha);
        const targetBody = buildTargetBody(args);
        await writeFile(targetReadmePath, `${targetFm}${targetBody}`);
      }
    }
  } else {
    console.log(`  ${(targetExists ? "REPAIR" : "WRITE").padEnd(6)} ${targetRel}`);
    if (!args.dryRun) {
      await mkdir(path.dirname(targetReadmePath), { recursive: true });
      const targetFm = buildTargetFrontmatter(args, newSourceCount, allIdeas, sha);
      const targetBody = buildTargetBody(args);
      await writeFile(targetReadmePath, `${targetFm}${targetBody}`);
    }
  }

  // 3. Regenerate INDEX.md
  const indexContent = await regenerateIndex();
  await writeIndex(indexContent, args.dryRun);

  if (args.dryRun) {
    console.log("risoluto-researcher: dry-run complete — no files written.");
  } else {
    console.log(`risoluto-researcher: target "${args.targetSlug}" / source "${args.sourceSlug}" captured.`);
    console.log("  Run `pnpm validate:research` to verify.");
  }
}

main().catch((error) => {
  console.error("risoluto-researcher: unexpected error");
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
