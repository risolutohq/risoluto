import type { Request, Response, NextFunction } from "express";

import { getRequestId } from "../observability/tracing.js";
import { toErrorString } from "../utils/type-guards.js";

/**
 * Explicit service failure contracts for the HTTP API layer.
 *
 * This module defines the error handling boundary between service stores
 * (which throw) and the HTTP surface (which must return structured JSON errors).
 *
 * Failure modes (documented for API consumers):
 * - 400 `invalid_request_body` — body-parser rejected a malformed/oversized request body.
 * - 400 `service_validation_error` — service rejected input (TypeError from stores).
 * - 500 `service_error` — unexpected internal failure from a service store.
 */

/** Standard error response shape shared across all API routes. */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

interface BodyParserError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
}

/**
 * body-parser (`express.json`/`express.urlencoded`) rejects malformed or oversized
 * request bodies with an HTTP-shaped error carrying a `type` and a 4xx `status`. These
 * are client errors, so we echo the status (400 for a parse failure) instead of letting
 * them fall through to a misleading 500 (RIS-250).
 */
function bodyParserErrorStatus(error: Error): number | null {
  const candidate = error as BodyParserError;
  if (typeof candidate.type !== "string") {
    return null;
  }
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? status : null;
}

/**
 * Express error-handling middleware that catches service-layer exceptions
 * and returns structured JSON error responses.
 *
 * Mount after all route registration to act as the last-resort handler.
 */
export function serviceErrorHandler(error: Error, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const parseStatus = bodyParserErrorStatus(error);
  if (parseStatus !== null) {
    res.status(parseStatus).json({
      error: {
        code: "invalid_request_body",
        message: parseStatus === 413 ? "Request body exceeds the allowed size" : "Request body could not be parsed",
      },
    } satisfies ApiErrorResponse);
    return;
  }

  if (error instanceof TypeError) {
    res.status(400).json({
      error: {
        code: "service_validation_error",
        message: error.message,
      },
    } satisfies ApiErrorResponse);
    return;
  }

  req.app.emit("risoluto:server_error", {
    requestId: getRequestId(req),
    method: req.method,
    path: req.path,
    error: toErrorString(error),
  });

  res.status(500).json({
    error: {
      code: "service_error",
      message: "Internal server error",
    },
  } satisfies ApiErrorResponse);
}
