import { beforeEach, describe, it, expect, vi } from "vitest";
import http from "node:http";
import { createDataPlaneServer } from "../../src/dispatch/server.js";
import type { IncomingMessage } from "node:http";
import type { ServiceConfig } from "../../src/core/types.js";

const runAttemptMock = vi.hoisted(() =>
  vi.fn(async () => ({
    kind: "normal" as const,
    errorCode: null,
    errorMessage: null,
    threadId: "thread-1",
    turnId: "turn-1",
    turnCount: 1,
  })),
);

// Mock dependencies
vi.mock("../../src/core/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock("../../src/agent-runner/index.js", () => ({
  AgentRunner: class {
    async runAttempt(input: unknown) {
      return runAttemptMock(input);
    }
  },
}));

// Helper to make requests to the Express app
async function makeRequest(
  app: ReturnType<typeof createDataPlaneServer>,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        server.close();
        reject(new Error("Failed to get server address"));
        return;
      }

      const port = address.port;

      const bodyString = options.body ? JSON.stringify(options.body) : "";
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(bodyString),
            ...options.headers,
          },
        },
        (res: IncomingMessage) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(res.headers)) {
              headers[key] = Array.isArray(value) ? value[0] : (value ?? "");
            }
            try {
              resolve({
                status: res.statusCode ?? 0,
                body: data ? JSON.parse(data) : null,
                headers,
              });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: data, headers });
            } finally {
              server.close();
            }
          });
        },
      );

      req.on("error", (err) => {
        server.close();
        reject(err);
      });

      req.write(bodyString);
      req.end();
    });
  });
}

