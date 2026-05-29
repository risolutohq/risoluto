/**
 * validate:research — Phase 1.1 of the planning-pipeline roadmap.
 *
 * Walks the `research/` corpus and validates the pipeline-owned frontmatter
 * subset of every captured file against the JSON Schemas in
 * `research/.schemas/`. Schemas declare `additionalProperties: true` so the
 * vault is free to carry Obsidian / Web Clipper / Templater fields.
 *
 * Scope:
 *   research/targets/<slug>/README.md           -> target.schema.json
 *   research/targets/<slug>/sources/<name>.md   -> source.schema.json
 *   docs/prds/<slug>.md                         -> prd.schema.json (+ slug-consistency)
 *
 * Empty corpus exits 0 — Phase 1.1's "done" state.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESEARCH_ROOT = path.join(REPO_ROOT, "research");
const SCHEMA_ROOT = path.join(RESEARCH_ROOT, ".schemas");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");

type SchemaKind = "target" | "source" | "prd";

interface FileToValidate {
  absPath: string;
  relPath: string;
  kind: SchemaKind;
}

interface ValidationFailure {
  relPath: string;
  message: string;
  errors?: ErrorObject[];
}

async function loadValidators(ajv: Ajv): Promise<Record<SchemaKind, ValidateFunction>> {
  const kinds: SchemaKind[] = ["target", "source", "prd"];
  const entries = await Promise.all(
    kinds.map(async (kind) => {
      const schemaPath = path.join(SCHEMA_ROOT, `${kind}.schema.json`);
      const raw = await readFile(schemaPath, "utf8");
      return [kind, ajv.compile(JSON.parse(raw) as object)] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<SchemaKind, ValidateFunction>;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function collectTargetFiles(): Promise<FileToValidate[]> {
  const targetsDir = path.join(RESEARCH_ROOT, "targets");
  const slugs = await safeReaddir(targetsDir);
  const files: FileToValidate[] = [];
  for (const slug of slugs) {
    const slugDir = path.join(targetsDir, slug);
    files.push({
      absPath: path.join(slugDir, "README.md"),
      relPath: path.join("targets", slug, "README.md"),
      kind: "target",
    });
    const sourcesDir = path.join(slugDir, "sources");
    const sourceFiles = await safeReaddir(sourcesDir);
    for (const name of sourceFiles) {
      if (!name.endsWith(".md")) continue;
      files.push({
        absPath: path.join(sourcesDir, name),
        relPath: path.join("targets", slug, "sources", name),
        kind: "source",
      });
    }
  }
  return files;
}

async function hasFrontmatter(absPath: string): Promise<boolean> {
  try {
    const raw = await readFile(absPath, "utf8");
    return raw.startsWith("---");
  } catch {
    return false;
  }
}

async function collectPrdFiles(): Promise<FileToValidate[]> {
  const names = await safeReaddir(PRDS_DIR);
  const files: FileToValidate[] = [];
  for (const name of names) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    const absPath = path.join(PRDS_DIR, name);
    if (!(await hasFrontmatter(absPath))) continue;
    files.push({
      absPath,
      relPath: path.join("docs", "prds", name),
      kind: "prd",
    });
  }
  return files;
}

function extractFrontmatter(raw: string): unknown {
  if (!raw.startsWith("---")) {
    throw new Error("missing YAML frontmatter (expected leading ---)");
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error("unterminated YAML frontmatter (missing closing ---)");
  }
  const block = raw.slice(3, end).replace(/^\r?\n/, "");
  return parseYaml(block) ?? {};
}

function checkPrdSlugConsistency(relPath: string, absPath: string, frontmatter: unknown): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const fm = frontmatter as Record<string, unknown>;
  const slug = fm["slug"] as string | undefined;
  const source = fm["source"] as string | undefined;
  const basename = path.basename(absPath, ".md");

  if (slug !== undefined && slug !== basename) {
    failures.push({
      relPath,
      message: `slug mismatch: frontmatter slug "${slug}" does not match filename "${basename}.md"`,
    });
  }
  const expectedSource = `docs/roadmap.md#${slug ?? basename}`;
  if (source !== undefined && source !== expectedSource) {
    failures.push({
      relPath,
      message: `source mismatch: frontmatter source "${source}" should be "${expectedSource}"`,
    });
  }
  return failures;
}

async function validateFile(
  file: FileToValidate,
  validators: Record<SchemaKind, ValidateFunction>,
): Promise<ValidationFailure[]> {
  let raw: string;
  try {
    raw = await readFile(file.absPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [{ relPath: file.relPath, message: `expected file is missing` }];
    }
    throw error;
  }
  let frontmatter: unknown;
  try {
    frontmatter = extractFrontmatter(raw);
  } catch (error) {
    return [{ relPath: file.relPath, message: (error as Error).message }];
  }
  const validate = validators[file.kind];
  const schemaFailures: ValidationFailure[] = [];
  if (!validate(frontmatter)) {
    schemaFailures.push({
      relPath: file.relPath,
      message: `frontmatter failed ${file.kind}.schema.json`,
      errors: validate.errors ?? [],
    });
  }
  if (file.kind === "prd") {
    const slugFailures = checkPrdSlugConsistency(file.relPath, file.absPath, frontmatter);
    return [...schemaFailures, ...slugFailures];
  }
  return schemaFailures;
}

async function warnMissingRoadmapSlugs(prdFiles: FileToValidate[]): Promise<void> {
  if (prdFiles.length === 0) return;

  let roadmapText: string;
  try {
    roadmapText = await readFile(path.join(REPO_ROOT, "docs", "roadmap.md"), "utf8");
  } catch {
    return;
  }

  for (const prd of prdFiles) {
    let raw: string;
    try {
      raw = await readFile(prd.absPath, "utf8");
    } catch {
      continue;
    }
    let fm: Record<string, unknown>;
    try {
      fm = extractFrontmatter(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const status = fm["status"] as string | undefined;
    if (status !== "building" && status !== "shipped") continue;
    const slug = fm["slug"] as string | undefined;
    if (!slug) continue;
    const marker = `<!-- slug:${slug} -->`;
    if (!roadmapText.includes(marker)) {
      console.warn(
        `validate:research: WARNING: PRD "${prd.relPath}" has status "${status}" but no "${marker}" found in docs/roadmap.md`,
      );
    }
  }
}

function printFailure(failure: ValidationFailure): void {
  console.error(`  ${failure.relPath}: ${failure.message}`);
  for (const err of failure.errors ?? []) {
    const loc = err.instancePath || "(root)";
    console.error(`    - ${loc} ${err.message ?? ""}`);
  }
}

async function main(): Promise<void> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validators = await loadValidators(ajv);
  const targetFiles = await collectTargetFiles();
  const prdFiles = await collectPrdFiles();
  const files = [...targetFiles, ...prdFiles];
  if (files.length === 0) {
    console.log("validate:research: empty corpus, nothing to validate.");
    return;
  }
  const failures: ValidationFailure[] = [];
  for (const file of files) {
    const fileFailures = await validateFile(file, validators);
    failures.push(...fileFailures);
  }
  await warnMissingRoadmapSlugs(prdFiles);
  if (failures.length > 0) {
    console.error(`validate:research: ${failures.length} failure(s) found`);
    for (const failure of failures) printFailure(failure);
    process.exitCode = 1;
    return;
  }
  console.log(`validate:research: ${files.length} file(s) OK.`);
}

try {
  await main();
} catch (error) {
  console.error("validate:research: unexpected error");
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
