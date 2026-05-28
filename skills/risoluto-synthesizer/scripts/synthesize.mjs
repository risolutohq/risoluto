#!/usr/bin/env node
/**
 * risoluto-synthesizer: roll captured targets into idea clusters.
 *
 * Phase 2.1 of docs/research-to-shipping-pipeline.md. Full-corpus, idempotent.
 * Reads every research/targets/<slug>/{README.md,sources/*.md}, groups by
 * the `ideas:` frontmatter tag, and rewrites:
 *
 *   research/ideas/<slug>/README.md
 *   docs/capability-backlog.md  (only the synthesizer-owned idea-rows block)
 *
 * Operator-owned sections (Analyst notes, Open questions, Why us / why now,
 * Smallest shippable shape) and operator-set backlog statuses
 * (ready, in-flight, shipped) are preserved verbatim across runs.
 *
 * Usage:
 *   node skills/risoluto-synthesizer/scripts/synthesize.mjs [--dry-run]
 *
 *   --dry-run  Print the plan, write nothing.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const TARGETS_DIR = path.join(RESEARCH_DIR, "targets");
const IDEAS_DIR = path.join(RESEARCH_DIR, "ideas");
const BACKLOG_FILE = path.join(REPO_ROOT, "docs", "capability-backlog.md");

const SYNTH_BEGIN = "<!-- BEGIN risoluto-synthesizer -->";
const SYNTH_END = "<!-- END risoluto-synthesizer -->";
const BACKLOG_BEGIN = "<!-- BEGIN risoluto-synthesizer:idea-rows -->";
const BACKLOG_END = "<!-- END risoluto-synthesizer:idea-rows -->";
const OPERATOR_STATUSES = new Set(["ready", "in-flight", "shipped"]);

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

function fail(message) {
  console.error(`risoluto-synthesizer: ${message}`);
  process.exit(1);
}

function checkPreconditions() {
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) {
    fail(`run from the repo root — expected package.json at ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) {
    fail("research/ submodule is not initialised — run `git submodule update --init research`");
  }
  if (!existsSync(TARGETS_DIR)) {
    fail("research/targets/ does not exist — capture targets via /risoluto-researcher first");
  }
  if (!existsSync(BACKLOG_FILE)) {
    fail(`expected docs/capability-backlog.md at ${BACKLOG_FILE}`);
  }
}

async function safeReaddir(dir) {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) throw new Error("missing YAML frontmatter");
  const end = raw.indexOf("\n---", 3);
  if (end === -1) throw new Error("unterminated YAML frontmatter");
  const block = raw.slice(3, end).replace(/^\r?\n/, "");
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  return { data: parseYaml(block) ?? {}, body };
}

async function collectCorpus() {
  const slugs = (await safeReaddir(TARGETS_DIR)).sort();
  /** @type {Map<string, { targets: Set<string>, sources: Set<string> }>} */
  const ideaMap = new Map();
  for (const slug of slugs) {
    const targetReadme = path.join(TARGETS_DIR, slug, "README.md");
    if (!existsSync(targetReadme)) continue;
    const { data } = parseFrontmatter(await readFile(targetReadme, "utf8"));
    for (const idea of data.ideas ?? []) {
      pushEvidence(ideaMap, idea, { target: slug });
    }
    const sourcesDir = path.join(TARGETS_DIR, slug, "sources");
    for (const name of (await safeReaddir(sourcesDir)).sort()) {
      if (!name.endsWith(".md")) continue;
      const { data: sourceData } = parseFrontmatter(await readFile(path.join(sourcesDir, name), "utf8"));
      const sourcePath = `targets/${slug}/sources/${name}`;
      for (const idea of sourceData.ideas ?? []) {
        pushEvidence(ideaMap, idea, { source: sourcePath });
      }
    }
  }
  return ideaMap;
}

function pushEvidence(map, ideaSlug, evidence) {
  if (!map.has(ideaSlug)) map.set(ideaSlug, { targets: new Set(), sources: new Set() });
  const entry = map.get(ideaSlug);
  if (evidence.target) entry.targets.add(evidence.target);
  if (evidence.source) entry.sources.add(evidence.source);
}

