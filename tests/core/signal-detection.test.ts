import { describe, expect, it } from "vitest";

import { detectStopSignal } from "../../src/core/signal-detection.js";

describe("detectStopSignal boundary anchoring (RIS-235)", () => {
  it("detects a clean done marker", () => {
    expect(detectStopSignal("RISOLUTO_STATUS: DONE")).toBe("done");
  });

  it("detects a clean blocked marker", () => {
    expect(detectStopSignal("risoluto_status: blocked")).toBe("blocked");
  });

  it("does not match a marker glued to a leading word character", () => {
    expect(detectStopSignal("notrisoluto_status: done")).toBeNull();
  });

  it("does not match a marker glued to a leading word char in a sentence", () => {
    expect(detectStopSignal("please do not output xrisoluto_status: done here")).toBeNull();
  });

  it("still does not match a marker glued to a trailing word character", () => {
    expect(detectStopSignal("risoluto_status: done_uploading")).toBeNull();
  });

  it("matches a marker surrounded by ordinary whitespace and punctuation", () => {
    expect(detectStopSignal("final line -> risoluto_status: done.")).toBe("done");
  });
});
