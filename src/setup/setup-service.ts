import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { normalizeCodexAuthJson } from "../codex/auth-file.js";
import { GitHubApiError, GitHubTransport } from "../github/transport.js";
import {
  checkAuthEndpointReachable,
  createPkceSession,
  exchangePkceCode,
  savePkceAuthTokens,
  shutdownCallbackServer,
  startCallbackServer,
  type PkceSession,
} from "./device-auth.js";
import {
  SetupServiceError,
  type LinearProjectOption,
  type RepoRouteEntry,
  type SaveRepoRouteInput,
  type SetupApiDeps,
  type SetupStatusSnapshot,
  type SetupPort,
  type SetupProviderConfig,
} from "./port.js";
import { hasCodexAuthFile, hasRepoRoutes, readProjectSlug, readTrackerKind } from "./setup-status.js";
import { toErrorString } from "../utils/type-guards.js";
import { isBlockedRequestHost, isLoopbackHost } from "../utils/url-safety.js";
import { assertValidBranchName, InvalidGitRefError } from "../git/git-validation.js";

const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/u;

/** Raised when a GitHub request fails authentication (bad/expired token) — surfaced
 * distinctly from network/not-found errors so setup does not mask a bad token (RIS-253). */
export class GitHubAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.at(end - 1) === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}

const DEFAULT_BRANCH_FALLBACK = "main";

export function trimOptionalNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRepos(overlay: Record<string, unknown>): RepoRouteEntry[] {
  const raw = overlay.repos;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (entry): entry is RepoRouteEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as RepoRouteEntry).repo_url === "string" &&
      typeof (entry as RepoRouteEntry).identifier_prefix === "string",
  );
}

function normalizeRepoUrl(repoUrl: string | null): string | null {
  const url = trimOptionalNonEmptyString(repoUrl);
  if (!url || !GITHUB_URL_RE.test(url)) {
    return null;
  }
  return url;
}

function normalizeDefaultBranch(defaultBranch: string | null | undefined): string {
  const trimmed = trimOptionalNonEmptyString(defaultBranch);
  if (!trimmed) {
    return "main";
  }
  // A persisted defaultBranch is later used as a git ref / start point, so it must pass
  // git ref-format rules (no leading '-', whitespace, control chars, '..') (RIS-253).
  try {
    assertValidBranchName(trimmed);
  } catch (error) {
    if (error instanceof InvalidGitRefError) {
      throw new SetupServiceError(400, "invalid_default_branch", "defaultBranch is not a valid git branch name");
    }
    throw error;
  }
  return trimmed;
}

function normalizeIdentifierPrefix(identifierPrefix: string | null): string | null {
  const prefix = trimOptionalNonEmptyString(identifierPrefix);
  return prefix ? prefix.toUpperCase() : null;
}

function normalizeLabel(label: string | null | undefined): string | undefined {
  return trimOptionalNonEmptyString(label) ?? undefined;
}

function getValidationUrl(baseUrl: string | null): string {
  return baseUrl ? `${stripTrailingSlashes(baseUrl)}/models` : "https://api.openai.com/v1/models";
}

async function validateOpenaiKey(key: string, validationUrl: string): Promise<boolean> {
  try {
    const openaiResponse = await fetch(validationUrl, {
      headers: { authorization: `Bearer ${key}` },
    });
    return openaiResponse.ok;
  } catch {
    return false;
  }
}

/**
 * Validate a provider base URL before the API key is sent to it (SSRF / key
 * exfiltration, RIS-245). A loopback host is the explicitly-trusted local-proxy
 * case (the operator's own machine) and may use http or https; every other host
 * must use https and must not be a private or link-local address. Throws
 * SetupServiceError(400) on any violation.
 */
function assertSafeProviderBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new SetupServiceError(400, "invalid_provider_base_url", "provider.baseUrl is not a valid URL");
  }
  if (isLoopbackHost(parsed.hostname)) {
    return;
  }
  if (parsed.protocol !== "https:") {
    throw new SetupServiceError(
      400,
      "insecure_provider_base_url",
      "provider.baseUrl must use https for a non-loopback host",
    );
  }
  if (isBlockedRequestHost(parsed.hostname)) {
    throw new SetupServiceError(
      400,
      "forbidden_provider_base_url",
      "provider.baseUrl must not point at a private or link-local host",
    );
  }
}

function isSupportedGitHubHost(hostname: string): boolean {
  return hostname === "github.com" || hostname === "www.github.com";
}

function isGitHubSegment(value: string): boolean {
  return /^[\w.-]+$/u.test(value);
}

export function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  if (url !== url.trim()) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !isSupportedGitHubHost(parsed.hostname) || parsed.search || parsed.hash) {
      return null;
    }

    const normalizedPath = parsed.pathname.endsWith("/") ? parsed.pathname.slice(0, -1) : parsed.pathname;
    const segments = normalizedPath.split("/");
    if (segments.length !== 3) {
      return null;
    }

    const [, owner, rawRepo] = segments;
    const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
    if (!isGitHubSegment(owner) || !isGitHubSegment(repo)) {
      return null;
    }

    return { owner, repo };
  } catch {
    return null;
  }
}

export function resolveToken(deps: Pick<SetupApiDeps, "secretsStore">): string | null {
  const fromSecrets = deps.secretsStore.get("GITHUB_TOKEN") ?? null;
  if (fromSecrets) {
    return fromSecrets;
  }
  return process.env.GITHUB_TOKEN ?? null;
}

export async function fetchDefaultBranch(
  owner: string,
  repo: string,
  token: string | null,
  fetchImpl: typeof fetch,
): Promise<string> {
  const transport = new GitHubTransport({
    fetch: fetchImpl,
    defaultHeaders: {
      accept: "application/vnd.github+json",
      "user-agent": "risoluto",
      "x-github-api-version": "2022-11-28",
    },
  });
  const pathName = `/repos/${owner}/${repo}`;

  // When a token is supplied, use it and surface failures — a bad/expired token must not
  // silently fall back to an unauthenticated request (which would mask the auth problem).
  // The unauthenticated request is only used when no token exists at all (RIS-253).
  const omitAuthorization = token === null;
  let data: Record<string, unknown>;
  try {
    data = (await transport.request({
      pathName,
      method: "GET",
      ...(token ? { token } : { omitAuthorization: true }),
    })) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GitHubApiError && (error.status === 401 || error.status === 403) && !omitAuthorization) {
      throw new GitHubAuthError(`GitHub authentication failed (${error.status})`, error.status);
    }
    if (error instanceof GitHubApiError) {
      throw new Error(`GitHub API returned ${error.status}`, { cause: error });
    }
    throw error;
  }
  if (typeof data.default_branch === "string") {
    return data.default_branch;
  }
  return DEFAULT_BRANCH_FALLBACK;
}

class SetupServiceImpl implements SetupPort {
  private activePkceSession: PkceSession | null = null;

  constructor(private readonly deps: SetupApiDeps) {}

  private getTrackerKind(): string {
    return readTrackerKind(this.deps.configOverlayStore.toMap()) ?? "linear";
  }

  private getLinearApiKey(): string {
    return this.deps.secretsStore.get("LINEAR_API_KEY") ?? process.env.LINEAR_API_KEY ?? "";
  }

  private requireTracker() {
    if (this.deps.tracker) {
      return this.deps.tracker;
    }
    throw new SetupServiceError(500, "tracker_unavailable", "Tracker provisioning is unavailable");
  }

