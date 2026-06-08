/**
 * Canonical raw config defaults for each section.
 *
 * These represent the "empty config" baseline — the values that
 * `deriveServiceConfig()` would produce if the overlay were an empty
 * object. Used to seed the DB on first boot.
 *
 * Keys match the section names consumed by `deriveServiceConfig()`:
 * tracker, workspace, hooks, agent, codex, server, polling,
 * notifications, github, repos, state_machine, system.
 */

export const DEFAULT_CONFIG_SECTIONS: Record<string, Record<string, unknown>> = {
  tracker: {
    kind: "linear",
    endpoint: "https://api.linear.app/graphql",
    active_states: ["Backlog", "Todo", "In Progress"],
    terminal_states: ["Done", "Canceled"],
  },

  workspace: {
    root: "../risoluto-workspaces",
    strategy: "directory",
    branch_prefix: "risoluto/",
    branch_template: "risoluto/{workflow}/{date}-{short-intent}-{run-id}",
    dirty_policy: "reject",
    worktree_retention_days: 7,
  },

  hooks: {
    timeout_ms: 60000,
  },

  agent: {
    max_concurrent_agents: 10,
    max_turns: 20,
    max_retry_backoff_ms: 300000,
    max_continuation_attempts: 5,
    stall_timeout_ms: 1200000,
  },

  codex: {
    command: "codex app-server",
    model: "gpt-5.4",
    reasoning_effort: "high",
    approval_policy: "never",
    thread_sandbox: "workspace-write",
    personality: "friendly",
    self_review: false,
    read_timeout_ms: 5000,
    turn_timeout_ms: 3600000,
    drain_timeout_ms: 2000,
    startup_timeout_ms: 30000,
    stall_timeout_ms: 300000,
    structured_output: false,
    auth: {
      mode: "api_key",
      source_home: "~/.codex",
    },
    sandbox: {
      image: "risoluto-codex:latest",
      network: "",
      security: {
        no_new_privileges: true,
        drop_capabilities: true,
        gvisor: false,
        seccomp_profile: "",
      },
      resources: {
        memory: "4g",
        memory_reservation: "1g",
        memory_swap: "4g",
        cpus: "2.0",
        tmpfs_size: "512m",
      },
      logs: {
        driver: "json-file",
        max_size: "50m",
        max_file: 3,
      },
    },
  },

  server: {
    port: 4000,
  },

  polling: {
    interval_ms: 15000,
  },

  notifications: {
    channels: [],
  },
  triggers: {
    allowed_actions: ["refresh_issue"],
    rate_limit_per_minute: 30,
  },
  automations: {},
  alerts: {
    rules: [],
  },
  intake_rules: {
    rules: [],
  },
  github: {},
  repos: {},
  state_machine: {
    stages: [
      { name: "Backlog", kind: "backlog" },
      { name: "Todo", kind: "todo" },
      { name: "In Progress", kind: "active" },
      { name: "In Review", kind: "gate" },
      { name: "Done", kind: "terminal" },
      { name: "Canceled", kind: "terminal" },
    ],
  },

  /** System metadata — setup state and active template. */
  system: {
    setupCompletedAt: null,
    selectedTemplateId: null,
  },
};

/**
 * Default prompt template seeded on first boot.
 */
export const DEFAULT_PROMPT_TEMPLATE = `You are working on Workflow Run {{ workflowRun.identifier }}: "{{ workflowRun.title }}"

{% if workflowRun.description %}
## Workflow Run Description

{{ workflowRun.description }}
{% endif %}

When you have truly finished the Workflow Run and should stop, end your final message with \`RISOLUTO_STATUS: DONE\`. If you are blocked and cannot make further progress, end your final message with \`RISOLUTO_STATUS: BLOCKED\`.

Respect the repository state you find in the workspace, explain what you are doing in short operator-friendly updates, and stop once the Workflow Run is either complete or blocked.
`;
