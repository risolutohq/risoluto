/**
 * Deep merge and clone utilities for config objects.
 *
 * These utilities handle merging overlay configs into base configs
 * with array replacement semantics and deep object merging.
 */

import { asRecord } from "./coercion.js";
import { isDangerousKey } from "./overlay-helpers.js";

/**
 * Deep merge overlay into base.
 *
 * - Arrays in overlay replace arrays in base entirely
 * - Objects are merged recursively
 * - Primitives in overlay replace those in base
 * - `__proto__`/`constructor`/`prototype` keys are dropped at every depth so an
 *   untrusted overlay (loaded YAML or DB config) cannot pollute Object.prototype.
 */
export function deepMerge(base: unknown, overlay: unknown): unknown {
  if (Array.isArray(overlay)) {
    return [...overlay];
  }
  if (typeof overlay !== "object" || overlay === null) {
    return overlay;
  }
  const baseRecord = asRecord(base);
  const overlayRecord = asRecord(overlay);
  const merged: Record<string, unknown> = { ...baseRecord };
  for (const [key, value] of Object.entries(overlayRecord)) {
    if (isDangerousKey(key)) {
      continue;
    }
    merged[key] = deepMerge(baseRecord[key], value);
  }
  return merged;
}

/**
 * Create a deep clone of a config map using structuredClone.
 * Supports all structured-cloneable values (Date, RegExp, Map, Set, etc.).
 */
export function cloneConfigMap(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}