  getStatus(): SetupStatusSnapshot {
    const masterKeyDone = this.deps.secretsStore.isInitialized();
    const overlay = this.deps.configOverlayStore.toMap();
    const trackerKind = readTrackerKind(overlay) ?? "linear";
    const linearProjectDone = trackerKind !== "linear" || Boolean(readProjectSlug(overlay));
    const hasApiKey = !!(this.deps.secretsStore.get("OPENAI_API_KEY") || process.env.OPENAI_API_KEY);
    const hasAuthJson = hasCodexAuthFile(this.deps.archiveDir, overlay);
    const openaiKeyDone = hasApiKey || hasAuthJson;
    const githubTokenDone = !!(this.deps.secretsStore.get("GITHUB_TOKEN") || process.env.GITHUB_TOKEN);

    return {
      configured: masterKeyDone && linearProjectDone,
      steps: {
        masterKey: { done: masterKeyDone },
        linearProject: { done: linearProjectDone },
        repoRoute: { done: hasRepoRoutes(overlay) },
        openaiKey: { done: openaiKeyDone },
        githubToken: { done: githubTokenDone },
      },
    };
  }

  async createMasterKey(providedKey?: string | null): Promise<{ key: string }> {
    if (this.deps.secretsStore.isInitialized()) {
      throw new SetupServiceError(409, "already_initialized", "Master key is already set");
    }

    const key = providedKey ?? randomBytes(32).toString("hex");
    const keyFile = path.join(this.deps.archiveDir, "master.key");
    await mkdir(this.deps.archiveDir, { recursive: true });
    await writeFile(keyFile, key, { encoding: "utf8", mode: 0o600 });
    await this.deps.secretsStore.initializeWithKey(key);
    return { key };
  }

  async getLinearProjects(): Promise<{ projects: LinearProjectOption[] }> {
    if (this.getTrackerKind() === "linear" && !this.getLinearApiKey()) {
      throw new SetupServiceError(400, "missing_api_key", "LINEAR_API_KEY not configured");
    }
    return this.requireTracker().provision({ type: "list_projects" });
  }

  async selectLinearProject(slugId: string): Promise<{ ok: true }> {
    // Probe the project first (this validates it exists / is reachable), then persist
    // the slug, then start. A failed start rolls the slug back so a broken setup is not
    // left looking configured (RIS-253).
    await this.requireTracker().provision({ type: "select_project", slugId });
    await this.deps.configOverlayStore.set("tracker.project_slug", slugId);
    try {
      await this.deps.orchestrator.start();
    } catch {
      await this.deps.configOverlayStore.delete("tracker.project_slug").catch(() => {});
      throw new SetupServiceError(500, "orchestrator_start_failed", "Failed to start after selecting the project");
    }
    this.deps.orchestrator.requestRefresh("setup");
    return { ok: true };
  }

  async saveOpenaiKey(key: string, provider: SetupProviderConfig): Promise<{ valid: boolean }> {
    if (provider.supplied && !provider.baseUrl) {
      throw new SetupServiceError(
        400,
        "missing_provider_base_url",
        "provider.baseUrl is required when provider is configured",
      );
    }
    if (provider.baseUrl) {
      assertSafeProviderBaseUrl(provider.baseUrl);
    }

    const valid = await validateOpenaiKey(key, getValidationUrl(provider.baseUrl));
    if (!valid) {
      return { valid: false };
    }

    // Snapshot the rollback state so a partial failure leaves neither the secret nor the
    // codex overlay section persisted (RIS-253).
    const priorKey = this.deps.secretsStore.get("OPENAI_API_KEY");
    const priorCodex = this.deps.configOverlayStore.toMap().codex;

    try {
      await this.deps.secretsStore.set("OPENAI_API_KEY", key);
      await this.deps.configOverlayStore.set("codex.auth.mode", "api_key");
      await this.deps.configOverlayStore.delete("codex.provider");
      if (provider.baseUrl) {
        await this.deps.configOverlayStore.set("codex.provider.base_url", provider.baseUrl);
        await this.deps.configOverlayStore.set("codex.provider.env_key", "OPENAI_API_KEY");
        await this.deps.configOverlayStore.set("codex.provider.wire_api", "responses");
        if (provider.name) {
          await this.deps.configOverlayStore.set("codex.provider.name", provider.name);
        }
      }
    } catch {
      await this.rollbackOpenaiKey(priorKey, priorCodex);
      throw new SetupServiceError(500, "openai_key_save_failed", "Failed to persist the OpenAI key configuration");
    }

    return { valid: true };
  }

