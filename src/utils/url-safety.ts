/**
 * SSRF guards for outbound URLs built from configuration (RIS-245).
 *
 * Credentials must only be sent to a URL that uses https and does not target a
 * loopback, private, or link-local host — the usual SSRF pivots (cloud metadata
 * endpoints, internal services). Hostnames are classified by string form only;
 * DNS-rebinding defence (resolving the host) is intentionally out of scope here.
 */

/** True when an IPv4 literal is in a loopback, private, or link-local range. */
function isBlockedIpv4(host: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!ipv4) {
    return false;
  }
  const first = Number(ipv4[1]);
  const second = Number(ipv4[2]);
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 192 && second === 168) return true;
  return first === 172 && second >= 16 && second <= 31;
}

/**
 * Decode the IPv4 embedded in an IPv4-mapped (`::ffff:…`) or IPv4-compatible (`::…`)
 * IPv6 literal to dotted form, else null. Node's URL parser normalizes the embedded
 * octets to two hex groups (`::ffff:127.0.0.1` -> `::ffff:7f00:1`), so both the dotted
 * and the hex spelling must be recognized.
 */
function embeddedIpv4(host: string): string | null {
  const dotted = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/u.exec(host);
  if (dotted) {
    return dotted[1] ?? null;
  }
  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(host);
  if (hex) {
    const high = parseInt(hex[1] ?? "", 16);
    const low = parseInt(hex[2] ?? "", 16);
    return `${(high >>> 8) & 0xff}.${high & 0xff}.${(low >>> 8) & 0xff}.${low & 0xff}`;
  }
  return null;
}

/** True when an IPv6 literal is loopback, unique-local, link-local, or an embedded private IPv4. */
function isBlockedIpv6(host: string): boolean {
  if (!host.includes(":")) {
    return false;
  }
  // An IPv4-mapped/compatible IPv6 literal carries an IPv4 address; classify by that
  // address so a loopback/private/link-local IPv4 cannot slip the guard in IPv6 syntax
  // (e.g. ::ffff:127.0.0.1, or ::ffff:a9fe:a9fe for the cloud metadata endpoint).
  const embedded = embeddedIpv4(host);
  if (embedded !== null) {
    return isBlockedIpv4(embedded);
  }
  // Link-local is fe80::/10, so the first hextet spans fe80–febf (not just the fe80::/16 prefix);
  // /^fe[89ab][0-9a-f]:/ matches that whole range. fc/fd cover unique-local fc00::/7; ::1 is loopback
  // and :: is the unspecified address.
  return (
    host === "::1" ||
    host === "::" ||
    /^fe[89ab][0-9a-f]:/u.test(host) ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  );
}

/** Lowercase a hostname and strip the brackets URL parsing leaves on IPv6 literals. */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/gu, "");
}

/** True when a hostname is a loopback, private, or link-local address/name. */
export function isBlockedRequestHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  return isBlockedIpv4(host) || isBlockedIpv6(host);
}

/** True when a hostname is a loopback address/name (the operator's own machine). */
export function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  return ipv4 !== null && Number(ipv4[1]) === 127;
}

/** True when `url` parses, uses https, and its host is not loopback/private/link-local. */
export function isSafeOutboundHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && !isBlockedRequestHost(parsed.hostname);
}
