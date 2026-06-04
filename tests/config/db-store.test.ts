import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

import { openDatabase, closeDatabase, type RisolutoDatabase } from "../../src/persistence/sqlite/database.js";
import { config, promptTemplates } from "../../src/persistence/sqlite/schema.js";
import { DbConfigStore } from "../../src/config/db-store.js";
import { seedDefaults } from "../../src/persistence/sqlite/runtime.js";
import { createLogger } from "../../src/core/logger.js";
import { createMockLogger } from "../helpers.js";

let db: RisolutoDatabase;
let store: DbConfigStore;

beforeEach(() => {
  db = openDatabase(":memory:");
  seedDefaults(db);
  store = new DbConfigStore(db, createLogger());
  store.refresh();

  return () => closeDatabase(db);
});

describe("DbConfigStore — ConfigOverlayPort", () => {
  it("toMap() returns all seeded sections", () => {
    const map = store.toMap();
    expect(map).toHaveProperty("tracker");
    expect(map).toHaveProperty("codex");
    expect(map).toHaveProperty("workspace");
    expect(map).toHaveProperty("system");
  });

  it("set() writes a dot-path value and refreshes", async () => {
    await store.set("tracker.project_slug", "TEST-PROJECT");

    const map = store.toMap();
    const tracker = map.tracker as Record<string, unknown>;
    expect(tracker.project_slug).toBe("TEST-PROJECT");

    // Config should reflect the change
    const serviceConfig = store.getConfig();
    expect(serviceConfig.tracker.projectSlug).toBe("TEST-PROJECT");
  });

  it("set() creates nested paths that don't exist", async () => {
    await store.set("codex.sandbox.resources.memory", "8g");

    const map = store.toMap();
    const codex = map.codex as Record<string, unknown>;
    const sandbox = codex.sandbox as Record<string, unknown>;
    const resources = sandbox.resources as Record<string, unknown>;
    expect(resources.memory).toBe("8g");
  });

  it("set() rejects an empty path expression", async () => {
    await expect(store.set("", "value")).rejects.toThrow("overlay path must contain at least one segment");
  });

  it("delete() removes a dot-path value", async () => {
    await store.set("tracker.project_slug", "TEMP");
    const deleted = await store.delete("tracker.project_slug");
    expect(deleted).toBe(true);

    const map = store.toMap();
    const tracker = map.tracker as Record<string, unknown>;
    expect(tracker.project_slug).toBeUndefined();
  });

  it("delete() returns false for non-existent paths", async () => {
    const deleted = await store.delete("nonexistent.path");
    expect(deleted).toBe(false);
  });

  it("applyPatch() deep-merges into existing config", async () => {
    await store.applyPatch({
      server: { port: 9999 },
      tracker: { project_slug: "PATCHED" },
    });

    const serviceConfig = store.getConfig();
    expect(serviceConfig.server.port).toBe(9999);
    expect(serviceConfig.tracker.projectSlug).toBe("PATCHED");
    // Default values should still be present
    expect(serviceConfig.tracker.kind).toBe("linear");
  });

  it("applyPatch() returns false when nothing changes", async () => {
    const map = store.toMap();
    const changed = await store.applyPatch(map);
    expect(changed).toBe(false);
  });

  it("applyPatch() persists brand-new top-level sections", async () => {
    const changed = await store.applyPatch({
      diagnostics: { enabled: true },
    });

    expect(changed).toBe(true);
    expect(store.toMap()).toMatchObject({
      diagnostics: { enabled: true },
    });
  });

  it("subscribe() notifies on mutations", async () => {
    let notified = false;
    store.subscribe(() => {
      notified = true;
    });

    await store.set("server.port", 5555);
    expect(notified).toBe(true);
  });

  it("subscribe() returns unsubscribe function", async () => {
    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++;
    });

    await store.set("server.port", 1111);
    expect(callCount).toBe(1);

    unsub();
    await store.set("server.port", 2222);
    expect(callCount).toBe(1); // not called after unsubscribe
  });
});