  private async rollbackOpenaiKey(priorKey: string | null, priorCodex: unknown): Promise<void> {
    if (priorKey === null) {
      await this.deps.secretsStore.delete("OPENAI_API_KEY").catch(() => {});
    } else {
      await this.deps.secretsStore.set("OPENAI_API_KEY", priorKey).catch(() => {});
    }
    if (priorCodex === undefined) {
      await this.deps.configOverlayStore.delete("codex").catch(() => {});
    } else {
      await this.deps.configOverlayStore.set("codex", priorCodex).catch(() => {});
    }
  }

  async saveCodexAuth(authJson: string): Promise<{ ok: true }> {
    const normalizedAuthJson = normalizeCodexAuthJson(authJson);
    const authDir = path.join(this.deps.archiveDir, "codex-auth");
    await mkdir(authDir, { recursive: true });
    await writeFile(path.join(authDir, "auth.json"), normalizedAuthJson, { encoding: "utf8", mode: 0o600 });

    await Promise.all([
      this.deps.configOverlayStore.set("codex.auth.mode", "openai_login"),
      this.deps.configOverlayStore.set("codex.auth.source_home", authDir),
      this.deps.configOverlayStore.delete("codex.provider"),
    ]);

    return { ok: true };
  }

  // Dedups concurrent status polls so the one-shot PKCE code is exchanged once.
  private activePkceExchange: Promise<{ status: string; error?: string }> | null = null;

  async startPkceAuth(): Promise<{ authUrl: string }> {
    try {
      const reachError = await checkAuthEndpointReachable();
      if (reachError) {
        throw new SetupServiceError(502, "auth_unreachable", reachError);
      }

      if (this.activePkceSession) {
        shutdownCallbackServer(this.activePkceSession);
      }

      this.activePkceSession = createPkceSession();
      await startCallbackServer(this.activePkceSession);
      return { authUrl: this.activePkceSession.authUrl };
    } catch (error) {
      // Clear the half-started session so getPkceAuthStatus() reports idle
      // rather than wedging on a session that never bound.
      const detail = this.activePkceSession?.error ?? toErrorString(error);
      this.activePkceSession = null;
      if (error instanceof SetupServiceError) {
        throw error;
      }
      throw new SetupServiceError(500, "pkce_start_error", detail);
    }
  }

  private async exchangeAndSaveFromSession(session: PkceSession): Promise<{ status: string; error?: string }> {
    try {
      const tokenData = await exchangePkceCode(session.authCode!, session.codeVerifier, session.redirectUri);
      await savePkceAuthTokens(tokenData, this.deps.archiveDir, this.deps.configOverlayStore);
      session.complete = true;
      shutdownCallbackServer(session);
      return { status: "complete" };
    } catch (error) {
      const message = toErrorString(error);
      session.error = message;
      shutdownCallbackServer(session);
      return { status: "error", error: message };
    }
  }

  async getPkceAuthStatus(): Promise<{ status: string; error?: string }> {
    if (!this.activePkceSession) {
      return { status: "idle" };
    }
    if (this.activePkceSession.error) {
      shutdownCallbackServer(this.activePkceSession);
      return { status: "error", error: this.activePkceSession.error };
    }
    if (this.activePkceSession.complete) {
      this.activePkceSession = null;
      return { status: "complete" };
    }
    if (this.activePkceSession.authCode) {
      // Concurrent polls must share one exchange — the authorization code is
      // single-use and a double exchange corrupts the session.
      this.activePkceExchange ??= this.exchangeAndSaveFromSession(this.activePkceSession).finally(() => {
        this.activePkceExchange = null;
      });
      return this.activePkceExchange;
    }
    if (Date.now() - this.activePkceSession.createdAt > 3 * 60 * 1000) {
      this.activePkceSession.error = "Authentication timed out. Please try again.";
      shutdownCallbackServer(this.activePkceSession);
      return { status: "expired", error: this.activePkceSession.error };
    }
    return { status: "pending" };
  }

