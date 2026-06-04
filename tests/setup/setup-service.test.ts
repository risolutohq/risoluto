import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigOverlayStore } from "../../src/config/overlay.js";
import { SecretsStore } from "../../src/secrets/store.js";
import { createSetupService } from "../../src/setup/setup-service.js";
import { buildSilentLogger, buildStubOrchestrator, buildStubTracker } from "../helpers/http-server-harness.js";

const MASTER_KEY = "test-master-key-32chars-exactly!!";
const originalEnv = { ...process.env };

let tmpDir: string;
let secretsStore: SecretsStore;
let configOverlayStore: ConfigOverlayStore;
let orchestrator: ReturnType<typeof buildStubOrchestrator>;
let tracker: ReturnType<typeof buildStubTracker>;

beforeEach(async () => {
  process.env = { ...originalEnv };
  delete process.env.OPENAI_API_KEY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.LINEAR_API_KEY;

  tmpDir = await mkdtemp(path.join(os.tmpdir(), "setup-service-"));
  const logger = buildSilentLogger();

  secretsStore = new SecretsStore(tmpDir, logger);
  await secretsStore.startDeferred();

  configOverlayStore = new ConfigOverlayStore(path.join(tmpDir, "overlay.yaml"), logger);
  await configOverlayStore.start();

  orchestrator = buildStubOrchestrator();
  tracker = buildStubTracker();
});

afterEach(async () => {
  process.env = { ...originalEnv };
  await configOverlayStore.stop();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  vi.restoreAllMocks();
});

