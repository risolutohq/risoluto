#!/usr/bin/env node
/**
 * risoluto-ingest: build a connected research wiki and emit gap-grounded roadmap idea rows.
 *
 * Mode B of docs/research-to-shipping-pipeline.md. Full-corpus, idempotent.
 * Reads every research/targets/<slug>/README.md and research/targets/<slug>/sources/*.md,
 * clusters by the `ideas:` frontmatter tag (each distinct tag = a CONCEPT), then:
 *
 *   1. Writes research/wiki/<concept>.md — summary placeholder, Targets wikilinks, Gap placeholder.
 *   2. Writes research/wiki/home.md     — index table of all concept notes.
 *   3. Appends idea rows to docs/roadmap.md via scripts/roadmap.mjs (idempotent by slug).
 *
 * Usage:
 *   node skills/risoluto-ingest/scripts/ingest.mjs                 # append a row for every concept
 *   node skills/risoluto-ingest/scripts/ingest.mjs --require-job   # cite-or-drop: only concepts whose
 *                                                                  # evidencing target declares a `job:`
 *
 * Without --require-job (the default), every concept still gets a roadmap row, but jobless concepts are
 * reported so the cite-or-drop gap is visible instead of silently promoted.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { parseRoadmap, appendRow, renderRoadmap } from "../../../scripts/roadmap.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "../..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const TARGETS_DIR = path.join(RESEARCH_DIR, "targets");
const WIKI_DIR = path.join(RESEARCH_DIR, "wiki");
const ROADMAP_FILE = path.join(REPO_ROOT, "docs", "roadmap.md");

// ---------------------------------------------------------------------------
// Precondition check
// ---------------------------------------------------------------------------

function checkPreconditions() {
  if (!existsSync(path.join(REPO_ROOT, "package.json")) || !existsSync(path.join(REPO_ROOT, ".gitmodules"))) {
    console.error("risoluto-ingest: run from the repo root (expected package.json and .gitmodules).");
    process.exit(1);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) {
    console.error(
      "risoluto-ingest: research/ submodule is not initialised — run `git submodule update --init research` or `/init-research`.",
    );
    process.exit(1);
  }
  if (!existsSync(TARGETS_DIR)) {
    console.error(
      "risoluto-ingest: research/targets/ does not exist — capture targets via /risoluto-researcher first. No corpus to ingest.",
    );
    process.exit(1);
  }
  const slugs = safeReaddirSync(TARGETS_DIR).filter((s) => existsSync(path.join(TARGETS_DIR, s, "README.md")));
  if (slugs.length === 0) {
    console.error(
      "risoluto-ingest: research/targets/ is empty — capture targets via /risoluto-researcher first. No corpus to ingest.",
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeReaddirSync(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

async function safeReaddir(dir) {
  try {
    return await readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(3, end).replace(/^\r?\n/, "");
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  return { data: parseYaml(block) ?? {}, body };
}

function titleCase(slug) {
  return slug
    .split("-")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Corpus walk
// ---------------------------------------------------------------------------

/**
 * Walk all targets and sources; cluster by the `ideas:` frontmatter tag and record each target's
 * optional AFK `job:`.
 * @returns {Promise<{ conceptMap: Map<string, Set<string>>, targetJobs: Map<string, string>, targetBodies: Map<string, string> }>}
 *   conceptMap: concept -> set of target slugs that evidence it.
 *   targetJobs: target slug -> the `job:` it declares (only targets that declare one).
 *   targetBodies: target slug -> the README body text (frontmatter stripped), for evidence extraction.
 */
async function buildConceptMap() {
  const targetSlugs = (await safeReaddir(TARGETS_DIR)).sort();
  /** @type {Map<string, Set<string>>} */
  const conceptMap = new Map();
  /** @type {Map<string, string>} */
  const targetJobs = new Map();
  /** @type {Map<string, string>} */
  const targetBodies = new Map();

  for (const slug of targetSlugs) {
    const readmePath = path.join(TARGETS_DIR, slug, "README.md");
    if (!existsSync(readmePath)) continue;

    const raw = await readFile(readmePath, "utf8");
    const { data, body } = parseFrontmatter(raw);
    targetBodies.set(slug, body);
    if (typeof data.job === "string" && data.job.trim()) targetJobs.set(slug, data.job.trim());
    for (const tag of data.ideas ?? []) {
      addConcept(conceptMap, tag, slug);
    }

    const sourcesDir = path.join(TARGETS_DIR, slug, "sources");
    for (const name of (await safeReaddir(sourcesDir)).sort()) {
      if (!name.endsWith(".md")) continue;
      const sourceRaw = await readFile(path.join(sourcesDir, name), "utf8");
      const { data: sourceData } = parseFrontmatter(sourceRaw);
      for (const tag of sourceData.ideas ?? []) {
        addConcept(conceptMap, tag, slug);
      }
    }
  }

  return { conceptMap, targetJobs, targetBodies };
}

