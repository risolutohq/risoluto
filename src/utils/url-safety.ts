/**
 * SSRF guards for outbound URLs built from configuration (NIN-245).
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

/** True when an IPv6 literal is loopback, unique-local, or link-local. */
function isBlockedIpv6(host: string): boolean {
  if (!host.includes(":")) {
    return false;
  }
  return host === "::1" || host === "::" || host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd");
}

/** True when a hostname is a loopback, private, or link-local address/name. */
export function isBlockedRequestHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  return isBlockedIpv4(host) || isBlockedIpv6(host);
}

/** True when a hostname is a loopback address/name (the operator's own machine). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
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
