/**
 * DB-backed config overlay store.
 *
 * Implements ConfigOverlayPort (toMap, applyPatch, set, delete, subscribe)
 * using the SQLite `config` table with section JSON documents.
 *
 * Also provides `getWorkflow()` and `getConfig()` so it can serve as the
 * backing store for ConfigStore in DB-first mode.
 */

import { eq } from "drizzle-orm";

import type { ConfigOverlayPort } from "./overlay.js";
import type { RisolutoDatabase } from "../persistence/sqlite/database.js";
import { config, promptTemplates } from "../persistence/sqlite/schema.js";
import type { RisolutoLogger, WorkflowRuntimeConfig, ServiceConfig, ValidationError } from "../core/types.js";
import { toErrorString } from "../utils/type-guards.js";
import { deriveServiceConfig } from "./derivation-pipeline.js";
import { validateDispatch } from "./validators.js";
import { DEFAULT_PROMPT_TEMPLATE } from "./defaults.js";
import type { SecretsStore } from "../secrets/store.js";
import {
  isDangerousKey,
  mergeOverlayMaps,
  normalizePathExpression,
  removeOverlayPathValue,
  setOverlayPathValue,
  stableStringify,
} from "./overlay-helpers.js";

/**
 * Read all section rows and reconstruct a flat config map that
 * looks identical to what YAML front matter would produce.
 */
function readConfigMap(db: RisolutoDatabase): Record<string, unknown> {
  const rows = db.select().from(config).all();
  const map: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      map[row.key] = JSON.parse(row.value);
    } catch (error) {
      // Corrupt persisted JSON is treated as unsafe — the caller (refresh) keeps the
      // last-known-good config rather than silently running on an empty section (RIS-252).
      throw new Error(`config section "${row.key}" contains invalid JSON`, { cause: error });
    }
  }
  return map;
}

/**
 * Read the active prompt template body from the DB.
 */
function readActiveTemplate(db: RisolutoDatabase, logger: RisolutoLogger): string {
  // 1. Check system.selectedTemplateId
  const systemRow = db.select().from(config).where(eq(config.key, "system")).get();
  if (systemRow) {
    let system: Record<string, unknown>;
    try {
      system = JSON.parse(systemRow.value) as Record<string, unknown>;
    } catch {
      logger.warn({ key: "system" }, "config section JSON parse failed — using empty fallback");
      system = {};
    }
    const selectedId = system.selectedTemplateId;
    if (typeof selectedId === "string") {
      const template = db.select().from(promptTemplates).where(eq(promptTemplates.id, selectedId)).get();
      if (template) return template.body;
    }
  }

  // 2. Fallback: first template in table
  const fallback = db.select().from(promptTemplates).limit(1).get();
  if (fallback) return fallback.body;

  // 3. Hardcoded default
  return DEFAULT_PROMPT_TEMPLATE;
}