describe("Data plane server", () => {
  const secret = "test-secret";

  beforeEach(() => {
    runAttemptMock.mockReset();
    runAttemptMock.mockResolvedValue({
      kind: "normal",
      errorCode: null,
      errorMessage: null,
      threadId: "thread-1",
      turnId: "turn-1",
      turnCount: 1,
    });
  });

  describe("GET /health", () => {
    it("returns 200 without auth", async () => {
      const app = createDataPlaneServer(secret);
      const response = await makeRequest(app, "GET", "/health");
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "ok");
    });
  });

  describe("POST /dispatch", () => {
    it("returns 401 without auth", async () => {
      const app = createDataPlaneServer(secret);
      const response = await makeRequest(app, "POST", "/dispatch", { body: {} });
      expect(response.status).toBe(401);
    });

    it("returns 401 with wrong auth", async () => {
      const app = createDataPlaneServer(secret);
      const response = await makeRequest(app, "POST", "/dispatch", {
        body: {},
        headers: { Authorization: "Bearer wrong-secret" },
      });
      expect(response.status).toBe(401);
    });

    it("returns 400 with missing required fields", async () => {
      const app = createDataPlaneServer(secret);
      const response = await makeRequest(app, "POST", "/dispatch", {
        body: {},
        headers: { Authorization: `Bearer ${secret}` },
      });
      expect(response.status).toBe(400);
    });

    it("returns 400 when issue/config/workspace are present but promptTemplate is missing", async () => {
      const app = createDataPlaneServer(secret);
      const body = createDispatchRequestBody();
      const { promptTemplate: _omitted, ...bodyWithoutPrompt } = body as Record<string, unknown>;
      const response = await makeRequest(app, "POST", "/dispatch", {
        body: bodyWithoutPrompt,
        headers: { Authorization: `Bearer ${secret}` },
      });
      expect(response.status).toBe(400);
    });

    it("returns 400 when modelSelection is missing", async () => {
      const app = createDataPlaneServer(secret);
      const body = createDispatchRequestBody();
      const { modelSelection: _omitted, ...bodyWithoutModel } = body as Record<string, unknown>;
      const response = await makeRequest(app, "POST", "/dispatch", {
        body: bodyWithoutModel,
        headers: { Authorization: `Bearer ${secret}` },
      });
      expect(response.status).toBe(400);
    });

    it("returns 400 when codexRuntimeConfigToml is missing", async () => {
      const app = createDataPlaneServer(secret);
      const body = createDispatchRequestBody();
      const { codexRuntimeConfigToml: _omitted, ...bodyWithoutToml } = body as Record<string, unknown>;
      const response = await makeRequest(app, "POST", "/dispatch", {
        body: bodyWithoutToml,
        headers: { Authorization: `Bearer ${secret}` },
      });
      expect(response.status).toBe(400);
    });

    it("addresses active dispatches by Workflow Run id when present", async () => {
      runAttemptMock.mockImplementationOnce(
        (input: { signal: AbortSignal }) =>
          new Promise((resolve) => {
            input.signal.addEventListener(
              "abort",
              () =>
                resolve({
                  kind: "cancelled",
                  errorCode: "operator_abort",
                  errorMessage: "worker cancelled by operator request",
                  threadId: null,
                  turnId: null,
                  turnCount: 0,
                }),
              { once: true },
            );
          }),
      );

      const app = createDataPlaneServer(secret);
      const dispatchPromise = makeRequest(app, "POST", "/dispatch", {
        body: createDispatchRequestBody({
          workflowRun: {
            id: "workflow-run-1",
            identifier: "WR-1",
            title: "Workflow Run dispatch",
            url: "https://linear.app/test/WR-1",
          },
          issue: {
            ...mockIssue,
            id: "legacy-issue-1",
            identifier: "LEG-1",
            title: "Legacy issue compatibility",
          },
        }),
        headers: { Authorization: `Bearer ${secret}` },
      });

      await waitFor(() => runAttemptMock.mock.calls.length > 0);

      const abortResponse = await makeRequest(app, "POST", "/dispatch/workflow-run-1/abort", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (abortResponse.status !== 200) {
        await makeRequest(app, "POST", "/dispatch/legacy-issue-1/abort", {
          headers: { Authorization: `Bearer ${secret}` },
        });
      }
      const dispatchResponse = await dispatchPromise;

      expect(abortResponse.status).toBe(200);
      expect(abortResponse.body).toEqual({ status: "aborted" });
      expect(dispatchResponse.status).toBe(200);
      expect(dispatchResponse.body).toContain('"kind":"cancelled"');
    });
  });

  describe("POST /dispatch/:runId/abort", () => {
    it("returns 401 without auth", async () => {
      const app = createDataPlaneServer(secret);
      const response = await makeRequest(app, "POST", "/dispatch/test-id/abort");
      expect(response.status).toBe(401);
    });

    it("returns 404 for unknown run", async () => {
      const app = createDataPlaneServer(secret);
      const response = await makeRequest(app, "POST", "/dispatch/unknown-run-id/abort", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      expect(response.status).toBe(404);
    });
  });
});

const mockIssue = {
  id: "test-id",
  identifier: "TEST-1",
  title: "Test Issue",
  description: "desc",
  priority: 1,
  state: "active",
  branchName: null,
  url: "https://linear.app/test/TEST-1",
  labels: [],
  blockedBy: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const mockConfig = {
  tracker: {
    kind: "linear",
    apiKey: "test-key",
    endpoint: "https://api.linear.app",
    projectSlug: "test",
    activeStates: [],
    terminalStates: [],
  },
  polling: { intervalMs: 30000 },
  workspace: {
    root: "/tmp/workspaces",
    hooks: { afterCreate: null, beforeRun: null, afterRun: null, beforeRemove: null, timeoutMs: 30000 },
  },
  agent: {
    maxConcurrentAgents: 3,
    maxConcurrentAgentsByState: {},
    maxTurns: 50,
    maxRetryBackoffMs: 60000,
    maxContinuationAttempts: 5,
    successState: null,
    stallTimeoutMs: 60000,
  },
  codex: {
    command: "codex",
    model: "test-model",
    reasoningEffort: null,
    approvalPolicy: "suggest",
    threadSandbox: "none",
    turnSandboxPolicy: { type: "none" },
    readTimeoutMs: 30000,
    turnTimeoutMs: 300000,
    drainTimeoutMs: 5000,
    startupTimeoutMs: 60000,
    stallTimeoutMs: 60000,
    auth: { mode: "api_key", sourceHome: "/tmp" },
    provider: null,
    sandbox: {
      image: "test",
      network: "none",
      security: { noNewPrivileges: true, dropCapabilities: true, gvisor: false, seccompProfile: "" },
      resources: { memory: "1g", memoryReservation: "512m", memorySwap: "2g", cpus: "1", tmpfsSize: "100m" },
      extraMounts: [],
      envPassthrough: [],
      logs: { driver: "json-file", maxSize: "10m", maxFile: 3 },
      egressAllowlist: [],
    },
  },
  server: { port: 4000 },
} as unknown as ServiceConfig;

function createDispatchRequestBody(
  overrides: {
    workflowRun?: Record<string, unknown>;
    issue?: Record<string, unknown>;
  } = {},
) {
  return {
    workflowRun: overrides.workflowRun ?? {
      id: "test-id",
      identifier: "TEST-1",
      title: "Test Issue",
      url: "https://linear.app/test/TEST-1",
    },
    issue: overrides.issue ?? mockIssue,
    attempt: 1,
    modelSelection: { model: "test-model", reasoningEffort: null, source: "default" },
    promptTemplate: "Test prompt",
    workspace: { path: "/tmp/workspaces/TEST-1", workspaceKey: "TEST-1", createdNow: false },
    config: mockConfig,
    codexRuntimeConfigToml: 'model = "test-model"\n',
    codexRuntimeAuthJsonBase64: null,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}
