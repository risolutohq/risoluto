import { spawn } from "node:child_process";

import { getAvailableModelIds } from "../core/model-pricing.js";

export interface CodexModelEntry {
  id: string;
  displayName: string;
  isDefault: boolean;
}

interface ModelListRpcResult {
  data: Array<{
    id: string;
    displayName: string;
    hidden: boolean;
    isDefault: boolean;
  }>;
}

interface CacheEntry {
  cached: CodexModelEntry[];
  expiry: number;
  inflight: Promise<CodexModelEntry[]> | null;
}

const cacheByKey = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_TIMEOUT_MS = 15_000;

/**
 * Fetches the list of models available to Codex by spawning
 * `codex app-server` and querying `model/list` via JSON-RPC.
 *
 * Results are cached per API key for 5 minutes. Falls back to the
 * static pricing table only when the Codex binary is unavailable; all other
 * failures (auth, protocol, timeout, malformed response) are rethrown.
 */
function isCodexBinaryUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message === "codex binary not found";
}
export async function fetchCodexModels(apiKey?: string, includeHidden = false): Promise<CodexModelEntry[]> {
  const cacheKey = `${apiKey ?? ""}:${includeHidden ? "1" : "0"}`;
  const entry = cacheByKey.get(cacheKey);

  if (entry && entry.cached.length > 0 && Date.now() < entry.expiry) {
    return entry.cached;
  }
  if (entry?.inflight) {
    return entry.inflight;
  }

  const slot: CacheEntry = { cached: [], expiry: 0, inflight: null };
  cacheByKey.set(cacheKey, slot);

  slot.inflight = (async () => {
    try {
      const result = await queryModelList(apiKey, includeHidden);
      slot.cached = result;
      slot.expiry = Date.now() + CACHE_TTL_MS;
      return result;
    } catch (error) {
      // Only fall back to the static list when Codex is genuinely unavailable
      // locally (binary missing). Auth/protocol/timeout failures must surface to
      // the caller rather than be masked as a successful static response.
      if (isCodexBinaryUnavailable(error)) {
        return getAvailableModelIds().map((id) => ({ id, displayName: id, isDefault: false }));
      }
      cacheByKey.delete(cacheKey);
      throw error;
    } finally {
      slot.inflight = null;
    }
  })();
  return slot.inflight;
}

function queryModelList(apiKey?: string, includeHidden = false): Promise<CodexModelEntry[]> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (apiKey) {
      env.OPENAI_API_KEY = apiKey;
    }

    const child = spawn("codex", ["app-server"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(new Error("codex model/list timed out"));
      }
    }, QUERY_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };

    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) {
          handleLine(line);
        }
        idx = buffer.indexOf("\n");
      }
    });

    child.stdin.on("error", () => {
      /* Ignore EPIPE — Codex may exit before reading our request. */
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      cleanup();
      if (!settled) {
        settled = true;
        reject(error.code === "ENOENT" ? new Error("codex binary not found") : error);
      }
    });

    child.on("exit", (code) => {
      cleanup();
      if (!settled) {
        settled = true;
        reject(new Error(`codex exited with code ${String(code)} before responding`));
      }
    });

    function handleLine(line: string): void {
      if (settled) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof parsed === "object" && parsed !== null && "id" in parsed && (parsed as { id: unknown }).id === 1) {
        if ("result" in parsed) {
          settled = true;
          cleanup();
          const result = (parsed as { result?: ModelListRpcResult }).result;
          if (!result || !Array.isArray(result.data)) {
            reject(new Error("codex model/list response missing data array"));
            return;
          }
          resolve(
            result.data
              .filter((m) => includeHidden || !m.hidden)
              .map((m) => ({ id: m.id, displayName: m.displayName, isDefault: m.isDefault })),
          );
        } else if ("error" in parsed) {
          settled = true;
          cleanup();
          const error = (parsed as { error?: { code?: number; message?: string } }).error;
          reject(
            new Error(
              `codex model/list RPC error: ${error?.message ?? "unknown error"} (code ${error?.code ?? "unknown"})`,
            ),
          );
        }
      }
    }

    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "model/list",
      params: { limit: 50, includeHidden },
    });
    child.stdin.write(request + "\n");
  });
}
