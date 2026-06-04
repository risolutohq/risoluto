import { describe, expect, it, vi, afterEach } from "vitest";
import { MAX_RETRY_DELAY_MS, withNonFatalRetry, withRetry, withRetryReturn } from "../../src/utils/retry.js";
import type { RisolutoLogger } from "../../src/core/types.js";

function createLogger(): RisolutoLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RisolutoLogger;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withRetry", () => {
  it("calls fn once when it succeeds immediately", async () => {
    const logger = createLogger();
    const fn = vi.fn(async () => {});

    await withRetry(logger, "op", fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("retries on failure and succeeds on second attempt", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
    });

    const promise = withRetry(logger, "op", fn);
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();

    expect(fn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0][1]).toBe("write-back retry");
  });

  it("re-throws the last error after max attempts (NIN-236)", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });

    const promise = withRetry(logger, "op", fn, { maxAttempts: 3 });
    const caught = promise.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const caughtError = await caught;
    vi.useRealTimers();

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects custom maxAttempts", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const fn = vi.fn(async () => {
      throw new Error("fail");
    });

    const promise = withRetry(logger, "op", fn, { maxAttempts: 2 });
    const caught = promise.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    await caught;
    vi.useRealTimers();

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects without invoking fn when maxAttempts is %s (NIN-236)",
    async (maxAttempts) => {
      const logger = createLogger();
      const fn = vi.fn(async () => {});

      await expect(withRetry(logger, "op", fn, { maxAttempts })).rejects.toThrow(TypeError);
      expect(fn).not.toHaveBeenCalled();
    },
  );

  it("caps the backoff delay at MAX_RETRY_DELAY_MS (NIN-236)", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fn = vi.fn(async () => {
      throw new Error("fail");
    });

    const promise = withRetry(logger, "op", fn, { maxAttempts: 40 });
    const caught = promise.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    await caught;
    vi.useRealTimers();

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
    expect(delays.length).toBeGreaterThan(0);
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS);
    }
    // A late attempt must have been clamped to the cap (jitter keeps it in [0.5x, 1x]).
    expect(Math.max(...delays)).toBeGreaterThanOrEqual(MAX_RETRY_DELAY_MS / 2);
  });
});

describe("withNonFatalRetry", () => {
  it("swallows error after max attempts and logs non-fatal (NIN-236)", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });

    const promise = withNonFatalRetry(logger, "op", fn, { maxAttempts: 3 });
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();

    expect(fn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    const lastCall = vi.mocked(logger.warn).mock.calls.at(-1);
    expect(lastCall?.[1]).toContain("non-fatal");
  });

  it("validates maxAttempts before invoking fn (NIN-236)", async () => {
    const logger = createLogger();
    const fn = vi.fn(async () => {});

    await expect(withNonFatalRetry(logger, "op", fn, { maxAttempts: 0 })).rejects.toThrow(TypeError);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("withRetryReturn", () => {
  it("returns the value when fn succeeds immediately", async () => {
    const logger = createLogger();
    const fn = vi.fn(async () => 42);

    const result = await withRetryReturn(logger, "op", fn);

    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("retries on failure and returns value on second attempt", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
      return "ok";
    });

    const promise = withRetryReturn(logger, "op", fn);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-throws after max attempts", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const fn = vi.fn(async () => {
      throw new Error("permanent failure");
    });

    const promise = withRetryReturn(logger, "op", fn, { maxAttempts: 3 });
    // Attach a catch handler immediately to prevent unhandled rejection warnings
    const caught = promise.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const caughtError = await caught;
    vi.useRealTimers();

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe("permanent failure");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects custom maxAttempts", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const fn = vi.fn(async () => {
      throw new Error("fail");
    });

    const promise = withRetryReturn(logger, "op", fn, { maxAttempts: 2 });
    const caught = promise.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const caughtError = await caught;
    vi.useRealTimers();

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe("fail");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
