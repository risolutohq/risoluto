const REDACT_KEYS = /secret|token|key|password|credential|authorization|auth|webhook/i;
// Keys whose value is a scheme + credential segment (e.g. `Authorization: Basic <b64>`)
// must consume the whole segment, not stop at the first whitespace after the scheme.
const FULL_SEGMENT_KEYS = /authorization|password/i;

function redaction(): string {
  return "[REDACTED]";
}

function redactedObject(): string {
  return "[REDACTED_OBJECT]";
}
function redactSecretPatterns(text: string): string {
  let processed = redactBearerTokens(text);
  processed = redactLinearApiTokens(processed);
  processed = redactSkTokens(processed);
  processed = redactSlackTokens(processed);
  processed = redactAwsAccessKeys(processed);
  processed = redactGitHubTokens(processed);
  processed = redactCredentialUrls(processed);
  return redactGenericSecretAssignments(processed);
}

function isBearerTokenChar(char: string | undefined): boolean {
  return char !== undefined && /[\w.~+/-]/.test(char);
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /\w/.test(char);
}

function redactLinearApiTokens(text: string): string {
  let index = 0;
  let redacted = "";

  while (index < text.length) {
    if (!text.startsWith("lin_api_", index)) {
      redacted += text[index];
      index += 1;
      continue;
    }

    const tokenStart = index + "lin_api_".length;
    if (!isWordChar(text[tokenStart])) {
      redacted += text[index];
      index += 1;
      continue;
    }

    let tokenEnd = tokenStart;
    while (isWordChar(text[tokenEnd])) {
      tokenEnd += 1;
    }

    redacted += redaction();
    index = tokenEnd;
  }

  return redacted;
}

function redactSkTokens(text: string): string {
  let index = 0;
  let redacted = "";

  while (index < text.length) {
    if (!text.startsWith("sk-", index)) {
      redacted += text[index];
      index += 1;
      continue;
    }

    const tokenStart = index + "sk-".length;
    let tokenEnd = tokenStart;
    while (isWordChar(text[tokenEnd])) {
      tokenEnd += 1;
    }
    if (tokenEnd - tokenStart < 20) {
      redacted += text[index];
      index += 1;
      continue;
    }

    redacted += redaction();
    index = tokenEnd;
  }

  return redacted;
}

function isSlackTokenChar(char: string | undefined): boolean {
  return char !== undefined && /[0-9A-Za-z-]/.test(char);
}

function redactSlackTokens(text: string): string {
  let index = 0;
  let redacted = "";

  while (index < text.length) {
    const tokenType = text[index + 3];
    if (!text.startsWith("xox", index) || !"baprs".includes(tokenType) || text[index + 4] !== "-") {
      redacted += text[index];
      index += 1;
      continue;
    }

    const tokenStart = index + "xoxb-".length;
    if (!isSlackTokenChar(text[tokenStart])) {
      redacted += text[index];
      index += 1;
      continue;
    }

    let tokenEnd = tokenStart;
    while (isSlackTokenChar(text[tokenEnd])) {
      tokenEnd += 1;
    }

    redacted += redaction();
    index = tokenEnd;
  }

  return redacted;
}

function isAwsAccessKeyChar(char: string | undefined): boolean {
  return char !== undefined && /[0-9A-Z]/.test(char);
}

function redactAwsAccessKeys(text: string): string {
  let index = 0;
  let redacted = "";

  while (index < text.length) {
    if (!text.startsWith("AKIA", index)) {
      redacted += text[index];
      index += 1;
      continue;
    }

    let tokenEnd = index + "AKIA".length;
    let hasFullKey = true;
    for (let offset = 0; offset < 16; offset += 1) {
      if (!isAwsAccessKeyChar(text[tokenEnd])) {
        hasFullKey = false;
        break;
      }
      tokenEnd += 1;
    }
    if (!hasFullKey) {
      redacted += text[index];
      index += 1;
      continue;
    }

    redacted += redaction();
    index = tokenEnd;
  }

  return redacted;
}