describe("setup-service", () => {
  it("drives the setup status through master-key, Linear selection, and Codex auth from one boundary", async () => {
    const service = createSetupService({
      secretsStore,
      configOverlayStore,
      orchestrator,
      archiveDir: tmpDir,
      tracker,
    });

    expect(service.getStatus()).toEqual({
      configured: false,
      steps: {
        masterKey: { done: false },
        linearProject: { done: false },
        repoRoute: { done: false },
        openaiKey: { done: false },
        githubToken: { done: false },
      },
    });

    await service.createMasterKey(MASTER_KEY);
    await service.selectLinearProject("RIS");
    await service.saveCodexAuth(JSON.stringify({ access_token: "tok_abc", refresh_token: "ref_123" }));

    expect(orchestrator.start).toHaveBeenCalledTimes(1);
    expect(orchestrator.requestRefresh).toHaveBeenCalledWith("setup");

    expect(service.getStatus()).toEqual({
      configured: true,
      steps: {
        masterKey: { done: true },
        linearProject: { done: true },
        repoRoute: { done: false },
        openaiKey: { done: true },
        githubToken: { done: false },
      },
    });

    const authJson = await readFile(path.join(tmpDir, "codex-auth", "auth.json"), "utf8");
    expect(JSON.parse(authJson)).toMatchObject({
      tokens: {
        access_token: "tok_abc",
        refresh_token: "ref_123",
      },
    });
  });

  it("resets secrets, auth overlay, and master key from the shared setup boundary", async () => {
    secretsStore = new SecretsStore(tmpDir, buildSilentLogger(), { masterKey: MASTER_KEY });
    await secretsStore.start();
    await secretsStore.set("LINEAR_API_KEY", "lin_test");
    await secretsStore.set("GITHUB_TOKEN", "gh_test");
    await configOverlayStore.set("codex.auth.mode", "openai_login");
    await configOverlayStore.set("codex.auth.source_home", "/tmp/auth");

    const service = createSetupService({
      secretsStore,
      configOverlayStore,
      orchestrator,
      archiveDir: tmpDir,
      tracker,
    });

    await service.reset();

    expect(orchestrator.stop).toHaveBeenCalledTimes(1);
    expect(secretsStore.isInitialized()).toBe(false);
    expect(secretsStore.list()).toEqual([]);
    expect(configOverlayStore.toMap()).toMatchObject({
      codex: {
        auth: {
          mode: "",
          source_home: "",
        },
      },
    });
    expect(await readFile(path.join(tmpDir, "master.key"), "utf8")).toBe("");
  });

  it("manages repo routes through the shared setup boundary", async () => {
    const service = createSetupService({
      secretsStore,
      configOverlayStore,
      orchestrator,
      archiveDir: tmpDir,
      tracker,
    });

    expect(service.getRepoRoutes()).toEqual({ routes: [] });

    await service.saveRepoRoute({
      repoUrl: "https://github.com/org/repo-a",
      defaultBranch: "develop",
      identifierPrefix: "ris",
      label: "triage",
    });
    await service.saveRepoRoute({
      repoUrl: "https://github.com/org/repo-b",
      identifierPrefix: "OPS",
    });

    expect(service.getRepoRoutes()).toEqual({
      routes: [
        {
          repo_url: "https://github.com/org/repo-a",
          default_branch: "develop",
          identifier_prefix: "RIS",
          label: "triage",
        },
        {
          repo_url: "https://github.com/org/repo-b",
          default_branch: "main",
          identifier_prefix: "OPS",
        },
      ],
    });

    const deleteResult = await service.deleteRepoRoute(0);
    expect(deleteResult).toEqual({
      ok: true,
      routes: [
        {
          repo_url: "https://github.com/org/repo-b",
          default_branch: "main",
          identifier_prefix: "OPS",
        },
      ],
    });
  });

  it("rejects an invalid defaultBranch that fails git ref-format rules (RIS-253)", async () => {
    const service = createSetupService({
      secretsStore,
      configOverlayStore,
      orchestrator,
      archiveDir: tmpDir,
      tracker,
    });

    await expect(
      service.saveRepoRoute({
        repoUrl: "https://github.com/org/repo",
        defaultBranch: "-dangerous..branch",
        identifierPrefix: "RIS",
      }),
    ).rejects.toThrow("not a valid git branch name");

    // Nothing persisted for the rejected route.
    expect(service.getRepoRoutes()).toEqual({ routes: [] });
  });

  it("rolls back the secret and codex overlay when an OpenAI key write fails (RIS-253)", async () => {
    const initializedSecrets = new SecretsStore(tmpDir, buildSilentLogger(), { masterKey: MASTER_KEY });
    await initializedSecrets.start();

    const overlayStub = {
      toMap: () => ({}),
      set: vi.fn(async (pathExpr: string) => {
        if (pathExpr === "codex.provider.base_url") throw new Error("disk full");
        return true;
      }),
      delete: vi.fn(async () => true),
      applyPatch: vi.fn(async () => true),
      subscribe: vi.fn(() => () => {}),
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    const service = createSetupService({
      secretsStore: initializedSecrets,
      configOverlayStore: overlayStub as never,
      orchestrator,
      archiveDir: tmpDir,
      tracker,
    });

    await expect(
      service.saveOpenaiKey("sk-key", { supplied: true, baseUrl: "http://127.0.0.1:8080/v1", name: null }),
    ).rejects.toThrow("Failed to persist the OpenAI key configuration");

    // Secret rolled back (no prior value → deleted) and the codex section reverted.
    expect(initializedSecrets.get("OPENAI_API_KEY")).toBeNull();
    expect(overlayStub.delete).toHaveBeenCalledWith("codex");
  });

  it("rolls back the project slug when orchestrator.start fails (RIS-253)", async () => {
    orchestrator.start.mockRejectedValueOnce(new Error("startup boom"));
    const service = createSetupService({
      secretsStore,
      configOverlayStore,
      orchestrator,
      archiveDir: tmpDir,
      tracker,
    });

    await expect(service.selectLinearProject("RIS")).rejects.toThrow("Failed to start after selecting the project");

    const trackerSection = configOverlayStore.toMap().tracker as Record<string, unknown> | undefined;
    expect(trackerSection?.project_slug).toBeUndefined();
  });

  it("surfaces a GitHub auth failure distinctly when a token is present (RIS-253)", async () => {
    process.env.GITHUB_TOKEN = "ghtok";
    const service = createSetupService({
      secretsStore,
      configOverlayStore,
      orchestrator,
      archiveDir: tmpDir,
      tracker,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("forbidden", { status: 403 }));

    await expect(service.detectDefaultBranch("https://github.com/openai/risoluto")).rejects.toThrow(
      /invalid or expired/,
    );
  });

  it("detects the default branch and falls back to main through the shared setup boundary", async () => {
    const service = createSetupService({
      secretsStore,
      configOverlayStore,
      orchestrator,
      archiveDir: tmpDir,
      tracker,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ default_branch: "trunk" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(service.detectDefaultBranch("https://github.com/openai/risoluto")).resolves.toEqual({
      defaultBranch: "trunk",
    });

    fetchMock.mockRejectedValueOnce(new Error("network failure"));
    await expect(service.detectDefaultBranch("https://github.com/openai/risoluto")).resolves.toEqual({
      defaultBranch: "main",
    });
  });
});
