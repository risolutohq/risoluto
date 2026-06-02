import { z } from "zod";

export const OPERATOR_PERMISSIONS = [
  "start_run",
  "answer_clarification",
  "approve_pr_create",
  "approve_budget_override",
  "approve_destructive_action",
  "approve_secret_access",
  "approve_auto_merge",
  "cancel_run",
] as const;

export type OperatorPermission = (typeof OPERATOR_PERMISSIONS)[number];

export const operatorApprovalArtifactSchema = z
  .object({
    version: z.literal(1),
    workflowRunId: z.string().min(1),
    createdAt: z.string().min(1),
    source: z.literal("slack"),
    operator: z
      .object({
        id: z.string().min(1),
        slackUserId: z.string().min(1),
      })
      .strict(),
    permission: z.enum(OPERATOR_PERMISSIONS),
    actionId: z.string().min(1),
    nonce: z.string().min(1),
    slack: z
      .object({
        teamId: z.string().min(1).nullable(),
        userId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type OperatorApprovalArtifact = z.infer<typeof operatorApprovalArtifactSchema>;
