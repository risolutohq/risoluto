import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";

import { bearerAuth } from "./auth.js";
import type { AgentRunnerEventHandler } from "../agent-runner/contracts.js";
import { AgentRunner } from "../agent-runner/index.js";
import type { DispatchRequest, DispatchStreamMessage, PrecomputedRuntimeConfig, DataPlaneHealth } from "./types.js";
import { createTracker } from "../tracker/factory.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { createGitHubToolProvider } from "../cli/runtime-providers.js";
import { PathRegistry } from "../workspace/path-registry.js";
import { createLogger } from "../core/logger.js";
import { toErrorString } from "../utils/type-guards.js";

const logger = createLogger().child({ component: "data-plane" });

/**
 * Validate all required fields of a DispatchRequest body.
 * Returns a human-readable error string if invalid, null if valid.
 */
function validateDispatchRequest(body: DispatchRequest): string | null {
  if (!body.issue || !body.config || !body.workspace) {
    return "missing required fields: issue, config, workspace";
  }
  if (typeof body.promptTemplate !== "string") {
    return "invalid or missing field: promptTemplate must be a string";
  }
  if (typeof body.modelSelection !== "object" || body.modelSelection === null) {
    return "invalid or missing field: modelSelection must be an object";
  }
  if (body.attempt !== null && body.attempt !== undefined && typeof body.attempt !== "number") {
    return "invalid field: attempt must be a number or null";
  }
  if (typeof body.codexRuntimeConfigToml !== "string") {
    return "invalid or missing field: codexRuntimeConfigToml must be a string";
  }
  return null;
}

/** Express application extended with a drain handle for graceful shutdown. */
export type DataPlaneApp = express.Application & { drain: () => void };

/**
 * Create the data plane Express server.
 * Returns a standard Express Application augmented with a `drain()` method
 * that aborts all in-flight dispatches — call it before `server.close()`.
 */
export function createDataPlaneServer(secret: string): DataPlaneApp {
  const app = express();
  const activeDispatches = new Map<string, AbortController>();

  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    const health: DataPlaneHealth = {
      status: "ok",
      activeDispatches: activeDispatches.size,
    };
    res.json(health);
  });

  app.post("/dispatch", bearerAuth(secret), async (req: Request, res: Response) => {
    try {
      const dispatchRequest = req.body as DispatchRequest;

      const validationError = validateDispatchRequest(dispatchRequest);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const {
        workflowRun,
        issue,
        attempt,
        modelSelection,
        promptTemplate,
        workspace,
        config,
        codexRuntimeConfigToml,
        codexRuntimeAuthJsonBase64,
      } = dispatchRequest;

      const runId = workflowRun?.id ?? issue.id;
      const runIdentifier = workflowRun?.identifier ?? issue.identifier;

      logger.info({ runIdentifier }, "Received dispatch request");

      const abortController = new AbortController();
      activeDispatches.set(runId, abortController);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Transfer-Encoding", "chunked");
      res.flushHeaders();

      const sendSSE = (message: DispatchStreamMessage) => {
        res.write(`data: ${JSON.stringify(message)}\n\n`);
      };

      const onEvent: AgentRunnerEventHandler = (event) => {
        sendSSE({ type: "event", payload: event });
      };

      const { tracker, trackerToolProvider } = createTracker(() => config, logger);
      const workspaceManager = new WorkspaceManager(() => config, logger.child({ component: "workspace" }));
      const gitManager = createGitHubToolProvider(() => config, { env: process.env });
      const pathRegistry = PathRegistry.fromEnv();
      const archiveDir = path.join(process.env.DATA_DIR ?? "/data", "archives");

      const agentRunner = new AgentRunner({
        getConfig: () => config,
        tracker,
        trackerToolProvider,
        workspaceManager,
        archiveDir,
        pathRegistry,
        githubToolClient: gitManager,
        logger: logger.child({ component: "agent-runner" }),
      });

      // Pre-computed runtime config (avoids reading auth.json from disk)
      const precomputedRuntimeConfig: PrecomputedRuntimeConfig = {
        configToml: codexRuntimeConfigToml,
        authJsonBase64: codexRuntimeAuthJsonBase64,
      };

      try {
        const outcome = await agentRunner.runAttempt({
          issue,
          workflowRun,
          attempt,
          modelSelection,
          promptTemplate,
          workspace,
          signal: abortController.signal,
          onEvent,
          precomputedRuntimeConfig,
        });

        sendSSE({ type: "outcome", payload: outcome });
        logger.info({ runIdentifier, outcome: outcome.kind }, "Dispatch completed");
      } catch (error) {
        logger.error({ error: toErrorString(error), runIdentifier }, "Dispatch failed");
        sendSSE({
          type: "outcome",
          payload: {
            kind: "failed",
            errorCode: "dispatch_error",
            errorMessage: toErrorString(error),
            threadId: null,
            turnId: null,
            turnCount: 0,
          },
        });
      } finally {
        activeDispatches.delete(runId);
        res.end();
      }
    } catch (error) {
      logger.error({ error: toErrorString(error) }, "Dispatch handler error");
      if (!res.headersSent) {
        res.status(500).json({ error: "internal server error" });
      }
    }
  });

  app.post("/dispatch/:runId/abort", bearerAuth(secret), (req: Request, res: Response) => {
    const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
    const abortController = activeDispatches.get(runId);

    if (!abortController) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    abortController.abort();
    logger.info({ runId }, "Dispatch aborted");
    res.json({ status: "aborted" });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ error: toErrorString(err) }, "Unhandled server error");
    if (!res.headersSent) {
      res.status(500).json({ error: "internal server error" });
    }
  });

  const drain = (): void => {
    for (const [, controller] of activeDispatches) {
      controller.abort();
    }
  };

  (app as unknown as DataPlaneApp).drain = drain;
  return app as unknown as DataPlaneApp;
}
