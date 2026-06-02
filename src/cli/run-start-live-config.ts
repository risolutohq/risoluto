import { homedir } from "node:os";
import path from "node:path";

import { deriveServiceConfig } from "../config/derivation-pipeline.js";
import { DEFAULT_CONFIG_SECTIONS } from "../config/defaults.js";
import { loadLiveEnvFile, resolveLivePreflightConfig } from "../config/live-preflight-config.js";
import type { ServiceConfig } from "../core/types.js";
import { createGitHubJwt, createInstallationToken, githubHeaders, splitRepo } from "../live/github-app-auth.js";

/** Default env file the live composition reads sandbox creds + model profile from (gitignored). */
const LIVE_ENV_FILE = ".env.live.local";
const GITHUB_API_BASE_URL = "https://api.github.com";
/** Env var the synthesized repo route resolves its push token from; populated with the App token. */
export const LIVE_GITHUB_TOKEN_ENV = "GITHUB_TOKEN";
/** Label attached to the run's prep issue so the synthesized repo route matches it (repoRouter by label). */
export const LIVE_REPO_LABEL = "workflow";

/**
 * Load `.env.live.local` over the current process env. Mirrors the preflight CLI: file values win, and
 * `CLIPROXY_API_KEY` is stripped unless the file sets it (the live preflight forbids it as agent auth).
 */
export async function loadLiveDispatchEnv(): Promise<NodeJS.ProcessEnv> {
  const fileEnv = await loadLiveEnvFile(LIVE_ENV_FILE);
  const env: NodeJS.ProcessEnv = { ...process.env, ...fileEnv };
  if (!Object.hasOwn(fileEnv, "CLIPROXY_API_KEY")) {
    delete env.CLIPROXY_API_KEY;
  }
  return env;
}

/**
 * Synthesize a {@link ServiceConfig} for a live `run start` against the sandbox repo. Routes the run to
 * `E2E_GITHUB_REPO` (matched by the {@link LIVE_REPO_LABEL} label), runs Codex under `openai_login` from
 * `~/.codex/auth.json` (NOT the cliproxy key), and resolves the model from the `pr-live-smoke` profile.
 */
export function buildLiveServiceConfig(env: NodeJS.ProcessEnv, dataDir: string, defaultBranch: string): ServiceConfig {
  const repoRef = splitRepo(env.E2E_GITHUB_REPO ?? null);
  if (!repoRef) {
    throw new Error("E2E_GITHUB_REPO must be set to owner/name for a live run start");
  }
  const model = env.RISOLUTO_LIVE_MODEL_ID?.trim() || "gpt-5.4-mini";
  const mergedConfig: Record<string, unknown> = {
    ...DEFAULT_CONFIG_SECTIONS,
    tracker: { kind: "github", active_states: ["in_progress"], terminal_states: ["done"] },
    codex: {
      ...DEFAULT_CONFIG_SECTIONS.codex,
      model,
      reasoning_effort: env.RISOLUTO_LIVE_MODEL_REASONING_EFFORT?.trim() || "high",
      auth: { mode: "openai_login", source_home: path.join(homedir(), ".codex") },
    },
    workspace: {
      ...DEFAULT_CONFIG_SECTIONS.workspace,
      root: path.join(dataDir, "workspaces"),
      strategy: "worktree",
    },
    github: { api_base_url: GITHUB_API_BASE_URL },
    repos: [
      {
        repo_url: `https://github.com/${repoRef.owner}/${repoRef.name}`,
        default_branch: defaultBranch,
        label: LIVE_REPO_LABEL,
        github_token_env: LIVE_GITHUB_TOKEN_ENV,
      },
    ],
  };
  return deriveServiceConfig({ config: mergedConfig, promptTemplate: "" }, { secretResolver: (name) => env[name] });
}

/** Mint a short-lived GitHub App installation token for the sandbox (used host-side for push + draft PR). */
export async function mintGithubInstallationToken(env: NodeJS.ProcessEnv): Promise<string> {
  const config = await resolveLivePreflightConfig(env);
  if (config.githubAuth.strategy === "missing") {
    throw new Error(
      "GitHub App credentials missing (GITHUB_APP_ID / INSTALLATION_ID / PRIVATE_KEY) for live run start",
    );
  }
  return createInstallationToken(config, fetch, createGitHubJwt);
}

/** Resolve the sandbox repo's real default branch so the draft PR opens against the correct base. */
export async function fetchSandboxDefaultBranch(env: NodeJS.ProcessEnv, token: string): Promise<string> {
  const repoRef = splitRepo(env.E2E_GITHUB_REPO ?? null);
  if (!repoRef) {
    throw new Error("E2E_GITHUB_REPO must be set to owner/name for a live run start");
  }
  const response = await fetch(`${GITHUB_API_BASE_URL}/repos/${repoRef.owner}/${repoRef.name}`, {
    headers: githubHeaders(`Bearer ${token}`),
  });
  if (!response.ok) {
    throw new Error(`failed to resolve sandbox default branch: ${response.status} ${await response.text()}`);
  }
  const body: unknown = await response.json();
  const branch =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { default_branch?: unknown }).default_branch === "string"
      ? (body as { default_branch: string }).default_branch
      : null;
  if (!branch) {
    throw new Error("sandbox repo response missing default_branch");
  }
  return branch;
}