/**
 * The set of AFK jobs a concept inherits from the targets that evidence it.
 * @param {string} concept
 * @param {Map<string, Set<string>>} conceptMap
 * @param {Map<string, string>} targetJobs
 * @returns {Set<string>}
 */
function conceptJobs(concept, conceptMap, targetJobs) {
  const jobs = new Set();
  for (const target of conceptMap.get(concept) ?? []) {
    if (targetJobs.has(target)) jobs.add(targetJobs.get(target));
  }
  return jobs;
}

function addConcept(map, concept, targetSlug) {
  if (!map.has(concept)) map.set(concept, new Set());
  map.get(concept).add(targetSlug);
}

// ---------------------------------------------------------------------------
// Wiki generation
// ---------------------------------------------------------------------------

/**
 * The first sentence of a target README body that mentions the concept (slug or its spaced form).
 * Returns null when no sentence references the concept — keeps cite-or-drop honest.
 * @param {string} body
 * @param {string} concept
 * @returns {string | null}
 */
function firstEvidenceSentence(body, concept) {
  if (!body) return null;
  const needle = concept.toLowerCase();
  const altNeedle = concept.replace(/-/g, " ").toLowerCase();
  const sentences = body
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (lower.includes(needle) || lower.includes(altNeedle)) return sentence;
  }
  return null;
}

function buildConceptNote(concept, targets, targetBodies) {
  const sortedTargets = [...targets].sort();
  const wikilinks = sortedTargets.map((t) => `- [[targets/${t}]]`).join("\n");

  const evidence = sortedTargets
    .map((t) => {
      const sentence = firstEvidenceSentence(targetBodies.get(t) ?? "", concept);
      return sentence
        ? `- **[[targets/${t}]]**: ${sentence}`
        : `- **[[targets/${t}]]**: <!-- risoluto-ingest: no sentence in this target mentions "${concept}" — add the citation or drop the target -->`;
    })
    .join("\n");

  return [
    `# ${titleCase(concept)}`,
    "",
    "<!-- risoluto-ingest: one-paragraph summary placeholder — fill in at run time -->",
    "",
    "## Targets",
    "",
    wikilinks || "_None._",
    "",
    "## Evidence",
    "",
    evidence || "<!-- risoluto-ingest: no evidencing targets -->",
    "",
    "## Gap",
    "",
    "<!-- risoluto-ingest: gap placeholder — what none of these targets do, or do poorly, or what composing them enables -->",
    "",
  ].join("\n");
}

function buildHomeNote(concepts) {
  const rows = [...concepts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([concept, targets]) => {
      const wikiNote = `[[${concept}]]`;
      return `| ${wikiNote} | ${targets.size} | <!-- one-line summary --> |`;
    });

  const tableLines = [
    "| Concept | Target count | Summary |",
    "| ------- | ------------ | ------- |",
    ...rows,
  ];

  return [
    "# Research Wiki — Home",
    "",
    "> Generated by `/risoluto-ingest`. Re-run after adding targets to refresh.",
    "",
    tableLines.join("\n"),
    "",
  ].join("\n");
}

async function writeWikiNotes(conceptMap, targetBodies) {
  await mkdir(WIKI_DIR, { recursive: true });

  /** @type {{ concept: string, action: string }[]} */
  const results = [];

  for (const [concept, targets] of conceptMap) {
    const notePath = path.join(WIKI_DIR, `${concept}.md`);
    const content = buildConceptNote(concept, targets, targetBodies);
    const existing = existsSync(notePath) ? readFileSync(notePath, "utf8") : null;
    const action = existing === null ? "WROTE" : "KEPT";
    // Always overwrite — wiki is rebuilt from scratch on every run (idempotent).
    await writeFile(notePath, content);
    results.push({ concept, action });
  }

  const homeContent = buildHomeNote(conceptMap);
  await writeFile(path.join(WIKI_DIR, "home.md"), homeContent);

  return results;
}

