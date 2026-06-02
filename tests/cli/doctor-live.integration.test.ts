import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-cli-doctor-live-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("doctor live write probes", () => {
  it("does not perform provider writes when --live is absent", async () => {
    const dir = await createTempDir();
    const workflowDir = path.join(dir, ".risoluto", "workflows");
    const envPath = await writeLiveEnv(dir);
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { main } = await import("../../src/cli/index.js");

    await expect(main(["doctor", "--workflow-dir", workflowDir, "--live-env-file", envPath, "--json"])).resolves.toBe(
      0,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("announces write intent before doctor --live performs provider writes", async () => {
    const dir = await createTempDir();
    const workflowDir = path.join(dir, ".risoluto", "workflows");
    const envPath = await writeLiveEnv(dir);
    const fetchImpl = mockSuccessfulFetch();
    const stdout: string[] = [];
    const warnings: string[] = [];
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });
    vi.spyOn(console, "warn").mockImplementation((line: string) => {
      warnings.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main(["doctor", "--workflow-dir", workflowDir, "--live", "--live-env-file", envPath, "--json"]),
    ).resolves.toBe(0);

    expect(warnings[0]).toContain("doctor --live will perform provider write probes");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/git/refs"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/contents/"),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/pulls"),
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/git/refs/heads/risoluto-live-preflight-"),
      expect.objectContaining({ method: "DELETE" }),
    );
    const result = JSON.parse(stdout[0]) as { checks: Array<{ id: string; status: string; message: string }> };
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "live_write_intent", status: "passed" }),
        expect.objectContaining({ id: "live_github_app_sandbox_lifecycle", status: "passed" }),
      ]),
    );
  });

  it("reports provider, permission, and response class when a live write probe fails", async () => {
    const dir = await createTempDir();
    const workflowDir = path.join(dir, ".risoluto", "workflows");
    const envPath = await writeLiveEnv(dir);
    const stdout: string[] = [];
    vi.stubGlobal("fetch", mockFailedWriteFetch());
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main(["doctor", "--workflow-dir", workflowDir, "--live", "--live-env-file", envPath, "--json"]),
    ).resolves.toBe(1);

    const result = JSON.parse(stdout[0]) as { checks: Array<{ id: string; status: string; message: string }> };
    const failedWrite = result.checks.find((check) => check.id === "live_github_app_sandbox_lifecycle");
    expect(failedWrite).toMatchObject({ status: "failed" });
    expect(failedWrite?.message).toContain("provider=github_app");
    expect(failedWrite?.message).toContain("permission=sandbox_write");
    expect(failedWrite?.message).toContain("HTTP 403");
  });
});

async function writeLiveEnv(dir: string): Promise<string> {
  const workflowDir = path.join(dir, ".risoluto", "workflows");
  await mkdir(workflowDir, { recursive: true });
  const keyPath = path.join(dir, "github-app.pem");
  const envPath = path.join(dir, ".env.live.local");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
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
  return envPath;
}

function mockSuccessfulFetch(): typeof fetch {
  return baseLiveFetch()
    .mockResolvedValueOnce(jsonResponse({ ref: "refs/heads/risoluto-live-preflight-1700000000000" }))
    .mockResolvedValueOnce(jsonResponse({ content: { path: "risoluto-live-preflight/1700000000000.txt" } }))
    .mockResolvedValueOnce(jsonResponse({ number: 42, html_url: "https://github.com/acme/repo/pull/42" }))
    .mockResolvedValueOnce(jsonResponse({ id: 99 }))
    .mockResolvedValueOnce(jsonResponse({ state: "closed" }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-5.4-mini" }] }));
}

function mockFailedWriteFetch(): typeof fetch {
  return baseLiveFetch()
    .mockResolvedValueOnce(jsonResponse({ ref: "refs/heads/risoluto-live-preflight-1700000000000" }))
    .mockResolvedValueOnce(jsonResponse({ content: { path: "risoluto-live-preflight/1700000000000.txt" } }))
    .mockResolvedValueOnce(jsonResponse({ message: "write forbidden" }, { status: 403 }))
    .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-5.4-mini" }] }));
}

function baseLiveFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ data: { viewer: { id: "linear-user" } } }))
    .mockResolvedValueOnce(jsonResponse({ token: "installation-token" }))
    .mockResolvedValueOnce(jsonResponse({ full_name: "risolutohq/risoluto-live-sandbox" }))
    .mockResolvedValueOnce(jsonResponse({ token: "installation-token" }))
    .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
    .mockResolvedValueOnce(jsonResponse({ object: { sha: "base-sha" } }));
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