// GitHub token prefixes: classic PAT (ghp_), app/server (ghs_), OAuth (gho_),
// user-to-server (ghu_), refresh (ghr_), and fine-grained PAT (github_pat_).
// Each is followed by word chars (incl. underscores in fine-grained tokens);
// 20 is the minimum body length that distinguishes a real token from a prefix
// appearing in prose.
const GITHUB_TOKEN_PREFIXES = ["github_pat_", "ghp_", "ghs_", "gho_", "ghu_", "ghr_"] as const;
// Classic GitHub tokens carry a 36-char body; fine-grained PATs carry far more.
// Requiring >=36 avoids redacting a bare prefix that appears in prose.
const GITHUB_TOKEN_MIN_BODY = 36;

function redactGitHubTokens(text: string): string {
  let index = 0;
  let redacted = "";

  while (index < text.length) {
    // Every GitHub token prefix starts with "g"; skip the multi-prefix scan
    // for the overwhelmingly common non-matching character.
    const prefix =
      text[index] === "g" ? GITHUB_TOKEN_PREFIXES.find((candidate) => text.startsWith(candidate, index)) : undefined;
    if (prefix === undefined) {
      redacted += text[index];
      index += 1;
      continue;
    }

    const bodyStart = index + prefix.length;
    let tokenEnd = bodyStart;
    while (isWordChar(text[tokenEnd])) {
      tokenEnd += 1;
    }
    if (tokenEnd - bodyStart < GITHUB_TOKEN_MIN_BODY) {
      redacted += text[index];
      index += 1;
      continue;
    }

    redacted += redaction();
    index = tokenEnd;
  }

  return redacted;
}

function isCredentialUsernameChar(char: string | undefined): boolean {
  return char !== undefined && !/[/\s:@]/.test(char);
}

function isCredentialPasswordChar(char: string | undefined): boolean {
  return char !== undefined && !/[/\s@]/.test(char);
}

function redactCredentialUrls(text: string): string {
  let index = 0;
  let redacted = "";

  while (index < text.length) {
    const schemeEnd = text.startsWith("https://", index)
      ? index + "https://".length
      : text.startsWith("http://", index)
        ? index + "http://".length
        : -1;

    let separatorIndex = schemeEnd;
    while (isCredentialUsernameChar(text[separatorIndex])) {
      separatorIndex += 1;
    }
    if (separatorIndex === schemeEnd || text[separatorIndex] !== ":") {
      redacted += text[index];
      index += 1;
      continue;
    }

    const passwordStart = separatorIndex + 1;
    let atIndex = passwordStart;
    while (isCredentialPasswordChar(text[atIndex])) {
      atIndex += 1;
    }
    if (atIndex === passwordStart || text[atIndex] !== "@") {
      redacted += text[index];
      index += 1;
      continue;
    }

    redacted += text.slice(index, schemeEnd) + `${redaction()}@`;
    index = atIndex + 1;
  }

  return redacted;
}

function redactBearerTokens(text: string): string {
  const lowerText = text.toLowerCase();
  let index = 0;
  let redacted = "";

  while (index < text.length) {
    if (!lowerText.startsWith("bearer", index)) {
      redacted += text[index];
      index += 1;
      continue;
    }

    let tokenStart = index + "bearer".length;
    let sawWhitespace = false;
    while (isAssignmentWhitespace(text[tokenStart])) {
      tokenStart += 1;
      sawWhitespace = true;
    }
    if (!sawWhitespace) {
      redacted += text[index];
      index += 1;
      continue;
    }

    let tokenEnd = tokenStart;
    while (isBearerTokenChar(text[tokenEnd])) {
      tokenEnd += 1;
    }
    const token = lowerText.slice(tokenStart, tokenEnd);
    if (token === "null" || token === "undefined") {
      redacted += text[index];
      index += 1;
      continue;
    }
    while (text[tokenEnd] === "=") {
      tokenEnd += 1;
    }
    if (tokenEnd === tokenStart) {
      redacted += text[index];
      index += 1;
      continue;
    }

    redacted += redaction();
    index = tokenEnd;
  }

  return redacted;
}

function isAssignmentWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isGenericAssignmentTerminator(char: string | undefined): boolean {
  switch (char) {
    case undefined:
    case '"':
    case "'":
    case ",":
    case "}":
      return true;
    default:
      return isAssignmentWhitespace(char);
  }
}

// A full-segment value (e.g. an Authorization credential) may contain spaces, so it
// runs to a line break or a structural delimiter rather than the first whitespace.
function isSegmentTerminator(char: string | undefined): boolean {
  switch (char) {
    case undefined:
    case "\n":
    case "\r":
    case ",":
    case "}":
    case '"':
    case "'":
      return true;
    default:
      return false;
  }
}

// Assignment keys are identifiers: letters, digits, underscores and hyphens
// (covers `api_key`, `api-key`, `SLACK_SIGNING_SECRET`, `Proxy-Authorization`, …).
function isAssignmentKeyChar(char: string | undefined): boolean {
  return char !== undefined && /[\w-]/.test(char);
}

function findValueEnd(text: string, valueStart: number, quoteChar: string | undefined, fullSegment: boolean): number {
  let valueEnd = valueStart;
  if (quoteChar !== undefined) {
    while (text[valueEnd] !== undefined && text[valueEnd] !== quoteChar) {
      valueEnd += 1;
    }
  } else if (fullSegment) {
    while (!isSegmentTerminator(text[valueEnd])) {
      valueEnd += 1;
    }
  } else {
    while (!isGenericAssignmentTerminator(text[valueEnd])) {
      valueEnd += 1;
    }
  }
  return valueEnd;
}

function redactGenericSecretAssignments(text: string): string {
  let index = 0;
  let redacted = "";

  while (index < text.length) {
    // Only attempt a key match at an identifier boundary so mid-word matches don't
    // create spurious assignments.
    const atBoundary = !isAssignmentKeyChar(text[index - 1]);
    if (!atBoundary || !isAssignmentKeyChar(text[index])) {
      redacted += text[index];
      index += 1;
      continue;
    }

    let keyEnd = index;
    while (isAssignmentKeyChar(text[keyEnd])) {
      keyEnd += 1;
    }
    const key = text.slice(index, keyEnd);
    const separator = text[keyEnd];
    if ((separator !== ":" && separator !== "=") || !REDACT_KEYS.test(key)) {
      redacted += text.slice(index, keyEnd);
      index = keyEnd;
      continue;
    }

    let valueStart = keyEnd + 1;
    while (isAssignmentWhitespace(text[valueStart])) {
      valueStart += 1;
    }
    let quoteChar: string | undefined;
    if (text[valueStart] === '"' || text[valueStart] === "'") {
      quoteChar = text[valueStart];
      valueStart += 1;
    }

    const valueEnd = findValueEnd(text, valueStart, quoteChar, FULL_SEGMENT_KEYS.test(key));
    if (valueEnd === valueStart) {
      redacted += text.slice(index, keyEnd);
      index = keyEnd;
      continue;
    }

    redacted += text.slice(index, valueStart) + redaction();
    index = valueEnd;
  }

  return redacted;
}

// Non-plain container types (Map/Set/Headers/URLSearchParams/Error) survive a
// structuredClone but expose nothing through Object.entries, so the normal payload
// walk would leave any embedded secret intact. Normalize them to plain
// objects/arrays here so the standard redaction pass can reach the values.
function toPlainContainer(value: object): { handled: boolean; value?: unknown } {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [key, nested] of value.entries()) {
      obj[String(key)] = nested;
    }
    return { handled: true, value: obj };
  }
  if (value instanceof Set) {
    return { handled: true, value: Array.from(value.values()) };
  }
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    const obj: Record<string, unknown> = {};
    for (const [key, nested] of value.entries()) {
      obj[key] = nested;
    }
    return { handled: true, value: obj };
  }
  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) {
    const obj: Record<string, unknown> = {};
    for (const [key, nested] of value.entries()) {
      obj[key] = nested;
    }
    return { handled: true, value: obj };
  }
  if (value instanceof Error) {
    return {
      handled: true,
      value: { name: value.name, message: value.message, stack: value.stack },
    };
  }
  return { handled: false };
}

