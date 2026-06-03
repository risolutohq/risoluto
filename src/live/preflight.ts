import type { LivePreflightConfig } from "../config/live-preflight-config.js";
import { asArray, asRecord, asStringOrNull, toErrorString } from "../utils/type-guards.js";
import type { LivePreflightCheck, LivePreflightDeps, LivePreflightReport } from "./contracts.js";
import { createGitHubJwt, createInstallationToken, githubHeaders, splitRepo } from "./github-app-auth.js";
import { checkGitHubAppSandboxLifecycle } from "./github-app-sandbox-lifecycle.js";

export type { LivePreflightCheck, LivePreflightDeps, LivePreflightReport, LivePreflightStatus } from "./contracts.js";

export async function runLivePreflight(
  config: LivePreflightConfig,
  deps: LivePreflightDeps = {},
): Promise<LivePreflightReport> {
  const generatedAt = deps.now?.() ?? new Date().toISOString();
  const configCheck = checkConfig(config);
  if (configCheck.status !== "passed") {
    return { generatedAt, overall: configCheck.status, checks: [configCheck] };
  }

  const fetchImpl = deps.fetch ?? fetch;
  const createJwt = deps.createGitHubJwt ?? createGitHubJwt;
  const checks = [
    configCheck,
    await runProviderCheck("linear", () => checkLinear(config, fetchImpl)),
    await runProviderCheck("github_app", () => checkGitHubApp(config, fetchImpl, createJwt)),
    await runProviderCheck("github_app_sandbox_lifecycle", () =>
      checkGitHubAppSandboxLifecycle(config, fetchImpl, createJwt, generatedAt),
    ),
    await runProviderCheck("model_proxy", () => checkModelProxy(config, fetchImpl)),
  ];
  return {
    generatedAt,
    overall: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks,
  };
}

async function runProviderCheck(
  name: LivePreflightCheck["name"],
  check: () => Promise<LivePreflightCheck>,
): Promise<LivePreflightCheck> {
  try {
    return await check();
  } catch (error) {
    return failed(name, summarizeError(error));
  }
}

function checkConfig(config: LivePreflightConfig): LivePreflightCheck {
  if (config.forbiddenPresent.length > 0) {
    return failed("config", `forbidden env present: ${config.forbiddenPresent.join(", ")}`);
  }
  if (config.missing.length > 0) {
    return {
      name: "config",
      status: "skipped",
      detail: `missing env: ${config.missing.join(", ")}`,
    };
  }
  return passed("config", "required live env is present");
}

async function checkLinear(config: LivePreflightConfig, fetchImpl: typeof fetch): Promise<LivePreflightCheck> {
  const response = await fetchImpl(config.linearEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: config.linearApiKey ?? "",
    },
    body: JSON.stringify({ query: "query RisolutoLivePreflight { viewer { id } }" }),
  });
  const payload = asRecord(await response.json());
  if (!response.ok || Array.isArray(payload.errors)) {
    return failed("linear", `Linear preflight returned HTTP ${response.status}`);
  }
  const viewerId = asStringOrNull(asRecord(asRecord(payload.data).viewer).id);
  return viewerId ? passed("linear", "viewer authenticated") : failed("linear", "viewer id missing");
}

async function checkGitHubApp(
  config: LivePreflightConfig,
  fetchImpl: typeof fetch,
  createJwt: NonNullable<LivePreflightDeps["createGitHubJwt"]>,
): Promise<LivePreflightCheck> {
  const token = await createInstallationToken(config, fetchImpl, createJwt);
  const repo = splitRepo(config.githubSandboxRepo);
  if (!repo) {
    return failed("github_app", "E2E_GITHUB_REPO must be owner/repo");
  }
  const response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.name}`, {
    method: "GET",
    headers: githubHeaders(`Bearer ${token}`),
  });
  return response.ok
    ? passed("github_app", "sandbox repo reachable", { repo: config.githubSandboxRepo ?? "" })
    : failed("github_app", `sandbox repo returned HTTP ${response.status}`);
}

async function checkModelProxy(config: LivePreflightConfig, fetchImpl: typeof fetch): Promise<LivePreflightCheck> {
  const response = await fetchImpl(`${trimTrailingSlash(config.modelProfile.baseUrl)}/v1/models`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${config.modelProfile.apiKey ?? ""}`,
      accept: "application/json",
    },
  });
  const payload = asRecord(await response.json());
  const ids = asArray(payload.data).map((item) => asStringOrNull(asRecord(item).id));
  return response.ok && ids.includes(config.modelProfile.model)
    ? passed("model_proxy", "live smoke model is available", {
        profile: config.modelProfile.name,
        model: config.modelProfile.model,
      })
    : failed("model_proxy", `model list did not include ${config.modelProfile.model}`);
}

function summarizeError(error: unknown): string {
  const message = toErrorString(error);
  return message.replace(/\s+/gu, " ").slice(0, 240) || "unknown live preflight error";
}

function passed(
  name: LivePreflightCheck["name"],
  detail: string,
  resource?: Record<string, string>,
): LivePreflightCheck {
  return { name, status: "passed", detail, ...(resource ? { resource } : {}) };
}

function failed(name: LivePreflightCheck["name"], detail: string): LivePreflightCheck {
  return { name, status: "failed", detail };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
