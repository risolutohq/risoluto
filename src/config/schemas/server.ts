/**
 * Zod schemas for server, polling, notification,
 * GitHub, repo, and state machine config subsections.
 */

import { z } from "zod";

import { OPERATOR_PERMISSIONS } from "../../workflow-run/operator-approval-contract.js";

export const pollingConfigSchema = z.object({
  intervalMs: z.number().default(15000),
});

export const serverConfigSchema = z.object({
  port: z.number().default(4000),
});

const notificationVerbositySchema = z.enum(["off", "critical", "verbose"]).catch("critical");
const notificationSeveritySchema = z.enum(["info", "warning", "critical"]).catch("info");

const slackConfigSchema = z
  .object({
    webhookUrl: z.string(),
    verbosity: notificationVerbositySchema.default("critical"),
  })
  .nullable()
  .default(null);

const notificationChannelBaseSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  minSeverity: notificationSeveritySchema.default("info"),
});

const slackChannelConfigSchema = notificationChannelBaseSchema.extend({
  type: z.literal("slack"),
  webhookUrl: z.string(),
  verbosity: notificationVerbositySchema.default("critical"),
});

const webhookChannelConfigSchema = notificationChannelBaseSchema.extend({
  type: z.literal("webhook"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).default({}),
});

const desktopChannelConfigSchema = notificationChannelBaseSchema.extend({
  type: z.literal("desktop"),
});

export const notificationConfigSchema = z.object({
  slack: slackConfigSchema,
  channels: z
    .array(z.union([slackChannelConfigSchema, webhookChannelConfigSchema, desktopChannelConfigSchema]))
    .default([]),
});

export const gitHubConfigSchema = z
  .object({
    token: z.string(),
    apiBaseUrl: z.string().default("https://api.github.com"),
  })
  .nullable()
  .default(null);

export const repoConfigSchema = z.object({
  repoUrl: z.string(),
  defaultBranch: z.string().default("main"),
  identifierPrefix: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
  githubOwner: z.string().nullable().default(null),
  githubRepo: z.string().nullable().default(null),
  githubTokenEnv: z.string().nullable().default(null),
});

const stageKindSchema = z.enum(["backlog", "todo", "active", "gate", "terminal"]);

const stateStageConfigSchema = z.object({
  name: z.string().min(1),
  kind: stageKindSchema,
});

export const stateMachineConfigSchema = z
  .object({
    stages: z.array(stateStageConfigSchema).default([]),
    transitions: z.record(z.string(), z.array(z.string())).default({}),
  })
  .nullable()
  .default(null);

const slackIntakeRuleSchema = z.object({
  id: z.string().min(1),
  workflowDefinitionId: z.string().min(1),
  workspaceKey: z.string().min(1),
});

const slackOperatorIdentityConfigSchema = z.object({
  id: z.string().min(1),
  slackUserId: z.string().min(1),
  permissions: z.array(z.enum(OPERATOR_PERMISSIONS)).default([]),
});

export const slackIntakeConfigSchema = z
  .object({
    signingSecret: z.string().min(1),
    operators: z.array(slackOperatorIdentityConfigSchema).default([]),
    allowedTeamIds: z.array(z.string()).default([]),
    rules: z.array(slackIntakeRuleSchema).default([]),
  })
  .nullable()
  .default(null);
