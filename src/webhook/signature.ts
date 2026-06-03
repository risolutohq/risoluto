import { createHash, createHmac } from "node:crypto";

import { timingSafeStringEqual } from "../http/token-compare.js";

/**
 * SHA-256 digest of the verified raw body + signature. Webhook replay protection dedupes on this
 * rather than a spoofable provider delivery id, so a captured signed body replayed under a fresh
 * delivery id is still recognized as a duplicate (NIN-262/263).
 */
export function computeWebhookBodyDigest(rawBody: Buffer | string, signature: string): string {
  return createHash("sha256").update(rawBody).update("\n").update(signature).digest("hex");
}

export function verifyLinearSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeStringEqual(expected, signature);
}

export function verifyGitHubSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const normalized = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeStringEqual(expected, normalized);
}

export function verifySlackSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
  timestampEpochSeconds: number,
): boolean {
  const normalized = signatureHeader.startsWith("v0=") ? signatureHeader.slice(3) : signatureHeader;
  const base = `v0:${timestampEpochSeconds}:${rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", secret).update(base).digest("hex");
  return timingSafeStringEqual(expected, normalized);
}