function titleCase(slug) {
  return slug
    .split("-")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

function buildSynthesizerBlock(ideaSlug, evidenceTargets, evidenceSources) {
  if (evidenceTargets.length === 0) {
    return [
      SYNTH_BEGIN,
      "## Evidence",
      "",
      "_No evidence in the current corpus — this idea was orphaned by a re-tag. Operator-owned sections are preserved._",
      "",
      "## Targets that ship this",
      "",
      "_None._",
      "",
      "## Variants observed",
      "",
      "_None._",
      "",
      "## Frequency",
      "",
      "0 target(s) · 0 source(s)",
      SYNTH_END,
    ].join("\n");
  }
  const sourceLinks = evidenceSources.map((p) => `- [${p}](../../${p})`);
  const targetLinks = evidenceTargets.map((t) => `- [${t}](../../targets/${t}/README.md)`);
  const sourcesByTarget = groupSourcesByTarget(evidenceSources);
  const variants = evidenceTargets.map((t) => {
    const refs = (sourcesByTarget.get(t) ?? []).map((p) => `[${path.basename(p)}](../../${p})`);
    const tail = refs.length === 0 ? "_target-level tag only_" : refs.join(", ");
    return `- **${t}** — ${tail}`;
  });
  return [
    SYNTH_BEGIN,
    "## Evidence",
    "",
    ...sourceLinks,
    "",
    "## Targets that ship this",
    "",
    ...targetLinks,
    "",
    "## Variants observed",
    "",
    "_Synthesizer regenerates this list from `evidence_targets`. An LLM follow-up pass can enrich each bullet with how the target implements the idea — re-running the script will rewrite the list back to this skeleton, so capture enriched prose in `## Analyst notes` (operator-owned) instead._",
    "",
    ...variants,
    "",
    "## Frequency",
    "",
    `${evidenceTargets.length} target(s) · ${evidenceSources.length} source(s)`,
    SYNTH_END,
  ].join("\n");
}

function groupSourcesByTarget(sourcePaths) {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const p of sourcePaths) {
    const match = p.match(/^targets\/([^/]+)\/sources\//);
    if (!match) continue;
    const target = match[1];
    if (!map.has(target)) map.set(target, []);
    map.get(target).push(p);
  }
  return map;
}

function operatorTemplate() {
  return [
    "",
    "## Analyst notes",
    "",
    "<!-- operator-owned: not regenerated -->",
    "",
    "## Open questions",
    "",
    "<!-- operator-owned: not regenerated -->",
    "",
    "## Why us / why now",
    "",
    "<!-- operator-owned: filled by /risoluto-grill -->",
    "",
    "## Smallest shippable shape",
    "",
    "<!-- operator-owned: filled by /risoluto-grill -->",
    "",
  ].join("\n");
}

function splitIdeaReadme(raw) {
  const beginIdx = raw.indexOf(SYNTH_BEGIN);
  const endIdx = raw.indexOf(SYNTH_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return { head: null, tail: null };
  }
  const head = raw.slice(0, beginIdx);
  const tail = raw.slice(endIdx + SYNTH_END.length);
  return { head, tail };
}

function buildIdeaReadme(ideaSlug, evidenceTargets, evidenceSources, existing) {
  const frontmatterData = {
    slug: ideaSlug,
    evidence_targets: evidenceTargets,
    evidence_sources: evidenceSources,
    linear_project: existing?.frontmatter?.linear_project ?? null,
    prd_file: existing?.frontmatter?.prd_file ?? null,
  };
  const fm = `---\n${stringifyYaml(frontmatterData)}---\n`;
  const synth = buildSynthesizerBlock(ideaSlug, evidenceTargets, evidenceSources);
  let head = `\n# ${ideaSlug}\n\n`;
  let tail = operatorTemplate();
  if (existing?.split?.head != null) {
    const operatorHead = stripBodyFrontmatter(existing.split.head);
    if (operatorHead.trim().length > 0) head = operatorHead;
  }
  if (existing?.split?.tail != null) {
    const trimmedTail = existing.split.tail.replace(/^\n+/, "\n");
    if (trimmedTail.trim().length > 0) tail = trimmedTail;
  }
  return `${fm}${head}${synth}${tail}`.replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
}

function stripBodyFrontmatter(headWithBody) {
  if (!headWithBody.startsWith("---")) return headWithBody;
  const end = headWithBody.indexOf("\n---", 3);
  if (end === -1) return headWithBody;
  return headWithBody.slice(end + 4).replace(/^\r?\n/, "");
}

async function readExistingIdea(ideaSlug) {
  const readmePath = path.join(IDEAS_DIR, ideaSlug, "README.md");
  if (!existsSync(readmePath)) return null;
  const raw = await readFile(readmePath, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const split = splitIdeaReadme(raw);
  return { frontmatter: data, body, split, raw };
}

async function writeIdeaReadme(ideaSlug, content) {
  const dir = path.join(IDEAS_DIR, ideaSlug);
  if (DRY_RUN) return;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "README.md"), content);
}

