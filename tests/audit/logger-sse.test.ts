import { describe, expect, it, vi } from "vitest";
import { TypedEventBus } from "../../src/core/event-bus.js";
import type { RisolutoEventMap } from "../../src/core/risoluto-events.js";
import { AuditLogger } from "../../src/audit/logger.js";

/** Stub db with the insert().values().run() chain plus the $client.prepare().get() the hash chain reads. */
function createMockDb() {
  return {
    insert: () => ({ values: () => ({ run: () => {} }) }),
    $client: { prepare: () => ({ get: () => undefined }) },
  };
}

describe("AuditLogger SSE emission", () => {
  it("emits audit.mutation when eventBus is provided", () => {
    const eventBus = new TypedEventBus<RisolutoEventMap>();
    const handler = vi.fn();
    eventBus.on("audit.mutation", handler);

    const logger = new AuditLogger(createMockDb() as never, eventBus);
    logger.log({
      tableName: "config",
      key: "test-key",
      operation: "update",
      previousValue: "old",
      newValue: "new",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "config",
        key: "test-key",
        operation: "update",
        actor: "operator",
      }),
    );
  });

  it("does not throw when eventBus is omitted", () => {
    const logger = new AuditLogger(createMockDb() as never);
    expect(() =>
      logger.log({
        tableName: "config",
        key: "test-key",
        operation: "update",
      }),
    ).not.toThrow();
  });
});