export class DbConfigStore implements ConfigOverlayPort {
  private cachedMap: Record<string, unknown> = {};
  private cachedConfig: ServiceConfig | null = null;
  private cachedWorkflow: WorkflowRuntimeConfig | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly db: RisolutoDatabase,
    private readonly logger: RisolutoLogger,
    private readonly deps?: {
      secretsStore?: Pick<SecretsStore, "get" | "subscribe">;
    },
  ) {}

  /**
   * Load config from DB and derive ServiceConfig. Called on startup
   * and after every mutation.
   */
  refresh(): void {
    let next: { configMap: Record<string, unknown>; workflow: WorkflowRuntimeConfig; serviceConfig: ServiceConfig };
    try {
      const configMap = readConfigMap(this.db);
      next = { configMap, ...this.deriveFromMap(configMap) };
    } catch (error) {
      // Corrupt JSON or a config that fails derivation must not blow away a working
      // runtime: retain the last-known-good config if we have one, otherwise (startup)
      // fail loudly rather than run on a half-built config (RIS-252).
      if (this.cachedConfig) {
        this.logger.error({ error: toErrorString(error) }, "config refresh failed — retaining last-known-good config");
        return;
      }
      throw error;
    }

    this.cachedMap = next.configMap;
    this.cachedConfig = next.serviceConfig;
    this.cachedWorkflow = next.workflow;
    this.logger.info("config refreshed from DB");
  }

  private deriveFromMap(configMap: Record<string, unknown>): {
    workflow: WorkflowRuntimeConfig;
    serviceConfig: ServiceConfig;
  } {
    const promptTemplate = readActiveTemplate(this.db, this.logger);
    const workflow: WorkflowRuntimeConfig = { config: configMap, promptTemplate };
    const serviceConfig = deriveServiceConfig(workflow, {
      secretResolver: (name) => this.deps?.secretsStore?.get(name) ?? undefined,
    });
    return { workflow, serviceConfig };
  }

  // Derive + validate the candidate BEFORE writing, so a config that fails derivation
  // never lands in the DB. After a successful write, refresh() re-reads the persisted
  // (dangerous-key-sanitized) sections so the cache matches disk exactly (RIS-252).
  private commit(candidateMap: Record<string, unknown>): void {
    this.deriveFromMap(candidateMap);
    this.writeSections(candidateMap);
    this.refresh();
    this.notify();
  }

  getWorkflow(): WorkflowRuntimeConfig {
    if (!this.cachedWorkflow) throw new Error("DbConfigStore not started — call refresh() first");
    return this.cachedWorkflow;
  }

  getConfig(): ServiceConfig {
    if (!this.cachedConfig) throw new Error("DbConfigStore not started — call refresh() first");
    return this.cachedConfig;
  }

  getMergedConfigMap(): Record<string, unknown> {
    return structuredClone(this.cachedMap) as Record<string, unknown>;
  }

  validateDispatch(): ValidationError | null {
    return validateDispatch(this.getConfig());
  }

  toMap(): Record<string, unknown> {
    return structuredClone(this.cachedMap) as Record<string, unknown>;
  }

  async applyPatch(patch: Record<string, unknown>): Promise<boolean> {
    const currentMap = this.toMap();
    const merged = mergeOverlayMaps(currentMap, patch);

    if (stableStringify(merged) === stableStringify(currentMap)) return false;

    this.commit(merged);
    return true;
  }

  async set(pathExpression: string, value: unknown): Promise<boolean> {
    const segments = normalizePathExpression(pathExpression);
    if (segments.length === 0) throw new Error("overlay path must contain at least one segment");

    const before = this.toMap();
    const after = this.toMap();
    setOverlayPathValue(after, segments, value);
    if (stableStringify(after) === stableStringify(before)) return false;

    this.commit(after);
    return true;
  }

  async delete(pathExpression: string): Promise<boolean> {
    const segments = normalizePathExpression(pathExpression);
    if (segments.length === 0) throw new Error("overlay path must contain at least one segment");

    const currentMap = this.toMap();
    const removed = removeOverlayPathValue(currentMap, segments);
    if (!removed) return false;

    this.commit(currentMap);
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private writeSections(map: Record<string, unknown>): void {
    const now = new Date().toISOString();
    const mapKeys = new Set<string>();

    // Wrap upsert + prune in a single transaction so a crash mid-write
    // can't leave config in a partial state with some sections updated and
    // others holding stale (or missing) values.
    this.db.transaction((tx) => {
      for (const [key, value] of Object.entries(map)) {
        if (isDangerousKey(key)) continue;
        mapKeys.add(key);
        const serialized = JSON.stringify(value);
        const existing = tx.select().from(config).where(eq(config.key, key)).get();
        if (existing) {
          tx.update(config).set({ value: serialized, updatedAt: now }).where(eq(config.key, key)).run();
        } else {
          tx.insert(config).values({ key, value: serialized, updatedAt: now }).run();
        }
      }

      const allRows = tx.select({ key: config.key }).from(config).all();
      for (const row of allRows) {
        if (!mapKeys.has(row.key)) {
          tx.delete(config).where(eq(config.key, row.key)).run();
        }
      }
    });
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
