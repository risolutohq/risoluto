import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadLiveEnvFile, resolveLivePreflightConfig } from "../../src/config/live-preflight-config.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-live-preflight-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("live preflight config", () => {
  it("loads dotenv-style values with spaces without shell sourcing", async () => {
    const dir = await createTempDir();
    const envPath = path.join(dir, ".env.live.local");
    await writeFile(
      envPath,
      [
        "LINEAR_LIVE_PROJECT_NAME=Risoluto Live Sandbox",
        'RISOLUTO_LIVE_MODEL_BASE_URL="https://cliproxy.dreampedia.app"',
        "RISOLUTO_LIVE_MODEL_ID=gpt-5.4-mini",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(loadLiveEnvFile(envPath)).resolves.toMatchObject({
      LINEAR_LIVE_PROJECT_NAME: "Risoluto Live Sandbox",
      RISOLUTO_LIVE_MODEL_BASE_URL: "https://cliproxy.dreampedia.app",
      RISOLUTO_LIVE_MODEL_ID: "gpt-5.4-mini",
    });
  });

  it("prefers a readable GitHub App private key file over inline private key", async () => {
    const dir = await createTempDir();
    const keyPath = path.join(dir, "github-app.pem");
    await writeFile(keyPath, "PRIVATE KEY", "utf8");

    const config = await resolveLivePreflightConfig({
      LINEAR_API_KEY: "linear",
      RISOLUTO_LIVE_MODEL_API_KEY: "model-key",
      E2E_GITHUB_REPO: "risolutohq/risoluto-live-sandbox",
      GITHUB_APP_ID: "1",
      GITHUB_APP_INSTALLATION_ID: "2",
      GITHUB_APP_PRIVATE_KEY_FILE: keyPath,
      GITHUB_APP_PRIVATE_KEY: "inline fallback",
    });

    expect(config.githubAuth).toEqual({
      strategy: "app_private_key_file",
      appId: "1",
      installationId: "2",
      privateKeyFile: keyPath,
    });
    expect(config.missing).not.toContain("GITHUB_APP_PRIVATE_KEY");
  });

  it("validates the locked live target and model profile env names", async () => {
    const config = await resolveLivePreflightConfig({
      LINEAR_API_KEY: "linear",
      RISOLUTO_LIVE_MODEL_API_KEY: "model-key",
      E2E_GITHUB_REPO: "risolutohq/risoluto-live-sandbox",
      GITHUB_APP_ID: "1",
      GITHUB_APP_INSTALLATION_ID: "2",
      GITHUB_APP_PRIVATE_KEY: "inline",
      CLIPROXY_API_KEY: "stale",
    });

    expect(config.githubSandboxRepo).toBe("risolutohq/risoluto-live-sandbox");
    expect(config.modelProfile).toMatchObject({
      name: "pr-live-smoke",
      apiKeyEnv: "RISOLUTO_LIVE_MODEL_API_KEY",
      model: "gpt-5.4-mini",
      reasoningEffort: "high",
    });
    expect(config.forbiddenPresent).toEqual(["CLIPROXY_API_KEY"]);
  });
});