function cloneValueFallback(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValueFallback(entry, seen));
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "bigint":
    case "symbol":
      return String(value);
    case "function":
    case "undefined":
      return redactedObject();
    case "object":
      if (value === null) {
        return value;
      }
      break;
    default:
      return String(value);
  }
  if (seen.has(value)) {
    return redactedObject();
  }

  seen.add(value);
  const cloned: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    cloned[key] = cloneValueFallback(nestedValue, seen);
  }
  seen.delete(value);
  return cloned;
}

function cloneObjectForRedaction(value: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(value) as Record<string, unknown>;
  } catch {
    return cloneValueFallback(value) as Record<string, unknown>;
  }
}

function cloneAndRedactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecretPatterns(value);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const container = toPlainContainer(value);
  if (container.handled) {
    return cloneAndRedactValue(container.value);
  }

  const cloned = cloneObjectForRedaction(value as Record<string, unknown>);
  redactObjectPayload(cloned);
  return cloned;
}

export function redactSensitiveValue(value: unknown): unknown {
  return cloneAndRedactValue(value);
}

export function sanitizeContent(
  text: string | null | undefined,
  options?: { isDiff?: boolean; maxLength?: number },
): string | null {
  if (text === null || text === undefined) {
    return null;
  }

  const maxLength = options?.maxLength ?? (options?.isDiff ? 500 : 2000);
  const processed = maybeRedactStructuredJson(redactSecretPatterns(text));
  return truncateSanitizedContent(processed, maxLength, options?.isDiff === true);
}

function maybeRedactStructuredJson(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(redactSensitiveValue(parsed), null, 2);
  } catch {
    /* not valid JSON — return as-is */
  }
  return text;
}

function truncateSanitizedContent(text: string, maxLength: number, isDiff: boolean): string {
  if (text.length <= maxLength) {
    return text;
  }

  const hint = isDiff ? "diff truncated" : "truncated";
  return text.slice(0, maxLength) + `\n…[${hint}, ${text.length - maxLength} more chars]`;
}

function redactArrayItems(arr: unknown[]): void {
  arr.forEach((current, i) => {
    if (typeof current === "object" && current !== null) {
      const container = toPlainContainer(current);
      if (container.handled) {
        arr[i] = redactSensitiveValue(container.value);
      } else {
        redactObjectPayload(current as Record<string, unknown> | unknown[]);
      }
    } else if (typeof current === "string") {
      arr[i] = redactSecretPatterns(current);
    }
  });
}

function redactMatchingKeyValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    obj[key] = redaction();
  } else if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) {
      obj[key] = redactedObject();
    } else {
      for (const k of Object.keys(value as Record<string, unknown>)) {
        (value as Record<string, unknown>)[k] = redaction();
      }
    }
  } else {
    obj[key] = redactedObject();
  }
}

function redactObjectEntries(obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.test(key)) {
      redactMatchingKeyValue(obj, key, value);
    } else if (typeof value === "object" && value !== null) {
      const container = toPlainContainer(value);
      if (container.handled) {
        obj[key] = redactSensitiveValue(container.value);
      } else {
        redactObjectPayload(value as Record<string, unknown> | unknown[]);
      }
    } else if (typeof value === "string") {
      obj[key] = redactSecretPatterns(value);
    }
  }
}

function redactObjectPayload(obj: Record<string, unknown> | unknown[]): void {
  if (Array.isArray(obj)) {
    redactArrayItems(obj);
    return;
  }
  redactObjectEntries(obj);
}
