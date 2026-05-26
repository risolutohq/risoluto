import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runLivePreflightCli } from "../../src/live/preflight-cli.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-live-preflight-cli-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runLivePreflightCli", () => {
  it("loads env, writes a redacted artifact, and exits successfully for passing preflight", async () => {
    const dir = await createTempDir();
    const envPath = path.join(dir, ".env.live.local");
    const outputDir = path.join(dir, "results");
    const keyPath = path.join(dir, "github-app.pem");
    await writeFile(keyPath, "PRIVATE KEY", "utf8");
    await writeFile(
      envPath,
      [
        "LINEAR_API_KEY=linear-secret",
        "RISOLUTO_LIVE_MODEL_API_KEY=model-secret",
        "E2E_GITHUB_REPO=risolutohq/risoluto-live-sandbox",
        "GITHUB_APP_ID=123",
        "GITHUB_APP_INSTALLATION_ID=456",
        `GITHUB_APP_PRIVATE_KEY_FILE=${keyPath}`,
      ].join("\n"),
      "utf8",
    );
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const exitCode = await runLivePreflightCli(["--env-file", envPath, "--output-dir", outputDir, "--json"], {
      fetch: mockSuccessfulFetch(),
      createGitHubJwt: () => "jwt-token",
      now: () => "2026-05-25T10:00:00.000Z",
      env: {},
    });

    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout[0]) as { artifactPath: string };
    const artifact = await readFile(output.artifactPath, "utf8");
    expect(output.artifactPath).toContain(outputDir);
    expect(artifact).toContain('"overall": "passed"');
    expect(artifact).not.toContain("linear-secret");
    expect(artifact).not.toContain("model-secret");
  });

  it("accepts the separator forwarded by pnpm run", async () => {
    const dir = await createTempDir();
    const envPath = path.join(dir, ".env.live.local");
    const outputDir = path.join(dir, "results");
    const keyPath = path.join(dir, "github-app.pem");
    await writeFile(keyPath, "PRIVATE KEY", "utf8");
    await writeFile(
      envPath,
      [
        "LINEAR_API_KEY=linear-secret",
        "RISOLUTO_LIVE_MODEL_API_KEY=model-secret",
        "E2E_GITHUB_REPO=risolutohq/risoluto-live-sandbox",
        "GITHUB_APP_ID=123",
        "GITHUB_APP_INSTALLATION_ID=456",
        `GITHUB_APP_PRIVATE_KEY_FILE=${keyPath}`,
      ].join("\n"),
      "utf8",
    );

    const exitCode = await runLivePreflightCli(["--", "--env-file", envPath, "--output-dir", outputDir], {
      fetch: mockSuccessfulFetch(),
      createGitHubJwt: () => "jwt-token",
      now: () => "2026-05-25T10:00:00.000Z",
      env: {},
    });

    expect(exitCode).toBe(0);
    await expect(
      readFile(path.join(outputDir, "live-preflight-2026-05-25T10-00-00-000Z.json"), "utf8"),
    ).resolves.toContain('"overall": "passed"');
  });

  it("does not let an inherited CLIPROXY_API_KEY poison an env-file-backed preflight", async () => {
    const dir = await createTempDir();
    const envPath = path.join(dir, ".env.live.local");
    const outputDir = path.join(dir, "results");
    const keyPath = path.join(dir, "github-app.pem");
    await writeFile(keyPath, "PRIVATE KEY", "utf8");
    await writeFile(
      envPath,
      [
        "LINEAR_API_KEY=linear-secret",
        "RISOLUTO_LIVE_MODEL_API_KEY=model-secret",
        "E2E_GITHUB_REPO=risolutohq/risoluto-live-sandbox",
        "GITHUB_APP_ID=123",
        "GITHUB_APP_INSTALLATION_ID=456",
        `GITHUB_APP_PRIVATE_KEY_FILE=${keyPath}`,
      ].join("\n"),
      "utf8",
    );

    const exitCode = await runLivePreflightCli(["--env-file", envPath, "--output-dir", outputDir], {
      fetch: mockSuccessfulFetch(),
      createGitHubJwt: () => "jwt-token",
      env: { CLIPROXY_API_KEY: "stale-parent-env" },
    });

    expect(exitCode).toBe(0);
  });

  it("exits successfully when missing credentials produce a clean skip", async () => {
    const dir = await createTempDir();
    const outputDir = path.join(dir, "results");

    const exitCode = await runLivePreflightCli(
      ["--env-file", path.join(dir, "missing.env"), "--output-dir", outputDir],
      {
        fetch: vi.fn<typeof fetch>(),
        env: {},
      },
    );

    expect(exitCode).toBe(0);
  });

  it("writes an artifact and exits non-zero when a provider check fails", async () => {
    const dir = await createTempDir();
    const envPath = path.join(dir, ".env.live.local");
    const outputDir = path.join(dir, "results");
    const keyPath = path.join(dir, "github-app.pem");
    await writeFile(keyPath, "PRIVATE KEY", "utf8");
    await writeFile(
      envPath,
      [
        "LINEAR_API_KEY=linear-secret",
        "RISOLUTO_LIVE_MODEL_API_KEY=model-secret",
        "E2E_GITHUB_REPO=risolutohq/risoluto-live-sandbox",
        "GITHUB_APP_ID=123",
        "GITHUB_APP_INSTALLATION_ID=456",
        `GITHUB_APP_PRIVATE_KEY_FILE=${keyPath}`,
      ].join("\n"),
      "utf8",
    );

    const exitCode = await runLivePreflightCli(["--env-file", envPath, "--output-dir", outputDir], {
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ data: { viewer: { id: "linear-user" } } }))
        .mockResolvedValueOnce(jsonResponse({ message: "Bad credentials" }, { status: 401 }))
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-5.4-mini" }] })),
      createGitHubJwt: () => "jwt-token",
      now: () => "2026-05-25T10:00:00.000Z",
      env: {},
    });

    expect(exitCode).toBe(1);
    const artifact = await readFile(path.join(outputDir, "live-preflight-2026-05-25T10-00-00-000Z.json"), "utf8");
    expect(artifact).toContain('"overall": "failed"');
    expect(artifact).toContain('"github_app"');
    expect(artifact).not.toContain("linear-secret");
    expect(artifact).not.toContain("model-secret");
  });
});

function mockSuccessfulFetch(): typeof fetch {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ data: { viewer: { id: "linear-user" } } }))
    .mockResolvedValueOnce(jsonResponse({ token: "installation-token" }))
    .mockResolvedValueOnce(jsonResponse({ full_name: "risolutohq/risoluto-live-sandbox" }))
    .mockResolvedValueOnce(jsonResponse({ token: "installation-token" }))
    .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
    .mockResolvedValueOnce(jsonResponse({ object: { sha: "base-sha" } }))
    .mockResolvedValueOnce(jsonResponse({ ref: "refs/heads/risoluto-live-preflight-1700000000000" }))
    .mockResolvedValueOnce(jsonResponse({ content: { path: "risoluto-live-preflight/1700000000000.txt" } }))
    .mockResolvedValueOnce(
      jsonResponse({
        number: 42,
        html_url: "https://github.com/risolutohq/risoluto-live-sandbox/pull/42",
        state: "open",
        draft: true,
      }),
    )
    .mockResolvedValueOnce(jsonResponse({ id: 99, html_url: "https://github.com/comment/99" }))
    .mockResolvedValueOnce(jsonResponse({ state: "closed" }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-5.4-mini" }] }));
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
