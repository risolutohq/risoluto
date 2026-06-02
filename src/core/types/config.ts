import type { AgentConfig } from "../../config/schemas/agent.js";
import type { AlertConfig, AutomationConfig, NotificationConfig, TriggerConfig } from "../notification-types.js";
import type { CodexConfig } from "./codex.js";
import type { OperatorPermission } from "../../workflow-run/operator-approval-contract.js";
import type { WorkflowRunIntakeRule } from "../../workflow-run/intake-rules.js";

export interface TrackerConfig {
  kind: string;
  apiKey: string;
  endpoint: string;
  projectSlug: string | null;
  owner?: string;
  repo?: string;
  activeStates: string[];
  terminalStates: string[];
}

export interface GitHubConfig {
  token: string;
  apiBaseUrl: string;
}

export interface RepoConfig {
  repoUrl: string;
  defaultBranch: string;
  identifierPrefix: string | null;
  label: string | null;
  githubOwner?: string | null;
  githubRepo?: string | null;
  githubTokenEnv?: string | null;
}

export interface PollingConfig {
  intervalMs: number;
}

export interface WebhookConfig {
  webhookUrl: string;
  webhookSecret: string;
  /** Previous secret during rotation window (optional, for dual-secret validation). */
  previousWebhookSecret?: string | null;
  pollingStretchMs: number;
  pollingBaseMs: number;
  healthCheckIntervalMs: number;
}

interface WorkspaceHooks {
  afterCreate: string | null;
  beforeRun: string | null;
  afterRun: string | null;
  beforeRemove: string | null;
  timeoutMs: number;
}

export type WorkspaceStrategy = "directory" | "worktree";
export type WorkspaceDirtyPolicy = "reject" | "auto_stash" | "require_approval";

export interface WorkspaceConfig {
  root: string;
  hooks: WorkspaceHooks;
  strategy: WorkspaceStrategy;
  branchPrefix: string;
  branchTemplate: string;
  dirtyPolicy: WorkspaceDirtyPolicy;
  worktreeRetentionDays: number;
}

export interface ServerConfig {
  port: number;
}

export type StateStageKind = "backlog" | "todo" | "active" | "gate" | "terminal";

export interface StateStageConfig {
  name: string;
  kind: StateStageKind;
}

export interface StateMachineConfig {
  stages: StateStageConfig[];
  transitions: Record<string, string[]>;
}

export interface SlackOperatorIdentityConfig {
  id: string;
  slackUserId: string;
  permissions: readonly OperatorPermission[];
}

export interface SlackIntakeConfig {
  signingSecret: string;
  operators: readonly SlackOperatorIdentityConfig[];
  allowedTeamIds: readonly string[];
  rules: readonly WorkflowRunIntakeRule[];
}

export interface ServiceConfig {
  tracker: TrackerConfig;
  notifications?: NotificationConfig;
  triggers?: TriggerConfig | null;
  automations?: AutomationConfig[];
  alerts?: AlertConfig | null;
  github?: GitHubConfig | null;
  repos?: RepoConfig[];
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  agent: AgentConfig;
  codex: CodexConfig;
  stateMachine?: StateMachineConfig | null;
  server: ServerConfig;
  webhook?: WebhookConfig | null;
  slackIntake?: SlackIntakeConfig | null;
}
