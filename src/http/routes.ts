import type { Express } from "express";

import { createMetricsCollector } from "../observability/metrics.js";
import { validateHttpDeps } from "./dep-validator.js";
import type { HttpRouteDeps } from "./route-types.js";
import { registerExtensionRoutes } from "./routes/extensions.js";
import { registerGitRoutes } from "./routes/git.js";
import { registerIssueRoutes } from "./routes/issues.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerCodexRoutes } from "./routes/codex.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { registerWorkflowRunRoutes } from "./routes/workflow-runs.js";

export function registerHttpRoutes(app: Express, deps: HttpRouteDeps): void {
  const routeDeps = {
    ...deps,
    metrics: deps.metrics ?? createMetricsCollector(),
    observability: deps.observability,
  } satisfies HttpRouteDeps;

  validateHttpDeps(routeDeps);

  registerSystemRoutes(app, routeDeps);
  registerCodexRoutes(app, routeDeps);
  registerExtensionRoutes(app, routeDeps);
  registerGitRoutes(app, routeDeps);
  registerWorkflowRunRoutes(app, routeDeps);
  registerWorkspaceRoutes(app, routeDeps);
  registerNotificationRoutes(app, routeDeps);
  registerIssueRoutes(app, routeDeps);
  registerWebhookRoutes(app, routeDeps);

  // Keep unmatched webhook deliveries on the same JSON error contract as API routes.
  app.all("/webhooks/*path", (_request, response) => {
    response.status(404).json({ error: { code: "not_found", message: "Not found" } });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: { code: "not_found", message: "Not found" } });
  });
}
