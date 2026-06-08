import type { TypedEventBus } from "../core/event-bus.js";
import type { RisolutoEventMap } from "../core/risoluto-events.js";
import type { RisolutoLogger, WebhookConfig } from "../core/types.js";
import type { OrchestratorPort } from "../orchestrator/port.js";
import type { PersistenceRuntime } from "../persistence/sqlite/runtime.js";
import type { SecretsStore } from "../secrets/store.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID, type WorkflowRunStatus } from "../workflow-run/contracts.js";
import type { LinearTriggeredWorkflowRunRequest } from "../workflow-run/linear-intake.js";
import { parseWorkflowRunStatus, WorkflowRunStatusError } from "../workflow-run/run-status.js";
import { observeExternalStatusChange } from "../workflow-run/status-projection.js";
import type { GitHubTriggeredWorkflowRunRequest } from "../workflow-run/tracker-intake.js";
import { DefaultWebhookHealthTracker, type WebhookHealthTracker } from "./health-tracker.js";
import type { WebhookHandlerDeps } from "./linear-handler.js";
import type { WebhookPort, WebhookPortSnapshot } from "./port.js";
import { WebhookRegistrar, type WebhookRegistrationPort } from "./registrar.js";

type WebhookLinearClient = WebhookRegistrationPort & {
  runGraphQL(query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export function evaluateWebhookConfig(
  webhookConfig: WebhookConfig | null | undefined,
  logger: RisolutoLogger,
): boolean {
  if (webhookConfig?.webhookUrl && webhookConfig.webhookSecret) {
    logger.info({ webhookUrl: webhookConfig.webhookUrl }, "webhook mode enabled — waiting for first verified delivery");
    return true;
  }

  if (webhookConfig?.webhookUrl && !webhookConfig.webhookSecret) {
    logger.warn(
      { webhookUrl: webhookConfig.webhookUrl },
      "webhook_url is configured but webhook_secret is missing — set $LINEAR_WEBHOOK_SECRET or configure webhook_secret in Settings",
    );
  }

  return false;
}

/**
 * Record an inbound external (Linear board) status change as a read-only observation (NIN-270 AC3).
 *
 * The canonical Workflow Run status is sourced from the orchestrator's current view of the run. When
 * that runtime status is not a canonical Workflow Run status (e.g. the orchestrator's transient
 * "stopping"/"retrying"), there is no canonical truth to compare against, so the observation is
 * skipped rather than fabricated. This path never mutates run state — it only emits the observation.
 */
function recordExternalStatusObservation(
  orchestrator: Pick<OrchestratorPort, "getIssueDetail">,
  logger: RisolutoLogger,
  input: { issueId: string; issueIdentifier: string; externalStatus: string },
): void {
  const detail = orchestrator.getIssueDetail(input.issueIdentifier);
  if (!detail) {
    return;
  }

  let canonicalRunStatus: WorkflowRunStatus;
  try {
    canonicalRunStatus = parseWorkflowRunStatus(detail.status);
  } catch (error) {
    if (error instanceof WorkflowRunStatusError) {
      return;
    }
    throw error;
  }

  const observation = observeExternalStatusChange({
    workflowRunId: detail.issueId,
    workflowDefinitionId: DEFAULT_WORKFLOW_DEFINITION_ID,
    provider: "linear",
    canonicalRunStatus,
    externalStatus: input.externalStatus,
    observedAt: new Date().toISOString(),
  });

  logger.info(
    {
      workflow_run_id: observation.workflowRunId,
      issue_identifier: input.issueIdentifier,
      canonical_run_status: observation.canonicalRunStatus,
      external_status: observation.externalStatus,
      observed_at: observation.observedAt,
    },
    "external tracker status observed — canonical Workflow Run truth unchanged",
  );
}

export interface WebhookService extends WebhookPort {
  webhookHealthTracker: WebhookHealthTracker | undefined;
  webhookInbox: PersistenceRuntime["webhook"]["inbox"] | undefined;
  webhookRegistrar: WebhookRegistrar | undefined;
}

export function createWebhookService(input: {
  persistence: PersistenceRuntime;
  webhookConfig: WebhookConfig | null | undefined;
  linearClient: WebhookLinearClient | null;
  eventBus: TypedEventBus<RisolutoEventMap>;
  secretsStore: Pick<SecretsStore, "get" | "set" | "delete">;
  acceptLinearTriggeredWorkflowRun?: (input: LinearTriggeredWorkflowRunRequest) => Promise<unknown>;
  acceptGitHubTriggeredWorkflowRun?: (input: GitHubTriggeredWorkflowRunRequest) => Promise<unknown>;
  logger: RisolutoLogger;
}): WebhookService {
  const webhookConfig = input.webhookConfig;
  const webhookUrlSet = !!webhookConfig?.webhookUrl;
  const _webhookEnabled = evaluateWebhookConfig(webhookConfig, input.logger);
  const webhookPersistence = webhookUrlSet ? input.persistence.webhook : undefined;

  const webhookInbox = webhookPersistence?.inbox;
  const webhookHealthTracker = webhookUrlSet
    ? new DefaultWebhookHealthTracker({
        config: webhookConfig!,
        eventBus: input.eventBus,
        logger: input.logger.child({ component: "webhook-health" }),
        linearClient: input.linearClient ?? undefined,
      })
    : undefined;

  const resolvedWebhookSecret = { current: webhookConfig?.webhookSecret ?? null };
  const resolvedPreviousWebhookSecret = webhookConfig?.previousWebhookSecret ?? null;

  const webhookRegistrar =
    webhookUrlSet && input.linearClient
      ? new WebhookRegistrar({
          linearClient: input.linearClient,
          secretsStore: input.secretsStore,
          getWebhookConfig: () => input.webhookConfig,
          onSecretResolved: (secret) => {
            resolvedWebhookSecret.current = secret;
          },
          logger: input.logger.child({ component: "webhook-registrar" }),
        })
      : undefined;

  return {
    webhookUrlSet,
    webhookHealthTracker,
    webhookInbox,
    webhookRegistrar,
    resolvedWebhookSecret,
    resolvedPreviousWebhookSecret,
    buildHandlerDeps({ orchestrator, logger }): WebhookHandlerDeps | undefined {
      if (!webhookUrlSet) {
        return undefined;
      }

      const handlerLogger = logger.child({ component: "webhook-handler" });

      return {
        getWebhookSecret: () => resolvedWebhookSecret.current,
        getPreviousWebhookSecret: () => resolvedPreviousWebhookSecret,
        requestRefresh: (reason: string) => orchestrator.requestRefresh(reason),
        requestTargetedRefresh: (issueId: string, issueIdentifier: string, reason: string) =>
          orchestrator.requestTargetedRefresh(issueId, issueIdentifier, reason),
        stopWorkerForIssue: (issueIdentifier: string, reason: string) =>
          orchestrator.stopWorkerForIssue(issueIdentifier, reason),
        observeExternalStatusChange: (statusInput) =>
          recordExternalStatusObservation(orchestrator, handlerLogger, statusInput),
        recordVerifiedDelivery: (eventType: string) => webhookHealthTracker?.recordVerifiedDelivery(eventType),
        acceptLinearTriggeredWorkflowRun: input.acceptLinearTriggeredWorkflowRun,
        acceptGitHubTriggeredWorkflowRun: input.acceptGitHubTriggeredWorkflowRun,
        webhookInbox,
        eventBus: input.eventBus,
        logger: handlerLogger,
      };
    },
    async getSnapshot(limit = 20): Promise<WebhookPortSnapshot> {
      if (!webhookPersistence) {
        return {
          health: webhookHealthTracker?.getHealth() ?? null,
          inboxStats: null,
          recentDeliveries: [],
        };
      }

      const snapshot = await webhookPersistence.getSnapshot(limit);
      return {
        health: webhookHealthTracker?.getHealth() ?? null,
        inboxStats: snapshot.stats,
        recentDeliveries: snapshot.recent,
      };
    },
  };
}