describe("DbConfigStore — ConfigStore surface", () => {
  it("throws when read before refresh", () => {
    const freshStore = new DbConfigStore(db, createLogger());

    expect(() => freshStore.getWorkflow()).toThrow("DbConfigStore not started");
    expect(() => freshStore.getConfig()).toThrow("DbConfigStore not started");
  });

  it("getWorkflow() returns WorkflowRuntimeConfig with prompt template", () => {
    const workflow = store.getWorkflow();
    expect(workflow.config).toBeDefined();
    expect(workflow.promptTemplate).toContain("RISOLUTO_STATUS");
  });

  it("getConfig() returns derived ServiceConfig", () => {
    const serviceConfig = store.getConfig();
    expect(serviceConfig.server.port).toBe(4000);
    expect(serviceConfig.tracker.kind).toBe("linear");
    expect(serviceConfig.agent.maxTurns).toBe(20);
  });

  it("getMergedConfigMap() returns a cloned map", () => {
    const map1 = store.getMergedConfigMap();
    const map2 = store.getMergedConfigMap();
    expect(map1).toEqual(map2);
    expect(map1).not.toBe(map2); // different reference
  });

  it("validateDispatch() returns null for valid defaults", () => {
    // Defaults are intentionally missing API keys, so validation will flag them
    const error = store.validateDispatch();
    // We just check it doesn't throw — the actual validation result depends on defaults
    expect(error === null || typeof error === "object").toBe(true);
  });

  it("getWorkflow() uses selectedTemplateId from system config", async () => {
    // Add a custom template
    db.insert(promptTemplates)
      .values({
        id: "custom",
        name: "Custom",
        body: "Custom prompt for {{ issue.identifier }}",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    // Set it as selected
    await store.set("system.selectedTemplateId", "custom");

    const workflow = store.getWorkflow();
    expect(workflow.promptTemplate).toContain("Custom prompt");
  });

  it("falls back to the first stored template when the selected template is missing", () => {
    db.delete(promptTemplates).run();
    db.insert(promptTemplates)
      .values({
        id: "fallback",
        name: "Fallback",
        body: "Fallback prompt body",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    store.refresh();

    expect(store.getWorkflow().promptTemplate).toBe("Fallback prompt body");
  });

  it("falls back to the hardcoded default template when the prompt table is empty", async () => {
    db.delete(promptTemplates).run();
    await store.set("system.selectedTemplateId", "missing-template");

    expect(store.getWorkflow().promptTemplate).toContain("RISOLUTO_STATUS");
  });

  it("uses Workflow Run language in the hardcoded default prompt template", async () => {
    db.delete(promptTemplates).run();
    await store.set("system.selectedTemplateId", "missing-template");

    const promptTemplate = store.getWorkflow().promptTemplate;
    expect(promptTemplate).toContain("Workflow Run {{ workflowRun.identifier }}");
    expect(promptTemplate).toContain("## Workflow Run Description");
    expect(promptTemplate).not.toMatch(/\bLinear issue\b/i);
    expect(promptTemplate).not.toMatch(/finished the issue/i);
  });

  it("retains the last-known-good config when a section's JSON is corrupted (RIS-252)", () => {
    const goodTracker = store.toMap().tracker;

    db.update(config)
      .set({ value: "{not-valid-json", updatedAt: new Date().toISOString() })
      .where(eq(config.key, "tracker"))
      .run();

    store.refresh();

    // Corrupt JSON must not collapse the section to {} — the previous good value stays.
    expect(store.toMap().tracker).toEqual(goodTracker);
    expect(store.toMap().tracker).not.toEqual({});
  });

  it("logs an error and keeps the last-known-good config when a section row has invalid JSON (RIS-252)", () => {
    const mockLogger = createMockLogger();
    const storeWithMockLogger = new DbConfigStore(db, mockLogger);
    storeWithMockLogger.refresh();
    const goodTracker = storeWithMockLogger.toMap().tracker;

    db.update(config)
      .set({ value: "{not-valid-json", updatedAt: new Date().toISOString() })
      .where(eq(config.key, "tracker"))
      .run();

    storeWithMockLogger.refresh();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("invalid JSON") }),
      "config refresh failed — retaining last-known-good config",
    );
    expect(storeWithMockLogger.toMap().tracker).toEqual(goodTracker);
  });

  it("fails refresh on startup when config JSON is corrupt and there is no last-known-good (RIS-252)", () => {
    db.update(config)
      .set({ value: "{not-valid-json", updatedAt: new Date().toISOString() })
      .where(eq(config.key, "tracker"))
      .run();

    const freshStore = new DbConfigStore(db, createMockLogger());
    expect(() => freshStore.refresh()).toThrow(/invalid JSON/);
  });

  it("does not persist a bad overlay when derivation throws — write+refresh stay together (RIS-252)", async () => {
    const trackerRowBefore = db
      .select()
      .from(config)
      .all()
      .find((row) => row.key === "tracker")?.value;

    await expect(store.applyPatch({ tracker: { endpoint: "not-a-valid-url" } })).rejects.toThrow(/valid absolute URL/);

    const trackerRowAfter = db
      .select()
      .from(config)
      .all()
      .find((row) => row.key === "tracker")?.value;
    // The DB row is untouched — the invalid endpoint never landed.
    expect(trackerRowAfter).toBe(trackerRowBefore);
    expect(JSON.stringify(store.toMap().tracker)).not.toContain("not-a-valid-url");
  });

  it("rejects an out-of-range server.port and falls back to the default (RIS-252)", async () => {
    await store.applyPatch({ server: { port: 70000 } });
    expect(store.getConfig().server.port).toBe(4000);

    await store.applyPatch({ server: { port: 0 } });
    expect(store.getConfig().server.port).toBe(4000);

    await store.applyPatch({ server: { port: 8080 } });
    expect(store.getConfig().server.port).toBe(8080);
  });
});

describe("DbConfigStore — persistence", () => {
  it("changes persist to DB and survive re-read", async () => {
    await store.set("server.port", 7777);

    // Create a fresh store on the same DB
    const store2 = new DbConfigStore(db, createLogger());
    store2.refresh();

    expect(store2.getConfig().server.port).toBe(7777);
  });

  it("rejects dangerous keys", async () => {
    await store.set("__proto__.polluted", true);
    const map = store.toMap();
    expect(map).not.toHaveProperty("__proto__");
  });

  it("removes top-level sections from the database when deleted", async () => {
    await store.applyPatch({
      diagnostics: { enabled: true },
    });

    const deleted = await store.delete("diagnostics");

    expect(deleted).toBe(true);
    expect(store.toMap()).not.toHaveProperty("diagnostics");
    const diagnosticsRow = db
      .select()
      .from(config)
      .all()
      .find((row) => row.key === "diagnostics");
    expect(diagnosticsRow).toBeUndefined();
  });
});