async function listExistingIdeas() {
  return (await safeReaddir(IDEAS_DIR)).sort();
}

function parseBacklogRows(block) {
  /** @type {Map<string, { name: string, category: string, status: string, evidenceIdea: string }>} */
  const rows = new Map();
  for (const line of block.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // table row shape: ['', slug, name, category, status, evidenceIdea, '']
    if (cells.length < 7) continue;
    const [, slug, name, category, status, evidenceIdea] = cells;
    if (slug === "slug" || slug.startsWith("---")) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) continue;
    rows.set(slug, { name, category, status, evidenceIdea });
  }
  return rows;
}

function renderBacklogTable(rows) {
  const slugs = [...rows.keys()].sort();
  if (slugs.length === 0) {
    return `${BACKLOG_BEGIN}\n\n_No idea rows yet — capture targets via /risoluto-researcher then run /risoluto-synthesizer._\n\n${BACKLOG_END}`;
  }
  const headers = ["slug", "name", "category", "status", "evidence_idea"];
  const data = slugs.map((slug) => {
    const r = rows.get(slug);
    return [slug, r.name, r.category, r.status, r.evidenceIdea];
  });
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((row) => row[i].length), 4));
  const renderRow = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
  const divider = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  const lines = [renderRow(headers), divider, ...data.map(renderRow)];
  return `${BACKLOG_BEGIN}\n\n${lines.join("\n")}\n\n${BACKLOG_END}`;
}

function mergeBacklogRows(existing, activeSlugs, orphanSlugs) {
  /** @type {Map<string, { name: string, category: string, status: string, evidenceIdea: string }>} */
  const merged = new Map();
  for (const slug of activeSlugs) {
    const prev = existing.get(slug);
    const status = prev && OPERATOR_STATUSES.has(prev.status) ? prev.status : "idea";
    merged.set(slug, {
      name: prev?.name && prev.name.length > 0 ? prev.name : titleCase(slug),
      category: prev?.category && prev.category.length > 0 ? prev.category : "TBD",
      status,
      evidenceIdea: `research/ideas/${slug}/README.md`,
    });
  }
  for (const slug of orphanSlugs) {
    const prev = existing.get(slug);
    const status = prev && OPERATOR_STATUSES.has(prev.status) ? prev.status : "dropped";
    merged.set(slug, {
      name: prev?.name && prev.name.length > 0 ? prev.name : titleCase(slug),
      category: prev?.category && prev.category.length > 0 ? prev.category : "TBD",
      status,
      evidenceIdea: `research/ideas/${slug}/README.md`,
    });
  }
  return merged;
}

async function updateBacklog(activeSlugs, orphanSlugs) {
  const raw = await readFile(BACKLOG_FILE, "utf8");
  const existingRows = extractExistingBacklogRows(raw);
  const merged = mergeBacklogRows(existingRows, activeSlugs, orphanSlugs);
  const table = renderBacklogTable(merged);
  const next = spliceBacklogBlock(raw, table);
  if (DRY_RUN || next === raw) return { changed: next !== raw };
  await writeFile(BACKLOG_FILE, next);
  return { changed: true };
}

