import { LinearClient } from "./client.js";
import {
  type ToolCallResult,
  toolCallSuccess,
  toolCallFailure,
  toolCallErrorPayload,
} from "../utils/tool-call-result.js";

function extractInput(args: unknown): { query: string; variables?: Record<string, unknown> } {
  if (typeof args === "string") {
    return { query: args };
  }
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    if (typeof record.query === "string") {
      return {
        query: record.query,
        variables:
          typeof record.variables === "object" && record.variables !== null && !Array.isArray(record.variables)
            ? (record.variables as Record<string, unknown>)
            : undefined,
      };
    }
  }
  throw new Error("linear_graphql expects a query string or { query, variables } object");
}

function countOperations(query: string): number {
  const operationKeywords = /\b(query|mutation|subscription)\b/gi;
  let count = 0;
  while (operationKeywords.exec(query) !== null) {
    count++;
  }
  return count;
}

// Only read-only `query` operations are permitted, and selections may not name a
// secret-bearing field (e.g. Linear's Webhook.secret), so the agent tool cannot
// mutate state or exfiltrate credentials (RIS-248).
const MUTATING_OPERATION = /\b(mutation|subscription)\b/i;
// Substring (not \b-anchored) match: the old word-boundary form let camelCase/compound field names slip
// through (e.g. `authToken`, `apiKeys`, `clientSecret` have no boundary before the secret word) and
// omitted `token`/`credential` entirely. Match the credential-bearing word anywhere in the field name,
// but require the `api`/`private` prefix before `key` so a plain identifier field like Linear's
// `Team.key` is still readable (RIS-248).
const SECRET_BEARING_FIELD = /secret|token|password|credential|api[_-]?key|private[_-]?key/i;

function assertReadOnlyQuery(query: string): void {
  if (MUTATING_OPERATION.test(query)) {
    throw new Error("linear_graphql only permits read-only query operations (mutation/subscription rejected)");
  }
  if (SECRET_BEARING_FIELD.test(query)) {
    throw new Error("linear_graphql rejects secret-bearing fields (e.g. webhook secret, tokens)");
  }
}

export async function handleLinearGraphqlToolCall(client: LinearClient, args: unknown): Promise<ToolCallResult> {
  try {
    const input = extractInput(args);
    const operationCount = countOperations(input.query);

    if (operationCount !== 1) {
      throw new Error("linear_graphql requires exactly one operation");
    }
    assertReadOnlyQuery(input.query);

    const response = await client.runGraphQL(input.query, input.variables);
    if (Array.isArray(response.errors) && response.errors.length > 0) {
      return toolCallErrorPayload(response);
    }
    return toolCallSuccess(response);
  } catch (error) {
    return toolCallFailure(error);
  }
}
