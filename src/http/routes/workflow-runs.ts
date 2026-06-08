import type { Express, NextFunction, Request, Response } from "express";

import { listWorkflowRuns } from "../../workflow-run/list-artifacts.js";
import { readWorkflowRunEvents, toStartedOutput } from "../../workflow-run/artifacts.js";
import { createWorkflowRunArchive } from "../../workflow-run/archive.js";
import {
  acceptWorkflowRunIntake,
  AmbiguousWorkflowRunIntakeError,
  InvalidWorkflowRunIntakeError,
  type AcceptWorkflowRunIntakeInput,
  type WorkflowRunIntakeOutput,
} from "../../workflow-run/intake-core.js";
import { listWorkflowRunAttempts } from "../../workflow-run/run-attempt-projection.js";
import type { HttpRouteDeps } from "../route-types.js";
import { methodNotAllowed } from "../route-helpers.js";
import { createWorkflowRunSchema } from "../request-schemas.js";

export function registerWorkflowRunRoutes(app: Express, deps: HttpRouteDeps): void {
  app
    .route("/api/v1/workflow-runs")
    .get((req, res, next) => listWorkflowRunsHandler(req, res, next, deps))
    .post((req, res, next) => createWorkflowRunHandler(req, res, next, deps))
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

type IntakeResult =
  | { readonly ok: true; readonly intake: WorkflowRunIntakeOutput }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Runs acceptWorkflowRunIntake and converts intake-rule errors into a typed failure result. */
async function acceptIntakeOrError(input: AcceptWorkflowRunIntakeInput): Promise<IntakeResult> {
  try {
    return { ok: true, intake: await acceptWorkflowRunIntake(input) };
  } catch (error) {
    if (error instanceof AmbiguousWorkflowRunIntakeError) {
      return { ok: false, code: "ambiguous_intake", message: error.message };
    }
    if (error instanceof InvalidWorkflowRunIntakeError) {
      return { ok: false, code: "invalid_intake", message: error.message };
    }
    throw error;
  }
}

async function createWorkflowRunHandler(
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

    const parsed = createWorkflowRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "validation_error", message: "Invalid Workflow Run creation request" } });
      return;
    }

    const rules = deps.intakeRules ?? deps.configStore?.getConfig().intakeRules ?? [];
    const externalObject =
      parsed.data.externalId && parsed.data.externalProvider
        ? { provider: parsed.data.externalProvider, id: parsed.data.externalId, url: null }
        : null;
    const result = await acceptIntakeOrError({
      archiveDir: deps.archiveDir,
      source: "api",
      mode: parsed.data.mode ?? "start",
      title: parsed.data.title,
      body: parsed.data.intent,
      externalObject,
      labels: parsed.data.labels,
      rules,
      ...(parsed.data.workflowDefinitionId ? { workflowDefinitionId: parsed.data.workflowDefinitionId } : {}),
      workspaceKey: parsed.data.workspaceKey ?? "default",
    });
    if (!result.ok) {
      res.status(400).json({ error: { code: result.code, message: result.message } });
      return;
    }
    const { intake } = result;
    deps.eventBus?.emit("workflow_run.accepted", {
      workflowRunId: intake.workflowRun.id,
      source: intake.workflowRun.source,
      title: intake.workflowRun.title,
      workflowDefinitionId: intake.workflowRun.workflowDefinitionId,
    });
    const status = intake.action === "retried" ? 200 : 201;
    res
      .status(status)
      .json({ ...toStartedOutput(intake.workflowRun), action: intake.action, runAttempt: intake.runAttempt });
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
