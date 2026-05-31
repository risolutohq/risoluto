import { z, ZodError, type ZodType } from "zod";

import { ciResultArtifactSchema } from "./ci-babysitter.js";
import { handoffArtifactSchema } from "./handoff-contract.js";
import { operatorApprovalArtifactSchema } from "./operator-approval-contract.js";
import { operatorResponseArtifactSchema } from "./operator-response-contract.js";
import { publishResultArtifactSchema } from "./publish-policy.js";
import { verificationArtifactSchema } from "./verification-contract.js";

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

export const WORKFLOW_RUN_ARTIFACT_CONTRACT_IDS = [
  "intent.v1",
  "plan.v1",
  "change_summary.v1",
  "review.v1",
  "validation_result.v1",
  "publish_result.v1",
  "ci_result.v1",
  "verification.v1",
  "handoff.v1",
  "operator_response.v1",
  "operator_approval.v1",
] as const;

const artifactMetadataSchema = {
  version: z.literal(1),
  workflowRunId: z.string().min(1),
  createdAt: z.string().min(1),
} as const;

const externalReferenceSchema = z
  .object({
    provider: z.enum(["api", "cli", "github", "linear", "slack"]),
    id: z.string().min(1),
    url: z.string().min(1).nullable(),
  })
  .strict();

const validationCheckSchema = z
  .object({
    id: z.string().min(1),
    command: z.string().min(1),
    status: z.enum(["failed", "passed"]),
    exitCode: z.number().int(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

const validationResultSchema = z
  .object({
    ...artifactMetadataSchema,
    profileId: z.enum(["node-pnpm-standard", "offline-smoke"]),
    failureHandling: z.enum(["collect_all", "stop_on_first"]),
    status: z.enum(["failed", "passed"]),
    checks: z.array(validationCheckSchema).min(1),
  })
  .strict()
  .superRefine((artifact, context) => {
    const hasFailedCheck = artifact.checks.some((check) => check.status === "failed");
    if (artifact.status === "passed" && hasFailedCheck) {
      context.addIssue({ code: "custom", path: ["status"], message: "must be failed when any check failed" });
    }
    if (artifact.status === "failed" && !hasFailedCheck) {
      context.addIssue({ code: "custom", path: ["status"], message: "must be passed when all checks passed" });
    }
  });

const artifactContractSchemaEntries: readonly (readonly [
  (typeof WORKFLOW_RUN_ARTIFACT_CONTRACT_IDS)[number],
  ZodType<unknown>,
])[] = [
  [
    "intent.v1",
    z
      .object({
        ...artifactMetadataSchema,
        source: z.enum(["api", "cli", "github", "linear", "slack"]),
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
  ["validation_result.v1", validationResultSchema],
  ["publish_result.v1", publishResultArtifactSchema],
  ["ci_result.v1", ciResultArtifactSchema],
  ["verification.v1", verificationArtifactSchema],
  ["handoff.v1", handoffArtifactSchema],
  ["operator_response.v1", operatorResponseArtifactSchema],
  ["operator_approval.v1", operatorApprovalArtifactSchema],
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
