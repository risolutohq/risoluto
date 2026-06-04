import type { Response } from "express";

import type { TypedEventBus } from "../core/event-bus.js";
import type { RisolutoEventMap } from "../core/risoluto-events.js";
import type { RisolutoLogger } from "../core/types.js";
import { toErrorString } from "../utils/type-guards.js";

export interface VerifiedWebhookDelivery {
  deliveryId: string;
  /** SHA-256 digest of the verified raw body + signature; dedupes replays under a fresh delivery id. */
  bodyDigest?: string | null;
  type: string;
  action: string;
  entityId: string | null;
  issueId: string | null;
  issueIdentifier: string | null;
  webhookTimestamp: number | null;
  payloadJson: string | null;
}

export interface VerifiedWebhookDeliveryStore {
  insertVerified(delivery: VerifiedWebhookDelivery): Promise<{ isNew: boolean }>;
  /** Mark a durably-recorded delivery as successfully applied after its side effects complete. */
  markApplied?(deliveryId: string): Promise<void>;
  /** Move a delivery to a durable retryable state when its side effects fail after the ack. */
  markForRetry?(deliveryId: string, error: string, attemptCount: number, nextAttemptAt: string): Promise<void>;
  /** Drop a durably-recorded delivery so the source's redelivery is reprocessed instead of deduped. */
  discardVerified?(deliveryId: string): Promise<void>;
}

/** Backoff before a failed delivery's first retry becomes due. */
const RETRY_BACKOFF_MS = 60_000;

interface DeliveryLogContext {
  deliveryId: string;
  type: string;
  action: string;
}

class WebhookInboxUnavailableError extends Error {
  constructor() {
    super("webhook inbox persistence is unavailable");
  }
}

function deliveryLogContext(delivery: VerifiedWebhookDelivery): DeliveryLogContext {
  return {
    deliveryId: delivery.deliveryId,
    type: delivery.type,
    action: delivery.action,
  };
}

export class WebhookDeliveryWorkflow {
  constructor(
    private readonly logger: RisolutoLogger,
    private readonly store?: VerifiedWebhookDeliveryStore,
    private readonly eventBus?: Pick<TypedEventBus<RisolutoEventMap>, "emit">,
  ) {}

  respondAccepted(
    res: Response,
    options: {
      delivery: VerifiedWebhookDelivery;
      status?: number;
      body?: unknown;
      eventType?: string;
      recordVerifiedDelivery?: (eventType: string) => void;
      process: () => void | Promise<void>;
      duplicateMessage?: string;
      errorMessage?: string;
    },
  ): void {
    void this.handleDelivery(res, options).catch((error) => {
      // Only a pre-ack inbox-unavailable error reaches here; post-ack processing failures are handled
      // inline by runProcessing so the response is never double-sent.
      if (error instanceof WebhookInboxUnavailableError && !res.headersSent) {
        res.status(503).json({
          error: {
            code: "webhook_inbox_unavailable",
            message: "Webhook inbox persistence is unavailable",
          },
        });
        return;
      }

      this.logger.error(
        {
          ...deliveryLogContext(options.delivery),
          error: toErrorString(error),
        },
        options.errorMessage ?? "webhook delivery processing failed",
      );
    });
  }

  private async handleDelivery(
    res: Response,
    options: {
      delivery: VerifiedWebhookDelivery;
      status?: number;
      body?: unknown;
      eventType?: string;
      recordVerifiedDelivery?: (eventType: string) => void;
      process: () => void | Promise<void>;
      duplicateMessage?: string;
      errorMessage?: string;
    },
  ): Promise<void> {
    const isNew = await this.ensureNew(options.delivery);
    if (!isNew) {
      res.status(options.status ?? 200).json(options.body ?? { ok: true });
      this.logger.debug(
        deliveryLogContext(options.delivery),
        options.duplicateMessage ?? "duplicate webhook delivery skipped",
      );
      return;
    }

    // The delivery is now durably recorded (status received) BEFORE the ack, so a crash or a later
    // processing failure can't silently drop it. Only then do we ack and run the deferred side effects.
    res.status(options.status ?? 200).json(options.body ?? { ok: true });

    if (options.eventType && options.recordVerifiedDelivery) {
      options.recordVerifiedDelivery(options.eventType);
    }

    await this.runProcessing(options);
  }

  /**
   * Run the deferred side effects after the ack. On success the durable record is marked applied; on
   * failure it is moved to a retryable state (not just logged) so an early ack can't drop a delivery
   * whose side effects later fail (NIN-262).
   */
  private async runProcessing(options: {
    delivery: VerifiedWebhookDelivery;
    process: () => void | Promise<void>;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await options.process();
    } catch (error) {
      this.logger.error(
        { ...deliveryLogContext(options.delivery), error: toErrorString(error) },
        options.errorMessage ?? "webhook delivery processing failed",
      );
      await this.transitionForRetry(options.delivery, toErrorString(error));
      return;
    }
    await this.transitionApplied(options.delivery);
  }

  private async transitionApplied(delivery: VerifiedWebhookDelivery): Promise<void> {
    try {
      await this.store?.markApplied?.(delivery.deliveryId);
    } catch (error) {
      this.logger.error(
        { ...deliveryLogContext(delivery), error: toErrorString(error) },
        "failed to mark webhook delivery applied",
      );
    }
  }

  private async transitionForRetry(delivery: VerifiedWebhookDelivery, error: string): Promise<void> {
    try {
      const nextAttemptAt = new Date(Date.now() + RETRY_BACKOFF_MS).toISOString();
      await this.store?.markForRetry?.(delivery.deliveryId, error, 1, nextAttemptAt);
    } catch (retryError) {
      this.logger.error(
        { ...deliveryLogContext(delivery), error: toErrorString(retryError) },
        "failed to mark webhook delivery for retry",
      );
    }
  }

  async ensureNew(delivery: VerifiedWebhookDelivery): Promise<boolean> {
    if (!this.store) {
      return true;
    }

    try {
      const result = await this.store.insertVerified(delivery);
      return result.isNew;
    } catch (error) {
      this.logger.error(
        {
          ...deliveryLogContext(delivery),
          error: toErrorString(error),
        },
        "webhook inbox insert failed — dropping delivery to preserve durable dedupe",
      );
      this.eventBus?.emit("system.error", {
        message: "Webhook inbox insert failed; delivery was dropped to preserve durable dedupe.",
        context: {
          ...deliveryLogContext(delivery),
          error: toErrorString(error),
        },
      });
      throw new WebhookInboxUnavailableError();
    }
  }
}
