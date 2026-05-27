export type LivePreflightStatus = "passed" | "failed" | "skipped";

export interface LivePreflightCheck {
  name: "config" | "linear" | "github_app" | "github_app_sandbox_lifecycle" | "model_proxy";
  status: LivePreflightStatus;
  detail: string;
  resource?: Record<string, string>;
}

export interface LivePreflightReport {
  generatedAt: string;
  overall: LivePreflightStatus;
  checks: LivePreflightCheck[];
}

export interface LivePreflightDeps {
  fetch?: typeof fetch;
  now?: () => string;
  createGitHubJwt?: (input: { appId: string; privateKey: string }) => string;
}
