import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Returns extra host paths that must be mounted into the container for the
 * workspace to behave like it does on the host. This is primarily needed for
 * git worktrees whose `.git` file points at shared metadata outside the issue
 * workspace.
 *
 * The `.git`/`gitdir`/`commondir` contents are workspace-controlled and cannot
 * be trusted to name a safe host path (RIS-242): a malicious pointer to e.g.
 * `/home/...` must never become a container mount. The resolved directory is
 * therefore only returned when it is the trusted base clone (`gitBaseDir`) or a
 * path contained within it; anything outside is ignored.
 */
export async function resolveWorkspaceExtraMountPaths(
  workspacePath: string,
  gitBaseDir: string | undefined,
): Promise<string[]> {
  // Without a trusted base clone there is no legitimate path to mount, so a
  // workspace-controlled .git pointer is never honoured.
  if (!gitBaseDir) {
    return [];
  }

  const gitFilePath = path.join(workspacePath, ".git");

  let gitPointer: string;
  try {
    gitPointer = await readFile(gitFilePath, "utf8");
  } catch {
    return [];
  }

  const gitdirPrefix = "gitdir:";
  if (!gitPointer.startsWith(gitdirPrefix)) {
    return [];
  }

  const rawGitDir = gitPointer.slice(gitdirPrefix.length).trim();
  if (!rawGitDir) {
    return [];
  }

  const gitDirPath = path.isAbsolute(rawGitDir) ? rawGitDir : path.resolve(workspacePath, rawGitDir);

  let commonDir: string;
  try {
    commonDir = (await readFile(path.join(gitDirPath, "commondir"), "utf8")).trim();
  } catch {
    return allowedMount(gitBaseDir, gitDirPath);
  }

  if (!commonDir) {
    return allowedMount(gitBaseDir, gitDirPath);
  }

  const commonDirPath = path.resolve(gitDirPath, commonDir);
  return allowedMount(gitBaseDir, commonDirPath);
}

/** Returns `[candidatePath]` only when it is contained within the trusted base. */
function allowedMount(gitBaseDir: string, candidatePath: string): string[] {
  return isWithinBase(gitBaseDir, candidatePath) ? [candidatePath] : [];
}

/** True when `candidatePath` is the base directory itself or nested under it. */
function isWithinBase(baseDir: string, candidatePath: string): boolean {
  const relative = path.relative(baseDir, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