// ---------------------------------------------------------------------------
// Roadmap idea rows
// ---------------------------------------------------------------------------

/**
 * Append one idea row per concept. With requireJob, concepts whose evidencing targets declare no
 * `job:` are GATED (cite-or-drop) instead of promoted. Returns a summary of actions.
 * @param {Map<string, Set<string>>} conceptMap
 * @param {Map<string, string>} targetJobs
 * @param {boolean} requireJob
 * @returns {{ concept: string, action: string }[]}
 */
function appendRoadmapRows(conceptMap, targetJobs, requireJob) {
  const raw = readFileSync(ROADMAP_FILE, "utf8");
  const model = parseRoadmap(raw);

  if (!model.found) {
    console.error("risoluto-ingest: could not locate the roadmap plan table in docs/roadmap.md — aborting roadmap update.");
    return [];
  }

  /** @type {{ concept: string, action: string }[]} */
  const results = [];

  for (const [concept] of conceptMap) {
    if (requireJob && conceptJobs(concept, conceptMap, targetJobs).size === 0) {
      results.push({ concept, action: "GATED" });
      continue;
    }
    const researchLink = `research/wiki/${concept}.md`;
    const { added } = appendRow(model, {
      slug: concept,
      item: titleCase(concept),
      researchLink,
    });
    results.push({ concept, action: added ? "ADDED" : "SKIPPED" });
  }

  writeFileSync(ROADMAP_FILE, renderRoadmap(model));
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  checkPreconditions();

  const requireJob = process.argv.includes("--require-job");
  const { conceptMap, targetJobs, targetBodies } = await buildConceptMap();

  if (conceptMap.size === 0) {
    console.log(
      "risoluto-ingest: no `ideas:` tags found across any target or source. Tag targets with `ideas:` frontmatter to generate concepts.",
    );
    console.log("  Tip: run /risoluto-researcher to capture a target, or add `ideas:` tags to existing READMEs.");
    process.exit(0);
  }

  console.log(`risoluto-ingest: ${conceptMap.size} concept(s) found across corpus.`);

  const wikiResults = await writeWikiNotes(conceptMap, targetBodies);
  for (const { concept, action } of wikiResults) {
    console.log(`  ${action.padEnd(6)} research/wiki/${concept}.md`);
  }
  console.log(`  WROTE  research/wiki/home.md`);

  const roadmapResults = appendRoadmapRows(conceptMap, targetJobs, requireJob);
  for (const { concept, action } of roadmapResults) {
    console.log(`  ${action.padEnd(6)} roadmap row  slug:${concept}`);
  }

  // Cite-or-drop visibility: surface concepts with no AFK job behind them. Under --require-job they
  // were GATED above; by default they were still promoted, so name them rather than dropping silently.
  const joblessConcepts = [...conceptMap.keys()].filter((c) => conceptJobs(c, conceptMap, targetJobs).size === 0);
  if (joblessConcepts.length > 0) {
    console.log(
      `\nrisoluto-ingest: ${joblessConcepts.length} concept(s) with no AFK \`job:\` on any evidencing target` +
        `${requireJob ? " — GATED out of the roadmap (cite-or-drop)" : " — promoted anyway; re-run --require-job to gate, or tag the target via /risoluto-researcher --job"}:`,
    );
    for (const concept of joblessConcepts) {
      console.log(`  - ${concept}`);
    }
  }

  const thinConcepts = [...conceptMap.entries()].filter(([, targets]) => targets.size < 2);
  if (thinConcepts.length > 0) {
    console.log(
      `\nrisoluto-ingest: ${thinConcepts.length} thin concept(s) (only 1 target) — agent should verify the gap is real before promoting:`,
    );
    for (const [concept] of thinConcepts) {
      console.log(`  - ${concept} (${conceptMap.get(concept).size} target)`);
    }
  }

  console.log("\nrisoluto-ingest: done. Review research/wiki/home.md and docs/roadmap.md (idea rows).");
}

main().catch((err) => {
  console.error("risoluto-ingest: unexpected error");
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
