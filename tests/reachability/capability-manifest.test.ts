import { describe, expect, it } from "vitest";

import { CapabilityManifestError, loadCapabilityManifest } from "../../src/reachability/capability-manifest.js";

const validEntry = {
  name: "run-start-dispatch",
  symbol: "driveAcceptedWorkflowRun",
  module: "src/cli/run-start-command.ts",
  intakeAdapters: ["cli"],
  reason: "CLI run start must drive a workflow run through the executor end to end",
};

describe("capability manifest loader", () => {
  it("loads a valid entry into a typed record", () => {
    const manifest = loadCapabilityManifest([validEntry]);
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toEqual(validEntry);
  });

  it("rejects an entry naming an unknown intake adapter, identifying the offending entry", () => {
    const bad = [{ ...validEntry, intakeAdapters: ["telegram"] }];
    expect(() => loadCapabilityManifest(bad)).toThrow(CapabilityManifestError);
    // attributable: the error names the offending entry
    expect(() => loadCapabilityManifest(bad)).toThrow(/run-start-dispatch/);
  });

  it("rejects an entry missing a required field with a clear error", () => {
    const missingReason = {
      name: validEntry.name,
      symbol: validEntry.symbol,
      module: validEntry.module,
      intakeAdapters: validEntry.intakeAdapters,
    };
    expect(() => loadCapabilityManifest([missingReason])).toThrow(CapabilityManifestError);
    expect(() => loadCapabilityManifest([missingReason])).toThrow(/reason/);
  });

  it("loads a deferred entry that includes a reason and marks it deferred", () => {
    const manifest = loadCapabilityManifest([{ ...validEntry, deferred: { reason: "live tier — wired in NIN-75" } }]);
    expect(manifest[0]?.deferred?.reason).toBe("live tier — wired in NIN-75");
  });

  it("rejects a deferred entry with no reason", () => {
    expect(() => loadCapabilityManifest([{ ...validEntry, deferred: {} }])).toThrow(CapabilityManifestError);
    expect(() => loadCapabilityManifest([{ ...validEntry, deferred: { reason: "" } }])).toThrow(
      CapabilityManifestError,
    );
  });

  it("rejects an unknown extra field on an entry", () => {
    expect(() => loadCapabilityManifest([{ ...validEntry, validationGate: "x" }])).toThrow(CapabilityManifestError);
  });

  it("uses reachability-distinct naming, not the runtime Verifier role or Validation Gate", () => {
    expect(new CapabilityManifestError("boom").name).toBe("CapabilityManifestError");
  });
});
