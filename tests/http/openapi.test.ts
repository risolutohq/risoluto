import { describe, expect, it } from "vitest";

import { getOpenApiSpec } from "../../src/http/openapi.js";
import { getSwaggerHtml } from "../../src/http/swagger-html.js";

describe("getOpenApiSpec", () => {
  const spec = getOpenApiSpec();

  it("returns a valid OpenAPI 3.1 document", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec).toHaveProperty("info");
    expect(spec).toHaveProperty("paths");
  });

  it("includes server info", () => {
    const servers = spec.servers as Array<{ url: string; description: string }>;
    expect(servers).toHaveLength(1);
    expect(servers[0].url).toBe("http://localhost:4000");
  });

  it("declares read auth security schemes", () => {
    const components = spec.components as {
      securitySchemes: Record<string, { type: string; name?: string; in?: string; scheme?: string }>;
    };
    expect(components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(components.securitySchemes.readTokenQuery).toMatchObject({
      type: "apiKey",
      in: "query",
      name: "read_token",
    });
  });

  it("includes core state routes", () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(paths).toHaveProperty("/api/v1/state");
    expect(paths).toHaveProperty("/api/v1/observability");
    expect(paths).toHaveProperty("/api/v1/runtime");
    expect(paths).toHaveProperty("/api/v1/refresh");
    expect(paths).toHaveProperty("/metrics");
  });

  it("includes issue routes with path parameters", () => {
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths).toHaveProperty("/api/v1/{issue_identifier}");
    expect(paths).toHaveProperty("/api/v1/{issue_identifier}/abort");
    expect(paths).toHaveProperty("/api/v1/{issue_identifier}/model");
    expect(paths).toHaveProperty("/api/v1/{issue_identifier}/transition");
    expect(paths).toHaveProperty("/api/v1/{issue_identifier}/attempts");
    expect(paths).toHaveProperty("/api/v1/attempts/{attempt_id}");
    expect(paths).toHaveProperty("/api/v1/attempts/{attempt_id}/checkpoints");
    expect(paths).toHaveProperty("/api/v1/notifications");
    expect(paths).toHaveProperty("/api/v1/notifications/{notification_id}/read");
    expect(paths).toHaveProperty("/api/v1/notifications/read-all");
    expect(paths).toHaveProperty("/api/v1/automations");
    expect(paths).toHaveProperty("/api/v1/automations/runs");
    expect(paths).toHaveProperty("/api/v1/automations/{automation_name}/run");
    expect(paths).toHaveProperty("/api/v1/alerts/history");
    expect(paths).toHaveProperty("/api/v1/webhooks/trigger");
    expect(paths).toHaveProperty("/webhooks/linear");
    expect(paths).toHaveProperty("/webhooks/github");
    expect(paths).toHaveProperty("/api/v1/prs");
  });

  it("includes workspace, git, config, and secrets routes", () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(paths).toHaveProperty("/api/v1/workspaces");
    expect(paths).toHaveProperty("/api/v1/workspaces/{workspace_key}");
    expect(paths).toHaveProperty("/api/v1/git/context");
    expect(paths).toHaveProperty("/api/v1/config");
    expect(paths).toHaveProperty("/api/v1/config/overlay");
    expect(paths).toHaveProperty("/api/v1/secrets");
    expect(paths).toHaveProperty("/api/v1/secrets/{key}");
  });

  it("documents the internal Workflow Run support endpoints", () => {
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    const listItem = paths["/api/v1/workflow-runs"];
    const detailItem = paths["/api/v1/workflow-runs/{workflow_run_id}"];
    const eventsItem = paths["/api/v1/workflow-runs/{workflow_run_id}/events"];
    const runAttemptsItem = paths["/api/v1/workflow-runs/{workflow_run_id}/run-attempts"];

    expect(listItem).toHaveProperty("get");
    expect(listItem.get.operationId).toBe("listWorkflowRuns");
    expect(listItem.get.tags).toContain("Workflow Runs");
    expect(listItem.get.security).toEqual([{ bearerAuth: [] }]);
    expect(listItem.get.responses).toHaveProperty("200");
    expect(listItem.get.responses).toHaveProperty("503");
    expect(listItem).toHaveProperty("post");
    expect(listItem.post.operationId).toBe("createWorkflowRun");
    expect(listItem.post.tags).toContain("Workflow Runs");
    expect(listItem.post.security).toEqual([{ bearerAuth: [] }]);
    expect(listItem.post.requestBody).toBeDefined();
    expect(listItem.post.responses).toHaveProperty("201");
    expect(listItem.post.responses).toHaveProperty("400");
    expect(listItem.post.responses).toHaveProperty("401");
    expect(listItem.post.responses).toHaveProperty("503");

    expect(detailItem).toHaveProperty("get");
    expect(detailItem.get.operationId).toBe("getWorkflowRun");
    expect(detailItem.get.tags).toContain("Workflow Runs");
    expect(detailItem.get.security).toEqual([{ bearerAuth: [] }]);
    expect(detailItem.get.parameters).toContainEqual(
      expect.objectContaining({
        name: "workflow_run_id",
        in: "path",
        required: true,
      }),
    );
    expect(detailItem.get.responses).toHaveProperty("200");
    expect(detailItem.get.responses).toHaveProperty("404");
    expect(detailItem.get.responses).toHaveProperty("503");

    expect(eventsItem).toHaveProperty("get");
    expect(eventsItem.get.operationId).toBe("listWorkflowRunEvents");
    expect(eventsItem.get.tags).toContain("Workflow Runs");
    expect(eventsItem.get.security).toEqual([{ bearerAuth: [] }]);
    expect(eventsItem.get.parameters).toContainEqual(
      expect.objectContaining({
        name: "workflow_run_id",
        in: "path",
        required: true,
      }),
    );
    expect(eventsItem.get.responses).toHaveProperty("200");
    expect(eventsItem.get.responses).toHaveProperty("503");

    expect(runAttemptsItem).toHaveProperty("get");
    expect(runAttemptsItem.get.operationId).toBe("listWorkflowRunAttempts");
    expect(runAttemptsItem.get.tags).toContain("Workflow Runs");
    expect(runAttemptsItem.get.security).toEqual([{ bearerAuth: [] }]);
    expect(runAttemptsItem.get.parameters).toContainEqual(
      expect.objectContaining({
        name: "workflow_run_id",
        in: "path",
        required: true,
      }),
    );
    expect(runAttemptsItem.get.responses).toHaveProperty("200");
    expect(runAttemptsItem.get.responses).toHaveProperty("404");
    expect(runAttemptsItem.get.responses).toHaveProperty("503");
  });

  it("references request body schemas on POST endpoints", () => {
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    const modelPost = paths["/api/v1/{issue_identifier}/model"].post;
    expect(modelPost).toHaveProperty("requestBody");

    const transitionPost = paths["/api/v1/{issue_identifier}/transition"].post;
    expect(transitionPost).toHaveProperty("requestBody");

    const triggerPost = paths["/api/v1/webhooks/trigger"].post;
    expect(triggerPost).toHaveProperty("requestBody");

    const workflowRunPost = paths["/api/v1/workflow-runs"].post;
    expect(workflowRunPost).toHaveProperty("requestBody");
  });

  it("groups routes by tags", () => {
    const paths = spec.paths as Record<string, Record<string, Record<string, string[]>>>;
    expect(paths["/api/v1/state"].get.tags).toContain("State & Metrics");
    expect(paths["/api/v1/{issue_identifier}/abort"].post.tags).toContain("Issues");
    expect(paths["/api/v1/{issue_identifier}/attempts"].get.tags).toContain("Attempts");
    expect(paths["/api/v1/notifications"].get.tags).toContain("Notifications");
    expect(paths["/api/v1/automations"].get.tags).toContain("Automations");
    expect(paths["/api/v1/alerts/history"].get.tags).toContain("Alerts");
    expect(paths["/api/v1/webhooks/trigger"].post.tags).toContain("Ingress");
    expect(paths["/api/v1/workspaces"].get.tags).toContain("Workspaces");
    expect(paths["/api/v1/git/context"].get.tags).toContain("Git");
    expect(paths["/api/v1/config"].get.tags).toContain("Config");
    expect(paths["/api/v1/secrets"].get.tags).toContain("Secrets");
  });

  it("marks protected reads with auth requirements", () => {
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths["/api/v1/state"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(paths["/api/v1/observability"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(paths["/api/v1/{issue_identifier}"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(paths["/api/v1/runtime"].get.security).toBeUndefined();
  });

  it("produces JSON-serializable output", () => {
    const serialized = JSON.stringify(spec);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});

describe("getSwaggerHtml", () => {
  const html = getSwaggerHtml();

  it("returns an HTML document", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("loads Swagger UI from CDN", () => {
    expect(html).toContain("swagger-ui-bundle.js");
    expect(html).toContain("swagger-ui.css");
    expect(html).toContain("unpkg.com/swagger-ui-dist");
  });

  it("points to the openapi.json endpoint", () => {
    expect(html).toContain("/api/v1/openapi.json");
  });
});
