import { createHmac } from "node:crypto";

import { timingSafeStringEqual } from "../http/token-compare.js";

export function verifyLinearSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeStringEqual(expected, signature);
}

export function verifyGitHubSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const normalized = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeStringEqual(expected, normalized);
}
