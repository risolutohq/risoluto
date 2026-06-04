import { describe, expect, it } from "vitest";

import { toolCallSuccess, toolCallFailure, toolCallErrorPayload } from "../../src/utils/tool-call-result.js";

describe("toolCallSuccess", () => {
  it("wraps a primitive value as JSON success", () => {
    const result = toolCallSuccess("hello");
    expect(result.success).toBe(true);
    expect(result.contentItems).toHaveLength(1);
    expect(result.contentItems[0].type).toBe("inputText");
    expect(JSON.parse(result.contentItems[0].text)).toBe("hello");
  });

  it("wraps an object value as JSON success", () => {
    const result = toolCallSuccess({ key: "value", count: 42 });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.contentItems[0].text)).toEqual({ key: "value", count: 42 });
  });

  it("wraps null as JSON success", () => {
    const result = toolCallSuccess(null);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.contentItems[0].text)).toBeNull();
  });
});

describe("toolCallFailure", () => {
  it("extracts message from Error instances", () => {
    const result = toolCallFailure(new Error("something broke"));
    expect(result.success).toBe(false);
    const payload = JSON.parse(result.contentItems[0].text);
    expect(payload).toEqual({ error: "something broke" });
  });

  it("coerces non-Error values to string", () => {
    const result = toolCallFailure("raw string error");
    expect(result.success).toBe(false);
    const payload = JSON.parse(result.contentItems[0].text);
    expect(payload).toEqual({ error: "raw string error" });
  });

  it("coerces null/undefined gracefully", () => {
    const result = toolCallFailure(undefined);
    expect(result.success).toBe(false);
    expect(result.contentItems[0].type).toBe("inputText");
  });
});

describe("toolCallErrorPayload", () => {
  it("wraps an arbitrary error payload as JSON failure", () => {
    const result = toolCallErrorPayload({ code: "NOT_FOUND", message: "missing resource" });
    expect(result.success).toBe(false);
    const payload = JSON.parse(result.contentItems[0].text);
    expect(payload).toEqual({ code: "NOT_FOUND", message: "missing resource" });
  });

  it("wraps a string error payload", () => {
    const result = toolCallErrorPayload("simple error");
    expect(result.success).toBe(false);
    expect(JSON.parse(result.contentItems[0].text)).toBe("simple error");
  });
});

describe("jsonText contract via toolCallSuccess (RIS-235)", () => {
  it("returns a string (not undefined) for an undefined top-level value", () => {
    const result = toolCallSuccess(undefined);
    expect(typeof result.contentItems[0].text).toBe("string");
    expect(result.contentItems[0].text.length).toBeGreaterThan(0);
  });

  it("returns a string for a function top-level value", () => {
    const result = toolCallSuccess(() => 1);
    expect(typeof result.contentItems[0].text).toBe("string");
    expect(result.contentItems[0].text.length).toBeGreaterThan(0);
  });

  it("does not throw and returns a string for a bigint value", () => {
    const result = toolCallSuccess({ big: 10n });
    expect(typeof result.contentItems[0].text).toBe("string");
    expect(JSON.parse(result.contentItems[0].text)).toEqual({ big: "10n" });
  });

  it("does not throw and returns a string for a circular reference", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = toolCallSuccess(circular);
    expect(typeof result.contentItems[0].text).toBe("string");
    expect(result.contentItems[0].text.length).toBeGreaterThan(0);
  });
});