  async cancelPkceAuth(): Promise<{ ok: true }> {
    if (this.activePkceSession) {
      shutdownCallbackServer(this.activePkceSession);
      this.activePkceSession = null;
    }
    return { ok: true };
  }

  async saveGithubToken(token: string): Promise<{ valid: boolean }> {
    let valid: boolean;
    try {
      const transport = new GitHubTransport({
        authorizationScheme: "token",
        defaultHeaders: { "user-agent": "Risoluto" },
      });
      const ghResponse = await transport.send({ pathName: "/user", method: "GET", token });
      valid = ghResponse.ok;
    } catch {
      valid = false;
    }

    if (valid) {
      await this.deps.secretsStore.set("GITHUB_TOKEN", token);
    }

    return { valid };
  }

  getRepoRoutes(): { routes: RepoRouteEntry[] } {
    return { routes: readRepos(this.deps.configOverlayStore.toMap()) };
  }

  async saveRepoRoute(input: SaveRepoRouteInput): Promise<{ ok: true; route: RepoRouteEntry }> {
    const repoUrl = normalizeRepoUrl(input.repoUrl);
    if (!repoUrl) {
      throw new SetupServiceError(
        400,
        "invalid_repo_url",
        "repoUrl must be a valid GitHub URL (https://github.com/org/repo)",
      );
    }

    const identifierPrefix = normalizeIdentifierPrefix(input.identifierPrefix);
    if (!identifierPrefix) {
      throw new SetupServiceError(400, "missing_prefix", "identifierPrefix is required");
    }

    const label = normalizeLabel(input.label);
    const entry: RepoRouteEntry = {
      repo_url: repoUrl,
      default_branch: normalizeDefaultBranch(input.defaultBranch),
      identifier_prefix: identifierPrefix,
      ...(label ? { label } : {}),
    };

    const existing = readRepos(this.deps.configOverlayStore.toMap());
    const filtered = existing.filter((route) => route.identifier_prefix !== identifierPrefix);
    filtered.push(entry);

    await this.deps.configOverlayStore.set("repos", filtered);
    return { ok: true, route: entry };
  }

  async deleteRepoRoute(index: number): Promise<{ ok: true; routes: RepoRouteEntry[] }> {
    const existing = readRepos(this.deps.configOverlayStore.toMap());
    if (!Number.isInteger(index) || index < 0 || index >= existing.length) {
      throw new SetupServiceError(400, "invalid_index", `index must be between 0 and ${existing.length - 1}`);
    }

    existing.splice(index, 1);
    await this.deps.configOverlayStore.set("repos", existing);
    return { ok: true, routes: existing };
  }

  async detectDefaultBranch(repoUrl: string | null): Promise<{ defaultBranch: string }> {
    const normalizedRepoUrl = trimOptionalNonEmptyString(repoUrl);
    if (!normalizedRepoUrl) {
      throw new SetupServiceError(400, "missing_repo_url", "repoUrl is required");
    }

    const parsed = parseOwnerRepo(normalizedRepoUrl);
    if (!parsed) {
      throw new SetupServiceError(400, "invalid_repo_url", "repoUrl must be a valid GitHub URL");
    }

    try {
      const defaultBranch = await fetchDefaultBranch(parsed.owner, parsed.repo, resolveToken(this.deps), fetch);
      return { defaultBranch };
    } catch (error) {
      // A bad/expired token is surfaced distinctly; network / not-found failures are
      // non-fatal and fall back to the default branch (RIS-253).
      if (error instanceof GitHubAuthError) {
        throw new SetupServiceError(401, "github_auth_failed", "GitHub token is invalid or expired");
      }
      return { defaultBranch: DEFAULT_BRANCH_FALLBACK };
    }
  }

