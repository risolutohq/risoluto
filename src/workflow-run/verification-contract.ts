import { z } from "zod";

const artifactMetadataSchema = {
  version: z.literal(1),
  workflowRunId: z.string().min(1),
  createdAt: z.string().min(1),
} as const;

const verifierAllowedInputSchema = z.enum([
  "intent.v1",
  "plan.v1",
  "change_summary.v1",
  "review.v1",
  "validation_result.v1",
  "publish_result.v1",
  "ci_result.v1",
  "diff",
  "evidence_links",
]);

const verifierDecisionSchema = z.enum(["satisfied", "not_satisfied", "uncertain"]);

const postPublishReconfirmSchema = z
  .object({
    required: z.literal(true),
    prePublishDecision: verifierDecisionSchema,
    decision: verifierDecisionSchema,
    summary: z.string().min(1),
    checkedInputs: z.array(z.enum(["publish_result.v1", "ci_result.v1", "handoff.v1"])),
    contradictedBy: z.array(z.enum(["publish_result.v1", "ci_result.v1", "handoff.v1"])),
  })
  .strict();

const verificationBaseSchema = z.object({
  ...artifactMetadataSchema,
  decision: verifierDecisionSchema,
  summary: z.string().min(1),
  allowedInputs: z.array(verifierAllowedInputSchema),
  evidenceLinks: z.array(z.string().min(1)),
  postPublishReconfirm: postPublishReconfirmSchema.optional(),
});

const councillorBaseSchema = z.object({
  id: z.string().min(1),
  modelProfile: z.string().min(1),
  lens: z.string().min(1),
});

export const verificationArtifactSchema = z.discriminatedUnion("mode", [
  verificationBaseSchema.extend({ mode: z.literal("single") }).strict(),
  verificationBaseSchema
    .extend({
      mode: z.literal("council"),
      consensus: z.enum(["unanimous", "majority", "split"]),
      councillors: z.array(
        z.discriminatedUnion("status", [
          councillorBaseSchema
            .extend({
              status: z.literal("completed"),
              decision: verifierDecisionSchema,
              summary: z.string().min(1),
            })
            .strict(),
          councillorBaseSchema.extend({ status: z.literal("failed"), error: z.string().min(1) }).strict(),
        ]),
      ),
    })
    .strict(),
]);
