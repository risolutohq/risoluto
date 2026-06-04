import { describe, it, expect } from "vitest";
import { projectCodexNotificationParams } from "../../src/codex/notification-projection.js";

describe("codex notification projection (RIS-237)", () => {
  it("drops prompt text, tool arguments, and account metadata", () => {
    const projected = projectCodexNotificationParams({
      threadId: "t-1",
      prompt: "do the secret thing",
      arguments: { command: "curl http://evil" },
      account: { email: "user@example.com", plan: "pro" },
    });
    expect(projected).toEqual({ threadId: "t-1" });
    expect(projected.prompt).toBeUndefined();
    expect(projected.arguments).toBeUndefined();
    expect(projected.account).toBeUndefined();
  });

  it("keeps allowlisted scalar fields", () => {
    const projected = projectCodexNotificationParams({
      threadId: "t-1",
      turnId: "turn-2",
      requestId: "req-3",
      status: "completed",
      index: 4,
      archived: false,
    });
    expect(projected).toEqual({
      threadId: "t-1",
      turnId: "turn-2",
      requestId: "req-3",
      status: "completed",
      index: 4,
      archived: false,
    });
  });

  it("replaces a structured value on an allowlisted key with [omitted]", () => {
    const projected = projectCodexNotificationParams({
      status: { nested: "object" },
    });
    expect(projected.status).toBe("[omitted]");
  });

  it("redacts a secret that appears inside an allowlisted scalar value", () => {
    const projected = projectCodexNotificationParams({
      reason: "failed: Authorization: Bearer sk-livesecrettoken1234567890",
    });
    expect(String(projected.reason)).not.toContain("sk-livesecrettoken1234567890");
  });
});