  async createTestIssue(): Promise<{ ok: true; issueIdentifier: string; issueUrl: string }> {
    if (this.getTrackerKind() === "linear" && !this.getLinearApiKey()) {
      throw new SetupServiceError(400, "missing_api_key", "LINEAR_API_KEY not configured");
    }
    if (this.getTrackerKind() === "linear" && !readProjectSlug(this.deps.configOverlayStore.toMap())) {
      throw new SetupServiceError(400, "missing_project", "No Linear project selected");
    }

    return this.requireTracker().provision({ type: "create_test_issue" });
  }

  async createLabel(): Promise<{ ok: true; labelId: string; labelName: string; alreadyExists: boolean }> {
    if (this.getTrackerKind() === "linear" && !this.getLinearApiKey()) {
      throw new SetupServiceError(400, "missing_api_key", "LINEAR_API_KEY not configured");
    }
    if (this.getTrackerKind() === "linear" && !readProjectSlug(this.deps.configOverlayStore.toMap())) {
      throw new SetupServiceError(400, "missing_project", "No Linear project selected");
    }

    return this.requireTracker().provision({ type: "create_label" });
  }

  async createProject(name: string): Promise<{
    ok: true;
    project: { id?: string; name?: string; slugId?: string; url: string | null; teamKey: string | null };
  }> {
    if (this.getTrackerKind() !== "linear") {
      throw new SetupServiceError(
        400,
        "unsupported_tracker_operation",
        "Project creation is only available when tracker.kind is linear",
      );
    }
    if (!this.getLinearApiKey()) {
      throw new SetupServiceError(400, "missing_api_key", "LINEAR_API_KEY not configured");
    }

    try {
      return await this.requireTracker().provision({ type: "create_project", name });
    } catch (error) {
      const message = toErrorString(error);
      if (message.includes("No teams found")) {
        throw new SetupServiceError(400, "no_teams", "No teams found in your Linear workspace");
      }
      throw error;
    }
  }

  async reset(): Promise<{ ok: true }> {
    await this.cancelPkceAuth();
    await this.deps.orchestrator.stop();
    await Promise.all(this.deps.secretsStore.list().map((key) => this.deps.secretsStore.delete(key)));
    await Promise.all([
      this.deps.configOverlayStore.set("codex.auth.mode", ""),
      this.deps.configOverlayStore.set("codex.auth.source_home", ""),
      this.deps.configOverlayStore.delete("codex.provider"),
      writeFile(path.join(this.deps.archiveDir, "master.key"), "", { encoding: "utf8", mode: 0o600 }),
    ]);
    this.deps.secretsStore.reset();
    return { ok: true };
  }
}

export type SetupService = SetupPort;
export type { SetupProviderConfig } from "./port.js";

const setupServiceCache = new WeakMap<SetupApiDeps, SetupPort>();

export function createSetupService(deps: SetupApiDeps): SetupPort {
  return new SetupServiceImpl(deps);
}

export function getSetupService(deps: SetupApiDeps): SetupPort {
  const existing = setupServiceCache.get(deps);
  if (existing) {
    return existing;
  }
  const service = createSetupService(deps);
  setupServiceCache.set(deps, service);
  return service;
}

export function isSetupService(value: SetupApiDeps | SetupPort): value is SetupPort {
  return typeof (value as SetupPort).getStatus === "function";
}

export function resolveSetupService(value: SetupApiDeps | SetupPort): SetupPort {
  return isSetupService(value) ? value : getSetupService(value);
}

export { SetupServiceError } from "./port.js";
