import type { RunAttemptDispatcher } from "../dispatch/types.js";
import type { WorkflowRunStatusMapping } from "../workflow-run/status-projection.js";
import type { AttemptStorePort } from "../core/attempt-store-port.js";
import type { CostSampleStorePort } from "../core/cost-sample-port.js";
import type { HealthRunner } from "../health/health-runner.js";
import { ConfigStore } from "../config/store.js";
import type { TypedEventBus } from "../core/event-bus.js";
import type { RisolutoEventMap } from "../core/risoluto-events.js";
import type { GitIntegrationPort } from "../git/port.js";
import type { TrackerPort } from "../tracker/port.js";
import type { NotificationManager } from "../notification/manager.js";
import type { RepoMatch, RepoRouter } from "../git/repo-router.js";
import type { WebhookHealthTracker } from "../webhook/health-tracker.js";
import type { PromptTemplateStore } from "../prompt/store.js";
import type { ObservabilityHub } from "../observability/hub.js";
import type {
  AttemptRecord,
  Issue,
  ModelSelection,
  RetryEntry,
  RisolutoLogger,
  TokenUsageSnapshot,
  Workspace,
} from "../core/types.js";
import type { StopSignal } from "../core/signal-detection.js";
import type { WorkspacePort } from "../workspace/port.js";
import type { IssueConfigStorePort } from "../core/issue-config-port.js";
import type { MetricsCollector } from "../observability/metrics.js";

export interface RunningEntry {
  runId: string;
  issue: Issue;
  workspace: Workspace;
  startedAtMs: number;
  lastEventAtMs: number;
  attempt: number | null;
  abortController: AbortController;
  promise: Promise<void>;
  cleanupOnExit: boolean;
  status: "running" | "stopping";
  sessionId: string | null;
  tokenUsage: TokenUsageSnapshot | null;
  modelSelection: ModelSelection;
  lastAgentMessageContent: string | null;
  /** Stop signal detected from raw (pre-truncation) agent message. */
  lastStopSignal: StopSignal | null;
  repoMatch: RepoMatch | null;
  queuePersistence: (task: () => Promise<void>) => void;
  flushPersistence: () => Promise<void>;
  steerTurn?: (message: string) => Promise<boolean>;
}

export interface LaunchWorkerOptions {
  claimHeld?: boolean;
  previousThreadId?: string | null;
  recoveredAttempt?: AttemptRecord | null;
  modelSelectionOverride?: ModelSelection | null;
}

export type RetryRuntimeEntry = RetryEntry & { issue: Issue; workspaceKey: string | null };

export interface OrchestratorDeps {
  attemptStore: AttemptStorePort;
  costSampleStore: CostSampleStorePort;
  /** Real-signal per-subsystem health prober. Optional — orchestrator skips probe ticks when absent. */
  healthRunner?: HealthRunner;
  configStore: ConfigStore;
  tracker: TrackerPort;
  workspaceManager: WorkspacePort;
  agentRunner: RunAttemptDispatcher;
  issueConfigStore: IssueConfigStorePort;
  eventBus?: TypedEventBus<RisolutoEventMap>;
  notificationManager?: NotificationManager;
  repoRouter?: Pick<RepoRouter, "matchIssue">;
  gitManager?: GitIntegrationPort;
  webhookHealthTracker?: WebhookHealthTracker;
  templateStore?: PromptTemplateStore;
  logger: RisolutoLogger;
  resolveTemplate: (identifier: string) => Promise<string>;
  metrics?: MetricsCollector;
  observability?: ObservabilityHub;
  /**
   * Resolve the workflow-level status mapping from the run's persisted resolved definition (NIN-77).
   * Supplied from the Workflow Run archive when `archiveDir` is available. Absent for legacy setups
   * that pre-date the archive or in test harnesses that don't wire archive access.
   */
  resolveWorkflowStatusMapping?: (workflowRunId: string) => Promise<WorkflowRunStatusMapping | undefined>;
  /**
   * Drive each polled candidate issue through the same intake idempotency path as the webhook leg
   * so webhook delivery + polling reconciliation for the same external issue collapse to ONE Workflow
   * Run (NIN-106). When absent the polling tick skips intake; the orchestrator still dispatches based
   * on the raw tracker state alone.
   */
  pollTrackerIssue?: (issue: Issue) => Promise<void>;
}
