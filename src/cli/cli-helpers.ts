import { homedir } from "node:os";
import path from "node:path";

/** Resolve the data directory from the CLI flag, env var, or the default `~/.risoluto`. */
export function resolveDataDir(value: string | undefined): string {
  return path.resolve(value ?? process.env.DATA_DIR ?? path.join(homedir(), ".risoluto"));
}

/** Assert that a required CLI flag value is non-empty, throwing a descriptive TypeError if not. */
export function requireNonEmpty(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new TypeError(`${flag} is required`);
  }
  return trimmed;
}
