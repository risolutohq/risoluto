import { redactSensitiveValue } from "../core/content-sanitizer.js";

/**
 * Codex notification/server-request params carry arbitrary upstream content:
 * prompt text, tool-call arguments, account metadata, and secrets. Emitting
 * them raw on the event bus leaks that material to every subscriber (logs,
 * persistence, webhooks). Project to a small allowlist of safe scalar fields,
 * replace any structured value with a redacted placeholder, then run the result
 * through the central secret redactor as defense in depth.
 */

const NOTIFICATION_PARAM_ALLOWLIST = new Set<string>([
  "threadId",
  "turnId",
  "requestId",
  "itemId",
  "method",
  "status",
  "archived",
  "completed",
  "name",
  "kind",
  "index",
  "limit",
  "scope",
  "reason",
  "code",
]);

function isScalar(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function projectCodexNotificationParams(params: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!NOTIFICATION_PARAM_ALLOWLIST.has(key)) {
      continue;
    }
    projected[key] = isScalar(value) ? value : "[omitted]";
  }
  return redactSensitiveValue(projected) as Record<string, unknown>;
}
