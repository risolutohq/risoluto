import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { LivePreflightConfig } from "../config/live-preflight-config.js";
import { asRecord, asStringOrNull } from "../utils/type-guards.js";

export type GitHubRepoRef = { owner: string; name: string };

export async function createInstallationToken(
  config: LivePreflightConfig,
  fetchImpl: typeof fetch,
  createJwt: (input: { appId: string; privateKey: string }) => string,
): Promise<string> {
  if (config.githubAuth.strategy === "missing") {
    throw new Error("GitHub App auth missing");
  }
  const privateKey =
    config.githubAuth.strategy === "app_private_key_file"
      ? await readFile(config.githubAuth.privateKeyFile, "utf8")
      : config.githubAuth.privateKey;
  const jwt = createJwt({ appId: config.githubAuth.appId, privateKey });
  const response = await fetchImpl(
    `https://api.github.com/app/installations/${config.githubAuth.installationId}/access_tokens`,
    {
      method: "POST",
      headers: githubHeaders(`Bearer ${jwt}`),
    },
  );
  const payload = asRecord(await response.json());
  const token = asStringOrNull(payload.token);
  if (!response.ok || !token) {
    throw new Error(`GitHub App token request returned HTTP ${response.status}`);
  }
  return token;
}

export function createGitHubJwt(input: { appId: string; privateKey: string }): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: input.appId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(input.privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

export function githubHeaders(authorization: string): Record<string, string> {
  return {
    authorization,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

export function splitRepo(value: string | null): GitHubRepoRef | null {
  const [owner, name, extra] = (value ?? "").split("/");
  return owner && name && !extra ? { owner, name } : null;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
