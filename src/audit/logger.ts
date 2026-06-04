/**
 * Audit logger — records config, secret, and template mutations
 * to the `config_history` table with old + new values.
 *
 * Secret values are stored as "[REDACTED]" for both previousValue
 * and newValue.
 */

import { createHash } from "node:crypto";

import type { TypedEventBus } from "../core/event-bus.js";
import type { RisolutoEventMap } from "../core/risoluto-events.js";
import type { RisolutoDatabase } from "../persistence/sqlite/database.js";
import { configHistory } from "../persistence/sqlite/schema.js";
import type { AuditLoggerPort } from "./port.js";
import type { AuditEntry, AuditQueryOptions, AuditRecord } from "./types.js";
import { redactSensitiveValue, sanitizeContent } from "../core/content-sanitizer.js";

export type { AuditEntry, AuditQueryOptions, AuditRecord };

const REDACTED = "[REDACTED]";

// Audit values are fully redacted when their key/path names a secret-like field,
// and otherwise scanned for embedded secret patterns, so no config mutation
// persists a webhook URL, token, API key, or $SECRET-resolved value verbatim
// (RIS-247).
const SENSITIVE_AUDIT_KEY = /secret|token|password|credential|authorization|api[_-]?key|webhook/i;

function redactAuditValue(key: string, path: string | null, value: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (SENSITIVE_AUDIT_KEY.test(key) || (path !== null && SENSITIVE_AUDIT_KEY.test(path))) {
    return REDACTED;
  }
  // Preserve the stored value's shape (audit values are usually serialized
  // config) while redacting any secret-bearing sub-value.
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(value)));
  } catch {
    return sanitizeContent(value, { maxLength: 100_000 });
  }
}

interface WhereResult {
  where: string;
  params: unknown[];
}

const FILTER_MAP: Array<{
  key: keyof AuditQueryOptions;
  condition: string;
  transform?: (value: string) => unknown[];
}> = [
  { key: "tableName", condition: "table_name = ?" },
  {
    key: "key",
    condition: String.raw`key LIKE ? ESCAPE '\'`,
    transform: (value) => {
      const escaped = value
        .replaceAll("\\", String.raw`\\`)
        .replaceAll("%", String.raw`\%`)
        .replaceAll("_", String.raw`\_`);
      return [`%${escaped}%`];
    },
  },
  {
    key: "pathPrefix",
    condition: String.raw`(path LIKE ? ESCAPE '\' OR key LIKE ? ESCAPE '\')`,
    transform: (value) => {
      const escaped = value
        .replaceAll("\\", String.raw`\\`)
        .replaceAll("%", String.raw`\%`)
        .replaceAll("_", String.raw`\_`);
      return [`${escaped}%`, `${escaped}%`];
    },
  },
  { key: "from", condition: "timestamp >= ?" },
  { key: "to", condition: "timestamp <= ?" },
];

function buildWhereClause(options?: AuditQueryOptions): WhereResult {
  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const filter of FILTER_MAP) {
    const value = options?.[filter.key];
    if (typeof value !== "string") continue;
    conditions.push(filter.condition);
    params.push(...(filter.transform ? filter.transform(value) : [value]));
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export class AuditLogger implements AuditLoggerPort {
  constructor(
    private readonly db: RisolutoDatabase,
    private readonly eventBus?: TypedEventBus<RisolutoEventMap>,
  ) {}

  log(entry: AuditEntry): void {
    const isSecret = entry.tableName === "secrets";
    const path = entry.path ?? null;
    const actor = entry.actor ?? "operator";
    const timestamp = new Date().toISOString();
    const previousValue = isSecret ? REDACTED : redactAuditValue(entry.key, path, entry.previousValue ?? null);
    const newValue = isSecret ? REDACTED : redactAuditValue(entry.key, path, entry.newValue ?? null);

    // Link this entry to the chain tip: hash the canonical (already-redacted) fields together with
    // the prior entry's hash. better-sqlite3 is synchronous, so this read-then-insert is atomic
    // within the process and no concurrent entry can splice between them (RIS-266).
    const previousHash = this.latestEntryHash();
    const entryHash = computeAuditEntryHash({
      tableName: entry.tableName,
      key: entry.key,
      path,
      operation: entry.operation,
      previousValue,
      newValue,
      actor,
      requestId: entry.requestId ?? null,
      timestamp,
      previousHash,
    });

    this.db
      .insert(configHistory)
      .values({
        tableName: entry.tableName,
        key: entry.key,
        path,
        operation: entry.operation,
        previousValue,
        newValue,
        actor,
        requestId: entry.requestId ?? null,
        timestamp,
        entryHash,
        previousHash,
      })
      .run();

    this.eventBus?.emit("audit.mutation", {
      tableName: entry.tableName,
      key: entry.key,
      path,
      operation: entry.operation,
      actor,
      timestamp,
    });
  }

  logConfigChange(key: string, previousValue: string | null, newValue: string | null, path?: string): void {
    this.log({
      tableName: "config",
      key,
      path,
      operation: previousValue === null ? "create" : "update",
      previousValue,
      newValue,
    });
  }

  logSecretChange(key: string, operation: "set" | "delete"): void {
    this.log({ tableName: "secrets", key, operation });
  }

  logTemplateChange(
    templateId: string,
    operation: "create" | "update" | "delete",
    previousBody?: string | null,
    newBody?: string | null,
  ): void {
    this.log({
      tableName: "prompt_templates",
      key: templateId,
      operation,
      previousValue: previousBody ?? null,
      newValue: newBody ?? null,
    });
  }

  private latestEntryHash(): string | null {
    const row = this.db.$client.prepare("SELECT entry_hash FROM config_history ORDER BY id DESC LIMIT 1").get() as
      | { entry_hash: string | null }
      | undefined;
    return row?.entry_hash ?? null;
  }

  query(options?: AuditQueryOptions): AuditRecord[] {
    const { where, params } = buildWhereClause(options);
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const sql = `SELECT * FROM config_history ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.$client.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map(rowToAuditRecord);
  }

  count(options?: AuditQueryOptions): number {
    const { where, params } = buildWhereClause(options);
    const result = this.db.$client.prepare(`SELECT COUNT(*) as count FROM config_history ${where}`).get(...params) as {
      count: number;
    };
    return result.count;
  }
}

// Canonical hash of one audit entry, chained to the previous entry's hash. Object key order is fixed
// by the literal, so JSON.stringify is deterministic across calls (RIS-266).
function computeAuditEntryHash(fields: {
  tableName: string;
  key: string;
  path: string | null;
  operation: string;
  previousValue: string | null;
  newValue: string | null;
  actor: string;
  requestId: string | null;
  timestamp: string;
  previousHash: string | null;
}): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

function rowToAuditRecord(row: Record<string, unknown>): AuditRecord {
  return {
    id: row.id as number,
    tableName: row.table_name as string,
    key: row.key as string,
    path: (row.path as string) ?? null,
    operation: row.operation as string,
    previousValue: (row.previous_value as string) ?? null,
    newValue: (row.new_value as string) ?? null,
    actor: (row.actor as string) ?? "operator",
    requestId: (row.request_id as string) ?? null,
    timestamp: row.timestamp as string,
    entryHash: (row.entry_hash as string) ?? null,
    previousHash: (row.previous_hash as string) ?? null,
  };
}
