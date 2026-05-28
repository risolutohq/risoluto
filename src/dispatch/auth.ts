import type { RequestHandler } from "express";

import { tokensMatch } from "../http/token-compare.js";

/**
 * Bearer token authentication middleware for the data plane.
 * Validates that incoming requests have the correct Authorization header,
 * using a constant-time comparison to avoid leaking the secret via timing.
 */
export function bearerAuth(secret: string): RequestHandler {
  return (req, res, next) => {
    const auth = req.headers.authorization;
    if (!tokensMatch(auth, `Bearer ${secret}`)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
