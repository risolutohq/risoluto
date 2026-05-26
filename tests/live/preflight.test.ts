import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveLivePreflightConfig } from "../../src/config/live-preflight-config.js";
import { runLivePreflight } from "../../src/live/preflight.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-live-preflight-run-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runLivePreflight", () => {
  it("checks Linear, GitHub App sandbox access, and the model proxy without leaking secrets", async () => {
    const dir = await createTempDir();
    const keyPath = path.join(dir, "github-app.pem");
    await writeFile(keyPath, "PRIVATE KEY", "utf8");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { viewer: { id: "linear-user" } } }))
      .mockResolvedValueOnce(jsonResponse({ token: "installation-token" }))
      .mockResolvedValueOnce(jsonResponse({ full_name: "risolutohq/risoluto-live-sandbox" }))
      .mockResolvedValueOnce(jsonResponse({ token: "installation-token" }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ object: { sha: "base-sha" } }))
      .mockResolvedValueOnce(jsonResponse({ ref: "refs/heads/risoluto-live-preflight-1779712800000" }))
      .mockResolvedValueOnce(jsonResponse({ content: { path: "risoluto-live-preflight/1779712800000.txt" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          number: 24,
          html_url: "https://github.com/risolutohq/risoluto-live-sandbox/pull/24",
          state: "open",
          draft: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 12, html_url: "https://github.com/comment/12" }))
      .mockResolvedValueOnce(jsonResponse({ state: "closed" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-5.4-mini" }, { id: "gpt-5.5" }] }));

    const config = await resolveLivePreflightConfig({
      LINEAR_API_KEY: "linear-secret",
      RISOLUTO_LIVE_MODEL_API_KEY: "model-secret",
      E2E_GITHUB_REPO: "risolutohq/risoluto-live-sandbox",
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY_FILE: keyPath,
    });

    const report = await runLivePreflight(config, {
      fetch: fetchImpl,
      createGitHubJwt: () => "jwt-token",
      now: () => "2026-05-25T10:00:00.000Z",
    });

    expect(report.overall).toBe("passed");
    expect(report.checks.map((check) => [check.name, check.status])).toEqual([
      ["config", "passed"],
      ["linear", "passed"],
      ["github_app", "passed"],
      ["github_app_sandbox_lifecycle", "passed"],
      ["model_proxy", "passed"],
    ]);
    expect(report.checks.find((check) => check.name === "model_proxy")?.resource).toMatchObject({
      profile: "pr-live-smoke",
      model: "gpt-5.4-mini",
    });
    expect(JSON.stringify(report)).not.toContain("linear-secret");
    expect(JSON.stringify(report)).not.toContain("model-secret");
    expect(JSON.stringify(report)).not.toContain("installation-token");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/app/installations/456/access_tokens",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer jwt-token" }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      13,
      "https://cliproxy.dreampedia.app/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer model-secret" }),
      }),
    );
  });

  it("records a GitHub App sandbox lifecycle with cleanup evidence", async () => {
    const dir = await createTempDir();
    const keyPath = path.join(dir, "github-app.pem");
    await writeFile(keyPath, "PRIVATE KEY", "utf8");
    const fetchImpl = vi
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
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-5.4-mini" }, { id: "gpt-5.5" }] }));

    const config = await resolveLivePreflightConfig({
      LINEAR_API_KEY: "linear-secret",
      RISOLUTO_LIVE_MODEL_API_KEY: "model-secret",
      E2E_GITHUB_REPO: "risolutohq/risoluto-live-sandbox",
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY_FILE: keyPath,
    });

    const report = await runLivePreflight(config, {
      fetch: fetchImpl,
      createGitHubJwt: () => "jwt-token",
      now: () => "2023-11-14T22:13:20.000Z",
    });

    const lifecycle = report.checks.find((check) => check.name === "github_app_sandbox_lifecycle");
    expect(lifecycle).toMatchObject({
      status: "passed",
      resource: {
        repo: "risolutohq/risoluto-live-sandbox",
        branch: "risoluto-live-preflight-1700000000000",
        markerPath: "risoluto-live-preflight/1700000000000.txt",
        prNumber: "42",
        prUrl: "https://github.com/risolutohq/risoluto-live-sandbox/pull/42",
        commentId: "99",
        cleanup: "closed_pr_deleted_branch",
      },
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      "https://api.github.com/repos/risolutohq/risoluto-live-sandbox/git/ref/heads/main",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      "https://api.github.com/repos/risolutohq/risoluto-live-sandbox/git/refs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ref: "refs/heads/risoluto-live-preflight-1700000000000", sha: "base-sha" }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      8,
      "https://api.github.com/repos/risolutohq/risoluto-live-sandbox/contents/risoluto-live-preflight/1700000000000.txt",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"branch":"risoluto-live-preflight-1700000000000"'),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      12,
      "https://api.github.com/repos/risolutohq/risoluto-live-sandbox/git/refs/heads/risoluto-live-preflight-1700000000000",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(JSON.stringify(report)).not.toContain("installation-token");
  });

  it("skips cleanly when credentials are missing", async () => {
    const config = await resolveLivePreflightConfig({});
    const report = await runLivePreflight(config, { fetch: vi.fn<typeof fetch>() });

    expect(report.overall).toBe("skipped");
    expect(report.checks).toEqual([
      expect.objectContaining({
        name: "config",
        status: "skipped",
      }),
    ]);
  });

  it("fails before network access when forbidden stale env is present", async () => {
    const config = await resolveLivePreflightConfig({
      CLIPROXY_API_KEY: "stale",
    });
    const fetchImpl = vi.fn<typeof fetch>();

    const report = await runLivePreflight(config, { fetch: fetchImpl });

    expect(report.overall).toBe("failed");
    expect(report.checks[0]).toMatchObject({
      name: "config",
      status: "failed",
      detail: "forbidden env present: CLIPROXY_API_KEY",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports provider failures instead of throwing", async () => {
    const dir = await createTempDir();
    const keyPath = path.join(dir, "github-app.pem");
    await writeFile(keyPath, "PRIVATE KEY", "utf8");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { viewer: { id: "linear-user" } } }))
      .mockResolvedValueOnce(jsonResponse({ message: "Bad credentials" }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-5.4-mini" }] }));

    const config = await resolveLivePreflightConfig({
      LINEAR_API_KEY: "linear-secret",
      RISOLUTO_LIVE_MODEL_API_KEY: "model-secret",
      E2E_GITHUB_REPO: "risolutohq/risoluto-live-sandbox",
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY_FILE: keyPath,
    });

    const report = await runLivePreflight(config, {
      fetch: fetchImpl,
      createGitHubJwt: () => "jwt-token",
    });

    expect(report.overall).toBe("failed");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "github_app",
          status: "failed",
          detail: "GitHub App token request returned HTTP 401",
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain("linear-secret");
    expect(JSON.stringify(report)).not.toContain("model-secret");
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
