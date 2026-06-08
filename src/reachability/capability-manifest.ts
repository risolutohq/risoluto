import { z, ZodError } from "zod";

/**
 * Intake adapters a capability can be required to be reachable from. These are the production entry
 * roots the reachability gate measures from: the CLI command entry, the HTTP route registry, and the
 * Slack webhook route.
 *
 * Naming note: this module is a dev-time / CI reachability concept. It is deliberately distinct from
 * the runtime product **Verifier** role and **Validation Gate** — the capability manifest answers
 * "is this capability wired into Risoluto", never "did a Workflow Run satisfy its intent".
 */
export const INTAKE_ADAPTER_IDS = ["cli", "http", "slack"] as const;

export type IntakeAdapterId = (typeof INTAKE_ADAPTER_IDS)[number];

const deferredSchema = z.object({ reason: z.string().min(1) }).strict();

const capabilityManifestEntrySchema = z
  .object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    module: z.string().min(1),
    intakeAdapters: z.array(z.enum(INTAKE_ADAPTER_IDS)).min(1),
    reason: z.string().min(1),
    deferred: deferredSchema.optional(),
  })
  .strict();

const capabilityManifestSchema = z.array(capabilityManifestEntrySchema);

/** A single load-bearing capability the reachability gate enforces. */
export type CapabilityManifestEntry = z.infer<typeof capabilityManifestEntrySchema>;

/** The committed capability manifest — the single source of "the bar". */
export type CapabilityManifest = readonly CapabilityManifestEntry[];

/**
 * Raised when the capability manifest is structurally invalid. Named to stay clearly distinct from
 * the runtime Verifier role and Validation Gate.
 */
export class CapabilityManifestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CapabilityManifestError";
  }
}

/**
 * Parse and validate a raw (already-deserialized) capability manifest into typed records. Rejects a
 * malformed manifest — an unknown intake adapter, a missing required field, or a `deferred` flag
 * without a reason — with a `CapabilityManifestError` that names the offending entry.
 */
export function loadCapabilityManifest(raw: unknown): CapabilityManifest {
  try {
    return capabilityManifestSchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new CapabilityManifestError(formatManifestError(raw, error), { cause: error });
    }
    throw error;
  }
}

function formatManifestError(raw: unknown, error: ZodError): string {
  return error.issues.map((issue) => formatManifestIssue(raw, issue)).join("; ");
}

function formatManifestIssue(raw: unknown, issue: z.core.$ZodIssue): string {
  const [entryIndex, ...rest] = issue.path;
  const entryLabel = describeEntry(raw, entryIndex);
  if (issue.code === "unrecognized_keys") {
    return `${entryLabel}: unsupported field ${issue.keys.join(", ")}`;
  }
  const fieldPath = rest.map(String).join(".");
  const location = fieldPath ? `${entryLabel} at ${fieldPath}` : entryLabel;
  return `${location}: ${issue.message}`;
}

function describeEntry(raw: unknown, entryIndex: PropertyKey | undefined): string {
  if (typeof entryIndex !== "number") {
    return "capability manifest";
  }
  const entry = Array.isArray(raw) ? (raw[entryIndex] as unknown) : undefined;
  const name = isRecord(entry) && typeof entry.name === "string" ? entry.name : undefined;
  return name != null && name.length > 0
    ? `capability "${name}" (entry #${entryIndex})`
    : `capability entry #${entryIndex}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
