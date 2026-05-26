import type { Express, NextFunction, Request, Response } from "express";

import { listWorkflowRuns } from "../../workflow-run/list-artifacts.js";
import { readWorkflowRunEvents } from "../../workflow-run/artifacts.js";
import { createWorkflowRunArchive } from "../../workflow-run/archive.js";
import { listWorkflowRunAttempts } from "../../workflow-run/run-attempt-projection.js";
import type { HttpRouteDeps } from "../route-types.js";
import { methodNotAllowed } from "../route-helpers.js";

export function registerWorkflowRunRoutes(app: Express, deps: HttpRouteDeps): void {
  app
    .route("/api/v1/workflow-runs")
    .get((req, res, next) => listWorkflowRunsHandler(req, res, next, deps))
    .all((_req, res) => {
      methodNotAllowed(res);
    });

  app
    .route("/api/v1/workflow-runs/:workflow_run_id/events")
    .get((req, res, next) => listWorkflowRunEventsHandler(req, res, next, deps))
    .all((_req, res) => {
      methodNotAllowed(res);
    });

  app
    .route("/api/v1/workflow-runs/:workflow_run_id/run-attempts")
    .get((req, res, next) => listWorkflowRunAttemptsHandler(req, res, next, deps))
    .all((_req, res) => {
      methodNotAllowed(res);
    });

  app
    .route("/api/v1/workflow-runs/:workflow_run_id")
    .get((req, res, next) => loadWorkflowRunHandler(req, res, next, deps))
    .all((_req, res) => {
      methodNotAllowed(res);
    });
}

async function listWorkflowRunsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
  deps: HttpRouteDeps,
): Promise<void> {
  try {
    if (!deps.archiveDir) {
      sendArchiveUnavailable(res);
      return;
    }

    res.json(await listWorkflowRuns({ archiveDir: deps.archiveDir }));
  } catch (error) {
    next(error);
  }
}

async function listWorkflowRunEventsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
  deps: HttpRouteDeps,
): Promise<void> {
  try {
    if (!deps.archiveDir) {
      sendArchiveUnavailable(res);
      return;
    }

    res.json(
      await readWorkflowRunEvents({
        archiveDir: deps.archiveDir,
        workflowRunId: String(req.params.workflow_run_id),
      }),
    );
  } catch (error) {
    handleWorkflowRunReadError(error, res, next);
  }
}

async function loadWorkflowRunHandler(
  req: Request,
  res: Response,
  next: NextFunction,
  deps: HttpRouteDeps,
): Promise<void> {
  try {
    if (!deps.archiveDir) {
      sendArchiveUnavailable(res);
      return;
    }

    const workflowRun = await createWorkflowRunArchive({ archiveDir: deps.archiveDir }).loadWorkflowRun(
      String(req.params.workflow_run_id),
    );
    res.json({
      type: "workflow_run.loaded",
      workflowRun,
    });
  } catch (error) {
    handleWorkflowRunReadError(error, res, next);
  }
}

async function listWorkflowRunAttemptsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
  deps: HttpRouteDeps,
): Promise<void> {
  try {
    if (!deps.archiveDir) {
      sendArchiveUnavailable(res);
      return;
    }

    res.json(
      await listWorkflowRunAttempts({
        archiveDir: deps.archiveDir,
        workflowRunId: String(req.params.workflow_run_id),
      }),
    );
  } catch (error) {
    handleWorkflowRunReadError(error, res, next);
  }
}

function sendArchiveUnavailable(res: Response): void {
  res.status(503).json({
    error: {
      code: "unavailable",
      message: "Workflow Run archive not configured",
    },
  });
}

function handleWorkflowRunReadError(error: unknown, res: Response, next: NextFunction): void {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    res.status(404).json({
      error: {
        code: "not_found",
        message: "Workflow Run not found",
      },
    });
    return;
  }

  next(error);
}
