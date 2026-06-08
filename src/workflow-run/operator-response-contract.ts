import { z } from "zod";

export const operatorResponseArtifactSchema = z
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
    questionId: z.string().min(1),
    response: z.string().min(1),
    slack: z
      .object({
        teamId: z.string().min(1).nullable(),
        userId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type OperatorResponseArtifact = z.infer<typeof operatorResponseArtifactSchema>;
