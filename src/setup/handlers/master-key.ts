import type { Request, Response } from "express";

import { isRecord, toErrorString } from "../../utils/type-guards.js";
import { SetupServiceError, resolveSetupService, type SetupService } from "../setup-service.js";
import type { SetupApiDeps } from "../port.js";

export function handlePostMasterKey(deps: SetupApiDeps | SetupService) {
  const service = resolveSetupService(deps);
  return async (req: Request, res: Response) => {
    const body = req.body;
    const providedKey = isRecord(body) && typeof body.key === "string" && body.key ? body.key : null;

    try {
      // The key is persisted to archiveDir/master.key (mode 0600) inside the service;
      // the HTTP response must never echo the key material back (NIN-249).
      await service.createMasterKey(providedKey);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof SetupServiceError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      res.status(500).json({ error: { code: "setup_error", message: toErrorString(error) } });
    }
  };
}
