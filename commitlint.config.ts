import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "agent",
        "alerts",
        "audit",
        "automation",
        "ci",
        "cli",
        "codex",
        "config",
        "core",
        "deps",
        "dispatch",
        "docker",
        "git",
        "github",
        "http",
        "linear",
        "notification",
        "observability",
        "orchestrator",
        "persistence",
        "prompt",
        "reachability",
        "release",
        "secrets",
        "setup",
        "state",
        "tracker",
        "utils",
        "webhook",
        "workflow",
        "workspace",
      ],
    ],
  },
};

export default config;
