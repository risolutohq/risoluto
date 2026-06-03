import { describe, expect, it } from "vitest";

import { isBlockedRequestHost, isLoopbackHost, isSafeOutboundHttpsUrl } from "../../src/utils/url-safety.js";

describe("isBlockedRequestHost", () => {
  it.each([
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "::1",
    "fe80::1",
    "fc00::1",
  ])("blocks %s", (host) => {
    expect(isBlockedRequestHost(host)).toBe(true);
  });

  it.each(["api.github.com", "github.enterprise.test", "8.8.8.8", "172.32.0.1", "example.com"])("allows %s", (host) => {
    expect(isBlockedRequestHost(host)).toBe(false);
  });
});

describe("isSafeOutboundHttpsUrl", () => {
  it("accepts a public https url", () => {
    expect(isSafeOutboundHttpsUrl("https://api.openai.com/v1")).toBe(true);
  });

  it("rejects http", () => {
    expect(isSafeOutboundHttpsUrl("http://api.openai.com/v1")).toBe(false);
  });

  it("rejects a private host", () => {
    expect(isSafeOutboundHttpsUrl("https://127.0.0.1/v1")).toBe(false);
  });

  it("rejects an unparseable url", () => {
    expect(isSafeOutboundHttpsUrl("not a url")).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it.each(["localhost", "app.localhost", "127.0.0.1", "127.5.6.7", "::1"])("treats %s as loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["10.0.0.1", "169.254.169.254", "api.openai.com", "example.com"])("treats %s as non-loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