function extractExistingBacklogRows(raw) {
  const beginIdx = raw.indexOf(BACKLOG_BEGIN);
  const endIdx = raw.indexOf(BACKLOG_END);
  if (beginIdx === -1 || endIdx === -1) return new Map();
  const block = raw.slice(beginIdx + BACKLOG_BEGIN.length, endIdx);
  return parseBacklogRows(block);
}

function spliceBacklogBlock(raw, table) {
  const beginIdx = raw.indexOf(BACKLOG_BEGIN);
  const endIdx = raw.indexOf(BACKLOG_END);
  if (beginIdx !== -1 && endIdx !== -1) {
    return `${raw.slice(0, beginIdx)}${table}${raw.slice(endIdx + BACKLOG_END.length)}`;
  }
  const placeholder = "_(Empty at v1 cut. First entries land after the curated snapshot import surfaces reusable code and after the first dogfood Workflow Run reveals real pain.)_";
  if (raw.includes(placeholder)) return raw.replace(placeholder, table);
  const heading = "## Initial Entries";
  const idx = raw.indexOf(heading);
  if (idx === -1) return `${raw.trimEnd()}\n\n${heading}\n\n${table}\n`;
  const after = raw.indexOf("\n", idx + heading.length);
  return `${raw.slice(0, after + 1)}\n${table}\n${raw.slice(after + 1)}`;
}

async function main() {
  checkPreconditions();
  const ideaMap = await collectCorpus();
  const activeSlugs = [...ideaMap.keys()].sort();
  const existingIdeaSlugs = await listExistingIdeas();
  const orphanSlugs = existingIdeaSlugs.filter((s) => !ideaMap.has(s)).sort();
  console.log(
    `risoluto-synthesizer: ${DRY_RUN ? "[dry-run] " : ""}${activeSlugs.length} idea(s) with evidence, ${orphanSlugs.length} orphan(s)`,
  );
  for (const slug of activeSlugs) {
    const entry = ideaMap.get(slug);
    const targets = [...entry.targets].sort();
    const sources = [...entry.sources].sort();
    const existing = await readExistingIdea(slug);
    const next = buildIdeaReadme(slug, targets, sources, existing);
    const action = existing == null ? "WRITE" : next === existing.raw ? "KEEP" : "REPAIR";
    console.log(`  ${action.padEnd(6)} research/ideas/${slug}/README.md  (${targets.length} target/${sources.length} source)`);
    if (action !== "KEEP") await writeIdeaReadme(slug, next);
  }
  for (const slug of orphanSlugs) {
    const existing = await readExistingIdea(slug);
    const next = buildIdeaReadme(slug, [], [], existing);
    const action = next === existing?.raw ? "KEEP" : "REPAIR";
    console.log(`  ${action.padEnd(6)} research/ideas/${slug}/README.md  (orphan)`);
    if (action !== "KEEP") await writeIdeaReadme(slug, next);
  }
  const backlogResult = await updateBacklog(activeSlugs, orphanSlugs);
  console.log(
    `risoluto-synthesizer: docs/capability-backlog.md ${backlogResult.changed ? (DRY_RUN ? "would update" : "updated") : "unchanged"}`,
  );
  reportThinTargets();
}

function reportThinTargets() {
  const slugs = readdirSyncSafe(TARGETS_DIR);
  const thin = [];
  for (const slug of slugs) {
    const readme = path.join(TARGETS_DIR, slug, "README.md");
    if (!existsSync(readme)) continue;
    try {
      const { data } = parseFrontmatter(readFileSync(readme, "utf8"));
      const count = (data.ideas ?? []).length;
      if (count < 2) thin.push({ slug, count });
    } catch {
      // skip parse errors — validate:research surfaces them
    }
  }
  if (thin.length === 0) return;
  console.log("risoluto-synthesizer: thin targets (<2 ideas tagged) — agent should propose new tags before re-running:");
  for (const { slug, count } of thin) console.log(`  - ${slug} (${count} idea(s))`);
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

main().catch((error) => {
  console.error("risoluto-synthesizer: unexpected error");
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
