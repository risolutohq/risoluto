import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of two strings by their byte representation.
 * Comparing byte lengths (not UTF-16 code-unit lengths) keeps timingSafeEqual
 * from throwing on a multi-byte input that happens to share `.length` with the
 * expected value. Shared by bearer-token and webhook-signature checks.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.byteLength !== bBuf.byteLength) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function tokensMatch(supplied: string | null | undefined, expected: string): boolean {
  if (!supplied) {
    return false;
  }
  return timingSafeStringEqual(supplied, expected);
}

export function includesMatchingToken(supplied: string | null | undefined, expectedTokens: readonly string[]): boolean {
  if (!supplied) {
    return false;
  }

  return expectedTokens.some((token) => tokensMatch(supplied, token));
}
