import { z, ZodError, type ZodType } from "zod";

export interface WorkflowRunArtifactProducer {
  readonly type: "role" | "action";
  readonly id: string;
}

export interface ParseWorkflowRunArtifactInput {
  readonly contractId: string;
  readonly data: unknown;
  readonly producer?: WorkflowRunArtifactProducer;
}

export class WorkflowRunArtifactContractError extends Error {
  readonly contractId: string;
  readonly producer?: WorkflowRunArtifactProducer;

  constructor(message: string, input: ParseWorkflowRunArtifactInput, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowRunArtifactContractError";
    this.contractId = input.contractId;
    this.producer = input.producer;
  }
}

export const WORKFLOW_RUN_ARTIFACT_CONTRACT_IDS = ["intent.v1", "plan.v1", "change_summary.v1", "review.v1"] as const;

const artifactMetadataSchema = {
  version: z.literal(1),
  workflowRunId: z.string().min(1),
  createdAt: z.string().min(1),
} as const;

const externalReferenceSchema = z
  .object({
    provider: z.enum(["cli", "github", "linear", "slack"]),
    id: z.string().min(1),
    url: z.string().min(1).nullable(),
  })
  .strict();

const artifactContractSchemaEntries: readonly (readonly [
  (typeof WORKFLOW_RUN_ARTIFACT_CONTRACT_IDS)[number],
  ZodType<unknown>,
])[] = [
  [
    "intent.v1",
    z
      .object({
        ...artifactMetadataSchema,
        source: z.enum(["cli", "github", "linear", "slack"]),
        title: z.string().min(1),
        body: z.string().min(1),
        externalReferences: z.array(externalReferenceSchema),
      })
      .strict(),
  ],
  [
    "plan.v1",
    z
      .object({
        ...artifactMetadataSchema,
        summary: z.string().min(1),
        steps: z.array(
          z
            .object({
              id: z.string().min(1),
              title: z.string().min(1),
              status: z.enum(["blocked", "pending", "ready"]),
              dependsOn: z.array(z.string().min(1)),
            })
            .strict(),
        ),
      })
      .strict(),
  ],
  [
    "change_summary.v1",
    z
      .object({
        ...artifactMetadataSchema,
        summary: z.string().min(1),
        changedFiles: z.array(
          z
            .object({
              path: z.string().min(1),
              changeType: z.enum(["added", "deleted", "modified"]),
              summary: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
  ],
  [
    "review.v1",
    z
      .object({
        ...artifactMetadataSchema,
        verdict: z.enum(["fail", "needs_operator", "pass"]),
        findings: z.array(
          z
            .object({
              severity: z.enum(["high", "low", "medium"]),
              summary: z.string().min(1),
              file: z.string().min(1).optional(),
            })
            .strict(),
        ),
      })
      .strict(),
  ],
];

const artifactContractSchemas: ReadonlyMap<string, ZodType<unknown>> = new Map(artifactContractSchemaEntries);

export function isWorkflowRunArtifactContractId(contractId: string): boolean {
  return artifactContractSchemas.has(contractId);
}

export function parseWorkflowRunArtifact(input: ParseWorkflowRunArtifactInput): unknown {
  const schema = artifactContractSchemas.get(input.contractId);
  if (!schema) {
    throw new WorkflowRunArtifactContractError(`unknown artifact contract id ${input.contractId}`, input);
  }

  try {
    return schema.parse(input.data);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new WorkflowRunArtifactContractError(formatInvalidArtifactMessage(input, error), input, { cause: error });
    }
    throw error;
  }
}

function formatInvalidArtifactMessage(input: ParseWorkflowRunArtifactInput, error: ZodError): string {
  return `${formatProducer(input.producer)} produced invalid artifact ${input.contractId}: ${formatIssues(error)}`;
}

function formatProducer(producer: WorkflowRunArtifactProducer | undefined): string {
  if (!producer) {
    return "unknown producer";
  }
  if (producer.type === "role") {
    return producer.id;
  }
  return `action ${producer.id}`;
}

function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".") || "<root>";
      return `${path} ${issue.message}`;
    })
    .join("; ");
}
