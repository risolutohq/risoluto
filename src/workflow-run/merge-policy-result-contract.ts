import { z } from "zod";

/**
 * Merge-policy verdict persisted at PR-publish time (NIN-272), when the workspace diff is still available
 * to `evaluateMergePolicy`. The post-run auto-merge completion path reads it back as a pure artifact rather
 * than re-deriving a diff after the workspace may have been cleaned up.
 */
export const mergePolicyResultArtifactSchema = z
  .object({
    version: z.literal(1),
    workflowRunId: z.string().min(1),
    createdAt: z.string().min(1),
    status: z.enum(["failed", "passed"]),
    mergeMethod: z.enum(["merge", "rebase", "squash"]),
  })
  .strict();

export type MergePolicyResultArtifact = z.infer<typeof mergePolicyResultArtifactSchema>;
