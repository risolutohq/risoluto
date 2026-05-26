import type { ReasoningEffort } from "../core/types.js";

export type TestModelProfileName = "pr-live-smoke" | "release-live" | "regression-frozen";

interface TestModelProfileDefinition {
  name: TestModelProfileName;
  baseUrlEnv: string;
  defaultBaseUrl: string;
  modelEnv: string;
  defaultModel: string;
  reasoningEffortEnv: string;
  defaultReasoningEffort: ReasoningEffort;
  apiKeyEnv: "RISOLUTO_LIVE_MODEL_API_KEY";
}

export interface ResolvedTestModelProfile {
  name: TestModelProfileName;
  baseUrl: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  apiKeyEnv: "RISOLUTO_LIVE_MODEL_API_KEY";
  apiKey: string | null;
}

const MODEL_PROXY_BASE_URL = "https://cliproxy.dreampedia.app";
const LIVE_MODEL_API_KEY_ENV = "RISOLUTO_LIVE_MODEL_API_KEY";

export const TEST_MODEL_PROFILES = {
  "pr-live-smoke": {
    name: "pr-live-smoke",
    baseUrlEnv: "RISOLUTO_LIVE_MODEL_BASE_URL",
    defaultBaseUrl: MODEL_PROXY_BASE_URL,
    modelEnv: "RISOLUTO_LIVE_MODEL_ID",
    defaultModel: "gpt-5.4-mini",
    reasoningEffortEnv: "RISOLUTO_LIVE_MODEL_REASONING_EFFORT",
    defaultReasoningEffort: "high",
    apiKeyEnv: LIVE_MODEL_API_KEY_ENV,
  },
  "release-live": {
    name: "release-live",
    baseUrlEnv: "RISOLUTO_LIVE_MODEL_BASE_URL",
    defaultBaseUrl: MODEL_PROXY_BASE_URL,
    modelEnv: "RISOLUTO_RELEASE_MODEL_ID",
    defaultModel: "gpt-5.5",
    reasoningEffortEnv: "RISOLUTO_RELEASE_MODEL_REASONING_EFFORT",
    defaultReasoningEffort: "medium",
    apiKeyEnv: LIVE_MODEL_API_KEY_ENV,
  },
  "regression-frozen": {
    name: "regression-frozen",
    baseUrlEnv: "RISOLUTO_LIVE_MODEL_BASE_URL",
    defaultBaseUrl: MODEL_PROXY_BASE_URL,
    modelEnv: "RISOLUTO_LIVE_MODEL_ID",
    defaultModel: "gpt-5.4-mini",
    reasoningEffortEnv: "RISOLUTO_LIVE_MODEL_REASONING_EFFORT",
    defaultReasoningEffort: "high",
    apiKeyEnv: LIVE_MODEL_API_KEY_ENV,
  },
} satisfies Record<TestModelProfileName, TestModelProfileDefinition>;

export function resolveTestModelProfile(
  name: TestModelProfileName,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedTestModelProfile {
  const definition = TEST_MODEL_PROFILES[name];
  return {
    name,
    baseUrl: envValue(env, definition.baseUrlEnv) ?? definition.defaultBaseUrl,
    model: envValue(env, definition.modelEnv) ?? definition.defaultModel,
    reasoningEffort: resolveReasoningEffort(envValue(env, definition.reasoningEffortEnv), definition),
    apiKeyEnv: definition.apiKeyEnv,
    apiKey: envValue(env, definition.apiKeyEnv),
  };
}

function resolveReasoningEffort(value: string | null, definition: TestModelProfileDefinition): ReasoningEffort {
  if (isReasoningEffort(value)) {
    return value;
  }
  return definition.defaultReasoningEffort;
}

function isReasoningEffort(value: string | null): value is ReasoningEffort {
  return (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}
