import { describe, expect, it, beforeEach } from "vitest";

import { openDatabase, closeDatabase, type RisolutoDatabase } from "../../src/persistence/sqlite/database.js";
import { PromptTemplateStore } from "../../src/prompt/store.js";
import { PromptTemplateValidationError } from "../../src/prompt/template-policy.js";
import { createLogger } from "../../src/core/logger.js";

let db: RisolutoDatabase;
let store: PromptTemplateStore;

beforeEach(() => {
  db = openDatabase(":memory:");
  store = new PromptTemplateStore(db, createLogger());
  return () => closeDatabase(db);
});

describe("PromptTemplateStore — CRUD", () => {
  it("creates and retrieves a template", () => {
    const created = store.create({ id: "test", name: "Test", body: "Hello {{ issue.title }}" });
    expect(created.id).toBe("test");
    expect(created.body).toBe("Hello {{ issue.title }}");

    const retrieved = store.get("test");
    expect(retrieved).toMatchObject({ id: "test", name: "Test" });
  });

  it("rejects unsupported Liquid filters when creating a template", () => {
    expect(() => store.create({ id: "bad", name: "Bad", body: "{{ 7 | plus: 7 }}" })).toThrow(
      PromptTemplateValidationError,
    );
  });

  it("returns null for nonexistent template", () => {
    expect(store.get("nope")).toBeNull();
  });

  it("lists all templates", () => {
    store.create({ id: "a", name: "Alpha", body: "body a" });
    store.create({ id: "b", name: "Beta", body: "body b" });
    const list = store.list();
    expect(list).toHaveLength(2);
  });

  it("updates a template name and body", () => {
    store.create({ id: "t", name: "Old", body: "old body" });
    const updated = store.update("t", { name: "New", body: "new body" });
    expect(updated).toMatchObject({ name: "New", body: "new body" });

    const retrieved = store.get("t");
    expect(retrieved?.name).toBe("New");
    expect(retrieved?.body).toBe("new body");
  });

  it("rejects unsupported Liquid statements on update", () => {
    store.create({ id: "t", name: "Old", body: "{{ issue.title }}" });
    expect(() => store.update("t", { body: "{% assign x = issue.title %}" })).toThrow(PromptTemplateValidationError);
  });

  it("update returns null for nonexistent template", () => {
    expect(store.update("nope", { name: "x" })).toBeNull();
  });

  it("removes a template", () => {
    store.create({ id: "t", name: "T", body: "b" });
    expect(store.remove("t")).toEqual({ deleted: true });
    expect(store.get("t")).toBeNull();
  });

  it("remove returns not-deleted for nonexistent template", () => {
    expect(store.remove("nope")).toEqual({ deleted: false });
  });

  it("remove blocks deletion of the currently active template", () => {
    store.create({ id: "active-tpl", name: "Active", body: "body" });
    // Insert a config row selecting this template as active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (db as any).$client;
    raw
      .prepare("INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)")
      .run("system", JSON.stringify({ selectedTemplateId: "active-tpl" }), new Date().toISOString());

    const result = store.remove("active-tpl");
    expect(result.deleted).toBe(false);
    expect(result.error).toContain("cannot delete the active template");
    expect(store.get("active-tpl")).not.toBeNull();
  });

  it("remove survives corrupt JSON in config system section", () => {
    store.create({ id: "tpl", name: "T", body: "b" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (db as any).$client;
    raw
      .prepare("INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)")
      .run("system", "{not valid json", new Date().toISOString());

    // Should not throw; the corrupt JSON path logs a warning and falls through to delete
    const result = store.remove("tpl");
    expect(result.deleted).toBe(true);
  });
});

describe("PromptTemplateStore — preview", () => {
  it("renders a template with sample data", async () => {
    store.create({ id: "p", name: "P", body: "Issue: {{ issue.identifier }} - {{ issue.title }}" });
    const result = await store.preview("p");
    expect(result.error).toBeNull();
    expect(result.rendered).toContain("PROJ-42");
    expect(result.rendered).toContain("Example issue for template preview");
  });

  it("returns error for nonexistent template", async () => {
    const result = await store.preview("nope");
    expect(result.error).toContain("not found");
  });

  it("returns error for unsupported Liquid syntax", async () => {
    const result = await store.renderPreview("{{ issue.title | upcase }}");
    expect(result.error).toContain("unsupported Liquid output expression");
  });

  it("renderPreview works with raw body string", async () => {
    const result = await store.renderPreview("Attempt {{ attempt }}");
    expect(result.error).toBeNull();
    expect(result.rendered).toContain("1");
  });

  it("allows the default conditional shape", async () => {
    const result = await store.renderPreview("{% if issue.description %}{{ issue.description }}{% endif %}");
    expect(result.error).toBeNull();
    expect(result.rendered).toContain("sample issue description");
  });
});
