import { describe, it, expect } from "vitest";
import {
  CODEX_APPROVE_DECISION,
  CODEX_DENY_DECISION,
  decideCodexApproval,
  isCodexApprovalMethod,
  resolveCodexApprovalPolicy,
  denyAllApprovalPolicy,
  acceptForSessionApprovalPolicy,
} from "../../src/codex/approval-gate.js";

const commandRequest = {
  method: "item/commandExecution/requestApproval",
  params: { command: "rm -rf /" },
};

describe("codex approval gate (RIS-237)", () => {
  it("uses acceptForSession/reject as the canonical decision literals", () => {
    expect(CODEX_APPROVE_DECISION).toBe("acceptForSession");
    expect(CODEX_DENY_DECISION).toBe("reject");
  });

  it("recognizes the three privileged approval methods", () => {
    expect(isCodexApprovalMethod("item/commandExecution/requestApproval")).toBe(true);
    expect(isCodexApprovalMethod("item/fileChange/requestApproval")).toBe(true);
    expect(isCodexApprovalMethod("item/permissions/requestApproval")).toBe(true);
    expect(isCodexApprovalMethod("item/tool/call")).toBe(false);
  });

  it("denies a command approval by default (no env opt-in)", () => {
    const decision = decideCodexApproval(commandRequest, denyAllApprovalPolicy);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toMatch(/denied by default/);
  });

  it("denies a non-approval method regardless of policy", () => {
    const decision = decideCodexApproval({ method: "item/tool/call", params: {} }, acceptForSessionApprovalPolicy);
    expect(decision.approved).toBe(false);
  });

  it("approves only when the operator opted in via policy", () => {
    const decision = decideCodexApproval(commandRequest, acceptForSessionApprovalPolicy);
    expect(decision.approved).toBe(true);
  });

  it("resolves deny-by-default unless RISOLUTO_CODEX_AUTO_APPROVE is truthy", () => {
    expect(resolveCodexApprovalPolicy({})).toBe(denyAllApprovalPolicy);
    expect(resolveCodexApprovalPolicy({ RISOLUTO_CODEX_AUTO_APPROVE: "0" })).toBe(denyAllApprovalPolicy);
    expect(resolveCodexApprovalPolicy({ RISOLUTO_CODEX_AUTO_APPROVE: "1" })).toBe(acceptForSessionApprovalPolicy);
    expect(resolveCodexApprovalPolicy({ RISOLUTO_CODEX_AUTO_APPROVE: "true" })).toBe(acceptForSessionApprovalPolicy);
  });

  it("defaults decideCodexApproval to the env-resolved policy (deny without opt-in)", () => {
    const prev = process.env.RISOLUTO_CODEX_AUTO_APPROVE;
    delete process.env.RISOLUTO_CODEX_AUTO_APPROVE;
    try {
      expect(decideCodexApproval(commandRequest).approved).toBe(false);
    } finally {
      if (prev !== undefined) {
        process.env.RISOLUTO_CODEX_AUTO_APPROVE = prev;
      }
    }
  });
});
