/** Shared result wrapper for MCP-style tool-call handlers. */
import { toErrorString } from "./type-guards.js";

interface ToolCallContentItem {
  type: "inputText";
  text: string;
}

export interface ToolCallResult {
  success: boolean;
  contentItems: ToolCallContentItem[];
}

/**
 * Serializes any value to a string, never violating the `text: string` contract.
 *
 * `JSON.stringify` returns `undefined` for unsupported top-level values
 * (`undefined`, functions, symbols) and throws on `bigint` or circular
 * references; both would break the wrapper. This falls back to a placeholder
 * string in those cases.
 */
function jsonText(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? `${val.toString()}n` : val));
    return serialized ?? '"[unserializable]"';
  } catch {
    return '"[unserializable]"';
  }
}

export function toolCallSuccess(value: unknown): ToolCallResult {
  return {
    success: true,
    contentItems: [{ type: "inputText", text: jsonText(value) }],
  };
}

export function toolCallFailure(error: unknown): ToolCallResult {
  const message = toErrorString(error);
  return {
    success: false,
    contentItems: [{ type: "inputText", text: jsonText({ error: message }) }],
  };
}

export function toolCallErrorPayload(payload: unknown): ToolCallResult {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: jsonText(payload) }],
  };
}
