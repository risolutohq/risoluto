import { asRecord, asStringOrNull as asString } from "../utils/type-guards.js";
import type { GithubApiToolClient } from "../git/github-api-tool.js";
import { handleGithubApiToolCall } from "../git/github-api-tool.js";
import type { TrackerToolProvider } from "../tracker/tool-provider.js";
import type { JsonRpcRequest } from "../codex/protocol.js";
import {
  CODEX_APPROVE_DECISION,
  CODEX_DENY_DECISION,
  decideCodexApproval,
  resolveCodexApprovalPolicy,
  type CodexApprovalPolicy,
} from "../codex/approval-gate.js";

export interface CodexRequestSideChannelEvent {
  event: string;
  message: string;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type CodexRequestSideChannel = (event: CodexRequestSideChannelEvent) => void;

interface CodexRequestResult {
  response?: unknown;
  fatalFailure: { code: string; message: string } | null;
}

function fatalResult(code: string, message: string): CodexRequestResult {
  return { fatalFailure: { code, message } };
}

function buildApprovalMetadata(
  method: string,
  params: Record<string, unknown>,
  decision: string,
): Record<string, unknown> {
  const itemId = asString(params["itemId"]);
  const reason = asString(params["reason"]);
  const command = params["command"];
  const cwd = asString(params["cwd"]);
  const metadata: Record<string, unknown> = { method, decision };
  if (itemId) metadata["itemId"] = itemId;
  if (reason) metadata["reason"] = reason;
  if (typeof command === "string" || Array.isArray(command)) metadata["command"] = command;
  if (cwd) metadata["cwd"] = cwd;
  return metadata;
}

function describeApproval(method: string, params: Record<string, unknown>): string {
  if (method === "item/fileChange/requestApproval") {
    const path = asString(params["path"]);
    return path ? `Approved file change: ${path}` : "Approved file change";
  }
  if (method === "item/commandExecution/requestApproval") {
    const command = params["command"];
    if (typeof command === "string") {
      return `Approved command: ${command}`;
    }
    if (Array.isArray(command) && command.every((part): part is string => typeof part === "string")) {
      return `Approved command: ${command.join(" ")}`;
    }
    return "Approved shell command";
  }
  return "Approved sandboxed action";
}

function describeDenial(method: string): string {
  if (method === "item/fileChange/requestApproval") return "Denied file change";
  if (method === "item/commandExecution/requestApproval") return "Denied shell command";
  return "Denied sandboxed action";
}

function toolErrorResponse(errorMessage: string): CodexRequestResult {
  return {
    response: {
      success: false,
      contentItems: [{ type: "inputText", text: JSON.stringify({ error: errorMessage }) }],
    },
    fatalFailure: null,
  };
}

async function handleToolCall(
  params: Record<string, unknown>,
  trackerToolProvider: TrackerToolProvider,
  githubToolClient?: GithubApiToolClient,
): Promise<CodexRequestResult> {
  const toolName = asString(params.name) ?? asString(params.toolName);
  const toolArgs = params.arguments ?? params.args ?? params.input ?? null;

  if (toolName === null) {
    return toolErrorResponse("unsupported dynamic tool: unknown");
  }

  if (toolName === "github_api") {
    if (!githubToolClient) {
      return toolErrorResponse("github_api is not configured");
    }
    const response = await handleGithubApiToolCall(githubToolClient, toolArgs);
    return { response, fatalFailure: null };
  }

  const trackerResult = await trackerToolProvider.handleToolCall(toolName, toolArgs);
  if (trackerResult !== null) {
    if (trackerResult.fatalFailure) {
      return { fatalFailure: trackerResult.fatalFailure };
    }
    return { response: trackerResult.response, fatalFailure: null };
  }

  if (toolName === "linear_graphql") {
    return toolErrorResponse("linear_graphql is not available: tracker is not configured for Linear");
  }
  return toolErrorResponse(`unsupported dynamic tool: ${toolName}`);
}

function handleApprovalRequest(
  method: string,
  params: Record<string, unknown>,
  policy: CodexApprovalPolicy,
  sideChannel?: CodexRequestSideChannel,
): CodexRequestResult {
  const decision = decideCodexApproval({ method, params }, policy);
  if (decision.approved) {
    sideChannel?.({
      event: "tool_approval_granted",
      message: describeApproval(method, params),
      metadata: buildApprovalMetadata(method, params, CODEX_APPROVE_DECISION),
    });
    return { response: { decision: CODEX_APPROVE_DECISION }, fatalFailure: null };
  }
  sideChannel?.({
    event: "tool_approval_denied",
    message: describeDenial(method),
    metadata: {
      ...buildApprovalMetadata(method, params, CODEX_DENY_DECISION),
      denialReason: decision.reason,
    },
  });
  return { response: { decision: CODEX_DENY_DECISION }, fatalFailure: null };
}

function handlePermissionsRequest(params: Record<string, unknown>, policy: CodexApprovalPolicy): CodexRequestResult {
  const decision = decideCodexApproval({ method: "item/permissions/requestApproval", params }, policy);
  const permissions = decision.approved ? (params.permissionProfile ?? params.permissions ?? null) : null;
  return {
    response: { permissions, scope: "session" },
    fatalFailure: null,
  };
}

function handleUserInputRequest(
  params: Record<string, unknown>,
  sideChannel?: CodexRequestSideChannel,
): CodexRequestResult {
  const prompt = asString(params["prompt"]) ?? asString(params["message"]) ?? "Agent requested user input.";
  sideChannel?.({
    event: "user_input_requested",
    message: "Agent asked for user input",
    content: prompt,
    metadata: { prompt, questions: params["questions"] ?? null },
  });
  return { response: { result: null }, fatalFailure: null };
}

const FATAL_METHOD_RESPONSES: Record<
  string,
  { code: string; message: string } | ((method: string) => { code: string; message: string })
> = {
  "mcpServer/elicitation/request": {
    code: "startup_failed",
    message: "thread/start failed because a required MCP server did not initialize",
  },
  "account/chatgptAuthTokens/refresh": {
    code: "auth_token_expired",
    message: "ChatGPT auth token expired and Risoluto cannot refresh it",
  },
  applyPatchApproval: (method) => ({
    code: "startup_failed",
    message: `unsupported interactive request from codex: ${method}`,
  }),
  execCommandApproval: (method) => ({
    code: "startup_failed",
    message: `unsupported interactive request from codex: ${method}`,
  }),
};

export async function handleCodexRequest(
  request: JsonRpcRequest,
  trackerToolProvider: TrackerToolProvider,
  githubToolClient?: GithubApiToolClient,
  sideChannel?: CodexRequestSideChannel,
  approvalPolicy: CodexApprovalPolicy = resolveCodexApprovalPolicy(),
): Promise<CodexRequestResult> {
  const { method } = request;

  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    return handleApprovalRequest(method, asRecord(request.params), approvalPolicy, sideChannel);
  }
  if (method === "item/permissions/requestApproval") {
    return handlePermissionsRequest(asRecord(request.params), approvalPolicy);
  }
  if (method === "item/tool/call") {
    return handleToolCall(asRecord(request.params), trackerToolProvider, githubToolClient);
  }
  if (method === "item/tool/requestUserInput") {
    return handleUserInputRequest(asRecord(request.params), sideChannel);
  }

  const fatal = FATAL_METHOD_RESPONSES[method];
  if (fatal) {
    const resolved = typeof fatal === "function" ? fatal(method) : fatal;
    return fatalResult(resolved.code, resolved.message);
  }

  return {
    response: { error: { code: -32601, message: `unknown request method: ${method}` } },
    fatalFailure: null,
  };
}
