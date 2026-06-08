import { readFileSync } from "node:fs";

import { CapabilityManifestError, loadCapabilityManifest, type CapabilityManifest } from "./capability-manifest.js";

/**
 * Read, JSON-parse, and validate the committed capability manifest file. Wraps read and parse failures
 * in {@link CapabilityManifestError} so the `reach:check` entry point reports an attributable error.
 */
export function readCapabilityManifest(filePath: string): CapabilityManifest {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new CapabilityManifestError(`cannot read capability manifest at ${filePath}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new CapabilityManifestError(`capability manifest at ${filePath} is not valid JSON`, { cause: error });
  }
  return loadCapabilityManifest(parsed);
}
