/**
 * Git input validation guards (RIS-241).
 *
 * Branch names that originate from tracker/config data and repository URLs that
 * originate from routing config are attacker-influenced. Before they reach a
 * `git` subprocess they must be validated so they cannot be parsed as git
 * options (argument injection) or smuggle a dangerous remote-helper transport.
 */

/** Thrown when a branch name fails git ref-format validation. */
export class InvalidGitRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGitRefError";
  }
}

/** Thrown when a repository URL is refused (option-like or disallowed scheme). */
export class InvalidRepoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRepoUrlError";
  }
}

// Printable characters git check-ref-format forbids anywhere in a ref.
const FORBIDDEN_REF_CHARS = /[ ~^:?*[\\]/;

/** True when the string contains an ASCII control character (incl. DEL). */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** True when any slash-separated component is empty or starts with a dot. */
function hasInvalidComponent(name: string): boolean {
  return name.split("/").some((component) => component.length === 0 || component.startsWith("."));
}

// Branch-name rejection rules, evaluated in order (mirrors git check-ref-format).
const BRANCH_NAME_RULES: ReadonlyArray<{ reject: (name: string) => boolean; message: string }> = [
  { reject: (n) => n.startsWith("-"), message: "may not start with '-'" },
  { reject: (n) => hasControlChar(n) || FORBIDDEN_REF_CHARS.test(n), message: "contains a forbidden character" },
  { reject: (n) => n.includes(".."), message: "may not contain '..'" },
  { reject: (n) => n.includes("@{"), message: "may not contain '@{'" },
  { reject: (n) => n === "@", message: "may not be '@'" },
  { reject: (n) => n.endsWith(".lock"), message: "may not end with '.lock'" },
  { reject: (n) => n.startsWith("/") || n.endsWith("/") || n.includes("//"), message: "has invalid '/' placement" },
  { reject: (n) => n.endsWith("."), message: "may not end with '.'" },
  { reject: hasInvalidComponent, message: "has an invalid path component" },
];

/**
 * Validate a branch name against `git check-ref-format --branch` rules.
 * Throws InvalidGitRefError when the name could not be a well-formed branch.
 */
export function assertValidBranchName(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new InvalidGitRefError("Branch name must be a non-empty string");
  }
  for (const rule of BRANCH_NAME_RULES) {
    if (rule.reject(name)) {
      throw new InvalidGitRefError(`Branch name ${rule.message}: ${name}`);
    }
  }
}

const ALLOWED_URL_SCHEMES = ["https://", "http://", "ssh://", "git://", "file://"];
// scp-like syntax: user@host:path (no scheme). Must not look like a path or option.
const SCP_LIKE_URL = /^[^\s/@-][^\s/@]*@[^\s/:]+:.+$/;

/**
 * Validate a repository URL for use as a `git clone` argument. Throws
 * InvalidRepoUrlError for option-like URLs (leading '-') or schemes outside the
 * allowlist (notably the ext::/fd:: remote helpers that execute commands).
 */
export function assertAllowedRepoUrl(url: string): void {
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new InvalidRepoUrlError("Repository URL must be a non-empty string");
  }
  const trimmed = url.trim();
  if (trimmed.startsWith("-")) {
    throw new InvalidRepoUrlError(`Repository URL may not start with '-': ${trimmed}`);
  }
  const lower = trimmed.toLowerCase();
  if (ALLOWED_URL_SCHEMES.some((scheme) => lower.startsWith(scheme))) {
    return;
  }
  if (SCP_LIKE_URL.test(trimmed)) {
    return;
  }
  throw new InvalidRepoUrlError(`Repository URL uses a disallowed scheme: ${trimmed}`);
}
