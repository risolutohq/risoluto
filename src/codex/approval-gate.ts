/**
 * Shared deny-by-default approval gate for privileged Codex requests
 * (command execution, file changes, permission grants).
 *
 * Both the agent-side request handler and the host-side control plane route
 * approvals through this single gate, so there is no second auto-accept path.
 * Auto-approval ("acceptForSession") is only granted when an operator has
 * explicitly opted in via RISOLUTO_CODEX_AUTO_APPROVE. Otherwise every
 * privileged request is denied, so a compromised prompt or agent cannot turn
 * an approval-gated action into unattended execution.
 */

/** Canonical Codex decision literal for an approved request. */
export const CODEX_APPROVE_DECISION = "acceptForSession";

/** Canonical Codex decision literal for a denied request. */
export const CODEX_DENY_DECISION = "reject";

export interface CodexApprovalRequest {
  method: string;
  params: Record<string, unknown>;
}

export interface CodexApprovalDecision {
  approved: boolean;
  reason: string;
}

export type CodexApprovalPolicy = (request: CodexApprovalRequest) => CodexApprovalDecision;

const APPROVAL_METHODS = new Set<string>([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);

export function isCodexApprovalMethod(method: string): boolean {
  return APPROVAL_METHODS.has(method);
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** Deny every privileged request. The secure default. */
export const denyAllApprovalPolicy: CodexApprovalPolicy = (request) => ({
  approved: false,
  reason: `denied by default: no operator approval configured for ${request.method}`,
});

/** Approve every privileged request. Only selected by explicit operator opt-in. */
export const acceptForSessionApprovalPolicy: CodexApprovalPolicy = () => ({
  approved: true,
  reason: "operator opted in via RISOLUTO_CODEX_AUTO_APPROVE",
});

/**
 * Resolve the approval policy from the environment. Deny-by-default unless the
 * operator has explicitly set RISOLUTO_CODEX_AUTO_APPROVE to a truthy value.
 */
export function resolveCodexApprovalPolicy(env: NodeJS.ProcessEnv = process.env): CodexApprovalPolicy {
  return isTruthyEnvFlag(env.RISOLUTO_CODEX_AUTO_APPROVE) ? acceptForSessionApprovalPolicy : denyAllApprovalPolicy;
}

export function decideCodexApproval(
  request: CodexApprovalRequest,
  policy: CodexApprovalPolicy = resolveCodexApprovalPolicy(),
): CodexApprovalDecision {
  if (!isCodexApprovalMethod(request.method)) {
    return {
      approved: false,
      reason: `denied: not an approval method (${request.method})`,
    };
  }
  return policy(request);
}
