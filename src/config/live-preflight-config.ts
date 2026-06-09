import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

import { resolveTestModelProfile, type ResolvedTestModelProfile } from "./test-model-profiles.js";

const REQUIRED_KEYS = [
  "LINEAR_API_KEY",
  "RISOLUTO_LIVE_MODEL_API_KEY",
  "E2E_GITHUB_REPO",
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
] as const;

export interface LivePreflightConfig {
  missing: string[];
  forbiddenPresent: string[];
  linearApiKey: string | null;
  linearEndpoint: string;
  githubSandboxRepo: string | null;
  modelProfile: ResolvedTestModelProfile;
  githubAuth:
    | {
        strategy: "app_private_key_file";
        appId: string;
        installationId: string;
        privateKeyFile: string;
      }
    | {
        strategy: "app_private_key_inline";
        appId: string;
        installationId: string;
        privateKey: string;
      }
    | {
        strategy: "missing";
      };
}

export async function loadLiveEnvFile(path: string): Promise<NodeJS.ProcessEnv> {
  const content = await readFile(path, "utf8");
  const env: NodeJS.ProcessEnv = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    env[line.slice(0, separatorIndex).trim()] = unquoteEnvValue(line.slice(separatorIndex + 1).trim());
  }
  return env;
}

export async function resolveLivePreflightConfig(env: NodeJS.ProcessEnv): Promise<LivePreflightConfig> {
  const githubAuth = await resolveGithubAuth(env);
  const missing: string[] = REQUIRED_KEYS.filter((key) => !envValue(env, key));
  if (githubAuth.strategy === "missing") {
    missing.push("GITHUB_APP_PRIVATE_KEY_FILE_OR_GITHUB_APP_PRIVATE_KEY");
  }

  return {
    missing,
    forbiddenPresent: envValue(env, "CLIPROXY_API_KEY") ? ["CLIPROXY_API_KEY"] : [],
    linearApiKey: envValue(env, "LINEAR_API_KEY"),
    linearEndpoint: envValue(env, "LINEAR_API_ENDPOINT") ?? "https://api.linear.app/graphql",
    githubSandboxRepo: envValue(env, "E2E_GITHUB_REPO"),
    modelProfile: resolveTestModelProfile("pr-live-smoke", env),
    githubAuth,
  };
}

async function resolveGithubAuth(env: NodeJS.ProcessEnv): Promise<LivePreflightConfig["githubAuth"]> {
  const appId = envValue(env, "GITHUB_APP_ID");
  const installationId = envValue(env, "GITHUB_APP_INSTALLATION_ID");
  if (!appId || !installationId) {
    return { strategy: "missing" };
  }

  const privateKeyFile = envValue(env, "GITHUB_APP_PRIVATE_KEY_FILE");
  if (privateKeyFile && (await isReadableFile(privateKeyFile))) {
    return { strategy: "app_private_key_file", appId, installationId, privateKeyFile };
  }

  const privateKey = envValue(env, "GITHUB_APP_PRIVATE_KEY");
  if (privateKey) {
    return { strategy: "app_private_key_inline", appId, installationId, privateKey };
  }
  return { strategy: "missing" };
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function unquoteEnvValue(value: string): string {
  if (value.length >= 2) {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1).replace(/\\n/g, "\n");
    }
  }
  return value;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}
