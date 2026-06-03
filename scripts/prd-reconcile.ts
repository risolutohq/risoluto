/**
 * prd:reconcile — Phase 3.3 of the planning-pipeline roadmap.
 *
 * Adopts a Linear Project content edit back into git:
 *   1. Fetches the current Linear Project content
 *   2. Writes it into docs/prds/<slug>.md (replacing the body, keeping frontmatter)
 *   3. Creates a branch, commits, pushes, and prints a `gh pr create` command
 *
 * Usage: pnpm prd:reconcile <slug>
 *
 * Env vars:
 *   LINEAR_API_KEY      — required
 *   LINEAR_API_ENDPOINT — optional, defaults to https://api.linear.app/graphql
 */

import { execFileSync, execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchProjectPrdMirror, parsePrdFile, requireApiKey } from "./prd-linear.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRD_DIR = path.join(REPO_ROOT, "docs", "prds");

interface ReconcileOptions {
  slug: string;
  apiKey: string;
}

function getCurrentBranch(): string {
  return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", cwd: REPO_ROOT }).trim();
}

function isWorkingTreeClean(): boolean {
  const status = execSync("git status --porcelain", { encoding: "utf8", cwd: REPO_ROOT }).trim();
  return status.length === 0;
}

function branchExists(branchName: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", branchName], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function reconcilePrd(options: ReconcileOptions): Promise<void> {
  const { slug, apiKey } = options;
  const prdPath = path.join(PRD_DIR, `${slug}.md`);

  // Read current PRD to get frontmatter and Linear project slugId
  const { frontmatter } = await parsePrdFile(prdPath);

  process.stderr.write(`📋 Fetching Linear project content for "${slug}" (${frontmatter.slugId})...\n`);

  // Fetch the current Linear content body.
  const project = await fetchProjectPrdMirror(apiKey, frontmatter.slugId);

  // Read the raw file to preserve frontmatter exactly
  const rawContent = await readFile(prdPath, "utf8");
  const frontmatterMatch = /^---\n[\s\S]*?\n---\n?/.exec(rawContent);
  if (!frontmatterMatch) {
    throw new Error("PRD file has no valid frontmatter");
  }

  // Build new content: keep frontmatter, replace body with Linear content.
  const newBody = project.content ?? "";
  const newContent = frontmatterMatch[0] + newBody;

  if (newContent.trimEnd() === rawContent.trimEnd()) {
    process.stderr.write(`✅ PRD "${slug}" already matches Linear — nothing to reconcile.\n`);
    return;
  }

  // Create branch, commit, push
  const originalBranch = getCurrentBranch();
  const reconcileBranch = `pipeline/${slug}-prd-reconcile`;

  if (!isWorkingTreeClean()) {
    process.stderr.write("⚠️  Working tree has uncommitted changes. Commit or stash them first.\n");
    process.exit(1);
  }

  if (branchExists(reconcileBranch)) {
    process.stderr.write(
      `⚠️  Branch "${reconcileBranch}" already exists — delete it (\`git branch -D ${reconcileBranch}\`) or rename, then re-run.\n`,
    );
    process.exit(1);
  }

  // Write the updated PRD (guards passed — safe to mutate)
  await writeFile(prdPath, newContent, "utf8");
  process.stderr.write(`📝 Updated docs/prds/${slug}.md with Linear content.\n`);

  execFileSync("git", ["checkout", "-b", reconcileBranch], { cwd: REPO_ROOT, stdio: "inherit" });
  execFileSync("git", ["add", `docs/prds/${slug}.md`], { cwd: REPO_ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `docs: reconcile PRD ${slug} from Linear project content`], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  execFileSync("git", ["push", "-u", "origin", reconcileBranch], { cwd: REPO_ROOT, stdio: "inherit" });

  process.stderr.write(`\n✅ Branch "${reconcileBranch}" pushed.\n`);
  process.stderr.write(`   Create a PR with:\n`);
  process.stderr.write(
    `   gh pr create --base ${originalBranch} --head ${reconcileBranch} --title "docs: reconcile PRD ${slug} from Linear" --body "Adopts the Linear Project content edit back into git for PRD \`${slug}\`."\n`,
  );

  // Switch back to original branch
  execFileSync("git", ["checkout", originalBranch], { cwd: REPO_ROOT, stdio: "inherit" });
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    process.stderr.write("Usage: pnpm prd:reconcile <slug>\n");
    process.exit(1);
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    process.stderr.write(`Error: slug must match /^[a-z0-9-]+$/, got: ${slug}\n`);
    process.exit(1);
  }

  const apiKey = requireApiKey();
  await reconcilePrd({ slug, apiKey });
}

main().catch((error: unknown) => {
  process.stderr.write(`prd:reconcile failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
