import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { asRecord, asString } from "./helpers.js";
import { handleNotification } from "./notification-handler.js";
import { clearAllStreamingBuffers, composeSessionId } from "./turn-state.js";
import type { TurnState } from "./turn-state.js";
import { createSuccessResponse, type JsonRpcRequest } from "../codex/protocol.js";
import { JsonRpcConnection } from "../agent/json-rpc-connection.js";
import { prepareCodexRuntimeConfig, getRequiredProviderEnvNames } from "../codex/runtime-config.js";
import { buildDockerRunArgs, buildInitCacheVolumeArgs } from "../docker/spawn.js";
import { resolveWorkspaceExtraMountPaths } from "../docker/workspace-mounts.js";
import { inspectContainerRunning, removeContainer, removeVolume, stopContainer } from "../docker/lifecycle.js";
import { getContainerStats } from "../docker/stats.js";
import { handleCodexRequest } from "../agent/codex-request-handler.js";
import type { GithubApiToolClient } from "../git/github-api-tool.js";
import type { TrackerToolProvider } from "../tracker/tool-provider.js";
import { createMetricsCollector, type MetricsCollector } from "../observability/metrics.js";
import { createLifecycleEvent } from "../core/lifecycle-events.js";
import type { PathRegistry } from "../workspace/path-registry.js";
import type { AgentRunnerEventHandler } from "./contracts.js";
import type { Issue, ModelSelection, ServiceConfig, RisolutoLogger, Workspace } from "../core/types.js";

import type { PrecomputedRuntimeConfig } from "../codex/runtime-config.js";
import { CODEX_METHOD } from "../codex/methods.js";

export type { PrecomputedRuntimeConfig } from "../codex/runtime-config.js";

