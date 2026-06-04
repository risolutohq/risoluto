import type { Request, Response, NextFunction } from "express";

import type { WriteAuditLog } from "./write-audit.js";
import { tokensMatch } from "./token-compare.js";

/**
 * Write-route authorization policy for privileged mutation endpoints.
 *
 * This middleware explicitly declares and enforces the write authorization
 * contract for all mutating API routes. Currently the policy verifies that
 * requests originate from a loopback address (127.0.0.1 / ::1 / ::ffff:127.0.0.1),
 * matching the default bind behavior in `server.ts`.
 *
 * When `RISOLUTO_BIND` is set to a non-loopback address, operators MUST also
 * set `RISOLUTO_WRITE_TOKEN` to require a bearer token on every mutating request.
 *
 * Failure modes:
 * - 403 `write_forbidden` — request came from a non-loopback address without a valid token.
 * - 401 `write_unauthorized` — `RISOLUTO_WRITE_TOKEN` is configured but the request
 *   did not supply a matching `Authorization: Bearer <token>` header.
 */

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function parseBearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }
  if (!authorization.startsWith("Bearer ")) {
    return undefined;
  }
  return authorization.slice("Bearer ".length).trim();
}

/**
 * Node may surface local clients as any address in 127.0.0.0/8, including
 * IPv6-mapped variants when the listener is dual-stack.
 */
export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return remoteAddress === "::1" || remoteAddress.startsWith("127.") || remoteAddress.startsWith("::ffff:127.");
}

/** Strip surrounding brackets / a trailing port so a forwarded address can be classified. */
function normalizeForwardedIp(value: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  // IPv4 with a port has a single colon; bare IPv6 has several and keeps them.
  return (trimmed.match(/:/g)?.length ?? 0) === 1 ? (trimmed.split(":")[0] ?? trimmed) : trimmed;
}

/** The originating client IP from a proxy hop, if any (`X-Forwarded-For` left-most, then `Forwarded`). */
function forwardedClientIp(req: Request): string | undefined {
  const xForwardedFor = req.get("x-forwarded-for");
  if (xForwardedFor?.trim()) {
    return normalizeForwardedIp(xForwardedFor.split(",")[0] ?? "");
  }
  const forwarded = req.get("forwarded");
  const match = forwarded ? /for=([^;,]+)/i.exec(forwarded) : null;
  return match ? normalizeForwardedIp(match[1] ?? "") : undefined;
}

/**
 * A bare loopback TCP peer is not proof of a local client: a reverse proxy or
 * tunnel terminates on loopback while forwarding a remote caller. When the TCP
 * peer is itself loopback (a trusted local proxy) we classify by the forwarded
 * client, so a proxied non-loopback request cannot ride the loopback write
 * bypass (RIS-250).
 *
 * A forwarding header is only trusted from a loopback peer. A non-loopback peer
 * can set `X-Forwarded-For: 127.0.0.1` itself, so trusting that header would let
 * a direct remote caller spoof loopback and bypass the write gate — we classify
 * such a peer by its socket address and ignore its forwarding header.
 */
export function isRequestFromLoopback(req: Request): boolean {
  // Only a loopback TCP peer may be a trusted local proxy whose forwarding header
  // we honor; a non-loopback peer's header is unauthenticated and must be ignored.
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    return false;
  }
  const forwarded = forwardedClientIp(req);
  if (forwarded !== undefined) {
    return isLoopbackAddress(forwarded);
  }
  return true;
}

export interface WriteGuardOptions {
  /** Optional audit log to record all mutating requests. */
  auditLog?: WriteAuditLog;
}

/**
 * Creates an Express middleware that guards mutating (non-GET/HEAD/OPTIONS)
 * requests behind explicit authorization checks and optionally records
 * audit entries for every mutation.
 */
export function createWriteGuard(
  options?: WriteGuardOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const writeToken = process.env.RISOLUTO_WRITE_TOKEN?.trim() || undefined;
  const auditLog = options?.auditLog;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (isSafeMethod(req.method)) {
      next();
      return;
    }

    /* Webhook routes handle their own authentication via HMAC signature
       verification — skip IP/token write protection entirely. */
    if (req.path.startsWith("/webhooks/")) {
      next();
      return;
    }

    const fromLoopback = isRequestFromLoopback(req);

    if (writeToken) {
      const suppliedToken = parseBearerToken(req.get("authorization"));

      if (!tokensMatch(suppliedToken, writeToken)) {
        res.status(401).json({
          error: {
            code: "write_unauthorized",
            message: "Mutating requests require a valid Authorization: Bearer <token> header",
          },
        });
        return;
      }

      attachAuditHook(req, res, auditLog);
      next();
      return;
    }

    if (!fromLoopback) {
      res.status(403).json({
        error: {
          code: "write_forbidden",
          message:
            "Mutating requests are only allowed from loopback addresses. " +
            "Set RISOLUTO_WRITE_TOKEN to allow remote write access.",
        },
      });
      return;
    }

    attachAuditHook(req, res, auditLog);
    next();
  };
}

function attachAuditHook(req: Request, res: Response, auditLog?: WriteAuditLog): void {
  if (!auditLog) return;

  res.once("finish", () => {
    auditLog
      .record({
        at: new Date().toISOString(),
        method: req.method,
        path: req.path,
        requestId: req.get("x-request-id"),
        remoteAddress: req.socket.remoteAddress,
        statusCode: res.statusCode,
      })
      .catch(() => {
        /* audit log write failures are non-fatal */
      });
  });
}
