/**
 * prd:drift-check — Phase 3.3 of the planning-pipeline roadmap.
 *
 * Detects drift between local PRD files and their Linear Project descriptions.
 * Runs in two modes:
 *
 *   1. Pre-push (default): reads stdin for pushed refs, diffs changed PRDs
 *      between the remote and local SHAs, and checks each against Linear.
 *   2. CI / PR (--all): checks every PRD file in docs/prds/ against Linear.
 *
 * Exit codes:
 *   0 — no drift detected (or no PRDs changed, or LINEAR_API_KEY unset)
 *   1 — drift detected between at least one PRD and its Linear Project
 *
 * Env vars:
 *   LINEAR_API_KEY      — required (exits 0 with warning if unset)
 *   LINEAR_API_ENDPOINT — optional, defaults to https://api.linear.app/graphql
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffSections, fetchProjectDescription, parsePrdFile, requireApiKey, type SectionDiff } from "./prd-linear.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZERO_SHA = "0000000000000000000000000000000000000000";

interface PushRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

interface DriftResult {
  prdFile: string;
  slug: string;
  linearProject: string;
  status: "match" | "drift" | "error";
  detail?: string;
  sectionDiffs?: SectionDiff[];
}

function isPrdFile(relPath: string): boolean {
  try {
    const content = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
    if (!content.startsWith("---")) return false;
    const end = content.indexOf("\n---", 3);
    if (end === -1) return false;
    return /^linear_project:/m.test(content.slice(3, end));
  } catch {
    return false;
  }
}

function readPushRefsFromStdin(): PushRef[] {
  const input = readFileSync(0, "utf8");
  return input
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(" ");
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

function getDefaultBranch(): string {
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      encoding: "utf8",
      cwd: REPO_ROOT,
    }).trim();
    return ref.replace("refs/remotes/", "");
  } catch {
    return "origin/master";
  }
}

function getChangedPrdsFromRefs(refs: PushRef[]): string[] {
  const changedFiles = new Set<string>();
  const defaultBranch = getDefaultBranch();

  for (const ref of refs) {
    if (ref.localSha === ZERO_SHA) continue;

    const baseRef = ref.remoteSha === ZERO_SHA ? defaultBranch : ref.remoteSha;
    try {
      const diff = execSync(`git diff --name-only ${baseRef}..${ref.localSha} -- docs/prds/`, {
        encoding: "utf8",
        cwd: REPO_ROOT,
      });
      for (const file of diff.trim().split("\n").filter(Boolean)) {
        if (file.endsWith(".md")) changedFiles.add(file);
      }
    } catch {
      // Diff failed — skip this ref
    }
  }

  return [...changedFiles];
}

function getAllPrdFiles(): string[] {
  const output = execSync("git ls-files 'docs/prds/*.md'", { encoding: "utf8", cwd: REPO_ROOT });
  return output.trim().split("\n").filter(Boolean);
}

function formatSectionDiff(diff: SectionDiff): string {
  if (diff.kind === "only-in-local") return `       - ## ${diff.heading} (only in local)\n`;
  if (diff.kind === "only-in-linear") return `       + ## ${diff.heading} (only in Linear)\n`;
  return `       ~ ## ${diff.heading} (differs)\n`;
}

function printResult(result: DriftResult): void {
  if (result.status === "match") {
    process.stderr.write(`  ✅ ${result.prdFile} — in sync\n`);
    return;
  }
  if (result.status === "drift") {
    process.stderr.write(`  ❌ ${result.prdFile} — DRIFT: ${result.detail}\n`);
    for (const diff of result.sectionDiffs ?? []) process.stderr.write(formatSectionDiff(diff));
    return;
  }
  process.stderr.write(`  ⚠️  ${result.prdFile} — ERROR: ${result.detail}\n`);
}

async function checkPrdDrift(apiKey: string, relPath: string): Promise<DriftResult> {
  const absPath = path.join(REPO_ROOT, relPath);
  const { frontmatter, body } = await parsePrdFile(absPath);

  const project = await fetchProjectDescription(apiKey, frontmatter.slugId);
  const sectionDiffs = diffSections(body, project.description ?? "");

  if (sectionDiffs.length === 0) {
    return { prdFile: relPath, slug: frontmatter.slug, linearProject: frontmatter.linearProject, status: "match" };
  }

  return {
    prdFile: relPath,
    slug: frontmatter.slug,
    linearProject: frontmatter.linearProject,
    status: "drift",
    detail: `Linear project "${project.name}" diverges in ${sectionDiffs.length} section(s)`,
    sectionDiffs,
  };
}

async function main(): Promise<void> {
  const apiKey = requireApiKey();

  const useAll = process.argv.includes("--all");
  const allCandidates = useAll ? getAllPrdFiles() : getChangedPrdsFromRefs(readPushRefsFromStdin());
  const changedPrds = allCandidates.filter(isPrdFile);
  const skipped = allCandidates.filter((p) => !isPrdFile(p));

  for (const skip of skipped) {
    process.stderr.write(`  ⏭️  ${skip} — skipped (no linear_project frontmatter)\n`);
  }

  if (changedPrds.length === 0) {
    process.stderr.write("📋 No PRD files changed — skipping drift check.\n");
    return;
  }

  process.stderr.write(`📋 Checking ${changedPrds.length} PRD file(s) for drift...\n`);

  const results: DriftResult[] = [];
  for (const prdPath of changedPrds) {
    try {
      results.push(await checkPrdDrift(apiKey, prdPath));
    } catch (error) {
      results.push({
        prdFile: prdPath,
        slug: path.basename(prdPath, ".md"),
        linearProject: "",
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const drifted = results.filter((result) => result.status === "drift");
  const errors = results.filter((result) => result.status === "error");

  for (const result of results) printResult(result);

  if (errors.length > 0) {
    process.stderr.write(`\n⚠️  ${errors.length} PRD(s) had errors — failing check.\n`);
    process.exit(1);
  }

  if (drifted.length > 0) {
    process.stderr.write(`\n❌ ${drifted.length} PRD(s) drifted from Linear.\n`);
    process.stderr.write("   Fix with one of:\n");
    process.stderr.write("   • pnpm prd:reconcile <slug>  — adopt the Linear edit\n");
    process.stderr.write("   • /risoluto-to-prd <slug>    — overwrite Linear from git\n");
    process.exit(1);
  }

  process.stderr.write("✅ All PRDs in sync with Linear.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`prd:drift-check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