function parsePercent(value: string): number {
  const parsed = Number.parseFloat(value.replaceAll("%", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

// The docker CLI child only needs the variables required to locate the binary and reach
// the daemon. Provider secrets are injected explicitly as `-e NAME=value` args by
// buildDockerRunArgs, so the child must NOT inherit the full host env (RIS-256).
const DOCKER_CLI_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "DOCKER_HOST",
  // DOCKER_CONTEXT selects a non-default daemon when the operator uses `docker context use` and relies
  // on the env override; without it the main session targets the default context while the init
  // container (which inherits the full host env) targets the configured one — an asymmetric failure.
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "XDG_RUNTIME_DIR",
] as const;

function buildDockerCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of DOCKER_CLI_ENV_ALLOWLIST) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

export interface DockerSessionDeps {
  archiveDir?: string;
  pathRegistry?: PathRegistry;
  githubToolClient?: GithubApiToolClient;
  trackerToolProvider: TrackerToolProvider;
  logger: RisolutoLogger;
  spawnProcess?: typeof spawn;
  metrics?: MetricsCollector;
}

interface DockerSessionInput {
  issue: Issue;
  modelSelection: ModelSelection;
  workspace: Workspace;
  signal: AbortSignal;
  onEvent: AgentRunnerEventHandler;
}

export interface DockerSession {
  child: ChildProcessWithoutNullStreams;
  connection: JsonRpcConnection;
  containerName: string;
  threadId: string | null;
  turnId: string | null;
  exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  getFatalFailure: () => { code: string; message: string } | null;
  inspectRunning: () => Promise<boolean | null>;
  cleanup: (config: ServiceConfig, signal: AbortSignal) => Promise<void>;
  steerTurn: (message: string) => Promise<boolean>;
}

export async function createDockerSession(
  config: ServiceConfig,
  input: DockerSessionInput,
  deps: DockerSessionDeps,
  turnState: TurnState,
  precomputedRuntimeConfig?: PrecomputedRuntimeConfig,
): Promise<DockerSession> {
  const spawnProcess = deps.spawnProcess ?? spawn;
  const runtimeConfig = precomputedRuntimeConfig ?? (await prepareCodexRuntimeConfig(config.codex));
  const archiveDir = deps.archiveDir ?? path.join(process.cwd(), "archive");
  await mkdir(archiveDir, { recursive: true });

  input.onEvent(
    createLifecycleEvent({
      issue: input.issue,
      event: "container_starting",
      message: "Starting sandbox container",
      metadata: {
        image: config.codex.sandbox.image,
        workspacePath: input.workspace.path,
        model: input.modelSelection.model,
      },
    }),
  );

  const docker = buildDockerRunArgs({
    sandboxConfig: config.codex.sandbox,
    runId: `${input.issue.identifier}-${Date.now()}`,
    command: config.codex.command,
    workspacePath: input.workspace.path,
    archiveDir,
    extraMountPaths: await resolveWorkspaceExtraMountPaths(input.workspace.path, input.workspace.gitBaseDir),
    pathRegistry: deps.pathRegistry,
    runtimeConfigToml: runtimeConfig.configToml,
    runtimeAuthJsonBase64: runtimeConfig.authJsonBase64,
    requiredEnv: getRequiredProviderEnvNames(config.codex),
    issueIdentifier: input.issue.identifier,
    model: input.modelSelection.model,
    gitBaseDir: input.workspace.gitBaseDir,
  });

  // Initialize cache volume ownership before spawning the main container.
  // Docker creates new named volumes with root ownership, but the container
  // runs as a non-root user. This one-time init container chowns the volume.
  // Uses spawn directly (not the injected spawnProcess) because this is a
  // Docker utility command that should always run via Docker, not be mocked.
  const uid = os.userInfo().uid;
  const gid = os.userInfo().gid;
  const initCmd = buildInitCacheVolumeArgs({
    volumeName: docker.cacheVolumeName,
    uid,
    gid,
  });
  const initProcess = spawn(initCmd.program, initCmd.args, { stdio: "pipe" });
  initProcess.stdout.resume();
  initProcess.stderr.resume();
  try {
    await new Promise<void>((resolve, reject) => {
      initProcess.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Cache volume init failed with exit code ${code}`));
        }
      });
      initProcess.on("error", reject);
    });
  } catch (error) {
    // Init failed after the volume was created — remove it so we don't leak.
    await removeVolume(docker.cacheVolumeName).catch(() => undefined);
    throw error;
  }

  const child: ChildProcessWithoutNullStreams = spawnProcess(docker.program, docker.args, {
    env: buildDockerCliEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session = buildDockerSessionObject(child, docker, input, {
    inspectRunning: spawnProcess === spawn ? () => inspectContainerRunning(docker.containerName) : async () => true,
  });
  setupConnection(session, child, config, input, deps, turnState);
  startStatsPolling(session, input, deps);

  return session;
}

function buildDockerSessionObject(
  child: ChildProcessWithoutNullStreams,
  docker: { containerName: string; cacheVolumeName: string },
  input: DockerSessionInput,
  helpers: {
    inspectRunning: () => Promise<boolean | null>;
  },
): DockerSession & { abortHandler: () => void; statsInterval: ReturnType<typeof setInterval> | null } {
  const containerName = docker.containerName;
  const cacheVolumeName = docker.cacheVolumeName;

  // One idempotent teardown shared by the abort and normal-cleanup paths. Guards against
  // double-run so the container + cache volume are removed exactly once, and runs in full
  // even after an abort (the old abort path left the timer/container/volume behind).
  let teardownDone = false;

  // Placeholder getter — setupConnection replaces this with one that closes
  // over the real mutable fatalFailure inside the connection's request
  // handler. It runs synchronously after this factory returns and before any
  // caller observes the session.
  const session: DockerSession & { abortHandler: () => void; statsInterval: ReturnType<typeof setInterval> | null } = {
    child,
    connection: null as unknown as JsonRpcConnection,
    containerName,
    threadId: null,
    turnId: null,
    exitPromise: new Promise((resolve) => {
      child.once("exit", (code, sig) => resolve({ code, signal: sig }));
    }),
    getFatalFailure: () => null,
    inspectRunning: helpers.inspectRunning,
    abortHandler: () => {
      void (async () => {
        if (teardownDone) return;
        if (session.threadId && session.turnId) {
          const interrupted = await session.connection.interruptTurn(session.threadId, session.turnId, 3000);
          if (interrupted) {
            // Allow time for turn/completed notification before hard kill
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        await teardown();
      })();
    },
    statsInterval: null,
    steerTurn: async (message: string): Promise<boolean> => {
      if (!session.threadId || !session.turnId) return false;
      try {
        await session.connection.request(CODEX_METHOD.TurnSteer, {
          threadId: session.threadId,
          expectedTurnId: session.turnId,
          input: [{ type: "text", text: message }],
        });
        return true;
      } catch {
        return false;
      }
    },
    cleanup: async (cfg: ServiceConfig, signal: AbortSignal) => {
      if (teardownDone) return;
      if (!signal.aborted && cfg.codex.drainTimeoutMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, cfg.codex.drainTimeoutMs));
      }
      await teardown();
    },
  };

  // Clears the stats timer + abort listener, closes the connection, and removes the
  // container and cache volume — exactly once. Every removal is best-effort (logged
  // failures don't reject the attempt) so a Docker cleanup error can't fail the run, and
  // the cache volume is always reclaimed even when stop/remove throws (RIS-256).
  const teardown = async (): Promise<void> => {
    if (teardownDone) return;
    teardownDone = true;
    if (session.statsInterval) clearInterval(session.statsInterval);
    input.signal.removeEventListener("abort", session.abortHandler);
    session.connection.close();
    try {
      await stopContainer(containerName, 5).catch(() => undefined);
      await Promise.race([session.exitPromise, new Promise((resolve) => setTimeout(resolve, 5000))]).catch(
        () => undefined,
      );
      await removeContainer(containerName).catch(() => undefined);
    } finally {
      await removeVolume(cacheVolumeName).catch(() => undefined);
    }
  };

  input.signal.addEventListener("abort", session.abortHandler, { once: true });
  return session;
}

function setupConnection(
  session: DockerSession,
  child: ChildProcessWithoutNullStreams,
  config: ServiceConfig,
  input: DockerSessionInput,
  deps: DockerSessionDeps,
  turnState: TurnState,
): void {
  const logger = deps.logger.child({
    issueIdentifier: input.issue.identifier,
    workspacePath: input.workspace.path,
  });
  let fatalFailure: { code: string; message: string } | null = null;

  session.connection = new JsonRpcConnection(
    child,
    logger,
    config.codex.readTimeoutMs,
    async (request: JsonRpcRequest) => {
      const result = await handleCodexRequest(request, deps.trackerToolProvider, deps.githubToolClient, (sideEvent) => {
        input.onEvent({
          at: new Date().toISOString(),
          issueId: input.issue.id,
          issueIdentifier: input.issue.identifier,
          sessionId: session.threadId && session.turnId ? `${session.threadId}-${session.turnId}` : session.threadId,
          event: sideEvent.event,
          message: sideEvent.message,
          content: sideEvent.content ?? null,
          metadata: sideEvent.metadata ?? null,
        });
      });
      if (result.fatalFailure) {
        fatalFailure = result.fatalFailure;
        session.connection.close();
        return;
      }
      if (result.response !== undefined) {
        child.stdin.write(`${JSON.stringify(createSuccessResponse(request.id, result.response))}\n`);
      }
    },
    (notification) => {
      if (notification.method === "turn/started") {
        const turn = asRecord(asRecord(notification.params).turn);
        session.turnId = asString(turn.id) ?? session.turnId;
      }
      handleNotification({
        state: turnState,
        notification,
        issue: input.issue,
        threadId: session.threadId,
        turnId: session.turnId,
        onEvent: input.onEvent,
      });
    },
  );

  // Attach the real fatalFailure getter, which closes over the mutable
  // fatalFailure tracked by the JsonRpcConnection request handler above.
  session.getFatalFailure = () => fatalFailure;

  // Wrap cleanup so any pending streaming-buffer flush timers are cancelled
  // on session teardown. Otherwise scheduled flushes can fire after the
  // session is gone and invoke onEvent against a dead context. cleanup runs
  // in both normal-exit and abort paths.
  const originalCleanup = session.cleanup;
  session.cleanup = async (cfg, signal) => {
    clearAllStreamingBuffers(turnState);
    await originalCleanup(cfg, signal);
  };
}

function startStatsPolling(
  session: DockerSession & { statsInterval: ReturnType<typeof setInterval> | null },
  input: DockerSessionInput,
  deps: DockerSessionDeps,
): void {
  const statsIntervalMs = 30_000;
  const metrics = deps.metrics ?? createMetricsCollector();
  session.statsInterval = setInterval(async () => {
    try {
      const stats = await getContainerStats(session.containerName);
      if (stats) {
        input.onEvent({
          at: new Date().toISOString(),
          issueId: input.issue.id,
          issueIdentifier: input.issue.identifier,
          sessionId: composeSessionId(session.threadId, session.turnId),
          event: "container_stats",
          message: `CPU ${stats.cpuPercent} | MEM ${stats.memoryUsage}/${stats.memoryLimit} (${stats.memoryPercent})`,
        });
        metrics.containerCpuPercent.set(parsePercent(stats.cpuPercent), { issue: input.issue.identifier });
        metrics.containerMemoryPercent.set(parsePercent(stats.memoryPercent), { issue: input.issue.identifier });
      }
    } catch {
      // intentionally swallowed — stats are best-effort
    }
  }, statsIntervalMs);
}
