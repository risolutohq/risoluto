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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchProjectDescription, normalizeForComparison, parsePrdFile, requireApiKey } from "./prd-linear.js";

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
}

function readPushRefsFromStdin(): PushRef[] {
  const input = execSync("cat", { encoding: "utf8" });
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

async function checkPrdDrift(apiKey: string, relPath: string): Promise<DriftResult> {
  const absPath = path.join(REPO_ROOT, relPath);
  const { frontmatter, body } = await parsePrdFile(absPath);

  const project = await fetchProjectDescription(apiKey, frontmatter.slugId);
  const localNormalized = normalizeForComparison(body);
  const remoteNormalized = normalizeForComparison(project.description ?? "");

  if (localNormalized === remoteNormalized) {
    return { prdFile: relPath, slug: frontmatter.slug, linearProject: frontmatter.linearProject, status: "match" };
  }

  return {
    prdFile: relPath,
    slug: frontmatter.slug,
    linearProject: frontmatter.linearProject,
    status: "drift",
    detail: `Linear project "${project.name}" description differs from local PRD`,
  };
}

async function main(): Promise<void> {
  const apiKey = requireApiKey();
  if (!apiKey) return;

  const useAll = process.argv.includes("--all");
  const changedPrds = useAll ? getAllPrdFiles() : getChangedPrdsFromRefs(readPushRefsFromStdin());

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

  for (const result of results) {
    if (result.status === "match") {
      process.stderr.write(`  ✅ ${result.prdFile} — in sync\n`);
    } else if (result.status === "drift") {
      process.stderr.write(`  ❌ ${result.prdFile} — DRIFT: ${result.detail}\n`);
    } else {
      process.stderr.write(`  ⚠️  ${result.prdFile} — ERROR: ${result.detail}\n`);
    }
  }

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
