import { describe, expect, it } from "vitest";
import { computeBackoffDelay, executeWithRetry } from "../src/retryPolicy";

describe("retry policy", () => {
  it("computes increasing backoff with jitter", () => {
    const delay1 = computeBackoffDelay(
      1,
      { maxRetries: 3, initialDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 1000, jitterRatio: 0.5 },
      0.4,
    );
    const delay2 = computeBackoffDelay(
      2,
      { maxRetries: 3, initialDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 1000, jitterRatio: 0.5 },
      0.4,
    );
    expect(delay2).toBeGreaterThan(delay1);
  });

  it("succeeds after retries", async () => {
    let count = 0;
    const waits: number[] = [];
    const outcome = await executeWithRetry(
      async () => {
        count += 1;
        if (count < 3) {
          const error = new Error("HTTP_429") as Error & { status?: number };
          error.status = 429;
          throw error;
        }
        return "ok";
      },
      () => true,
      { maxRetries: 4, initialDelayMs: 10, backoffMultiplier: 2, maxDelayMs: 100, jitterRatio: 0 },
      {
        wait: async (ms) => {
          waits.push(ms);
        },
        random: () => 0,
      },
    );

    expect(outcome.success).toBe(true);
    expect(outcome.value).toBe("ok");
    expect(outcome.attempts).toBe(3);
    expect(waits).toEqual([10, 20]);
  });

  it("fails after max retries", async () => {
    const outcome = await executeWithRetry(
      async () => {
        const error = new Error("HTTP_429") as Error & { status?: number };
        error.status = 429;
        throw error;
      },
      () => true,
      { maxRetries: 2, initialDelayMs: 10, backoffMultiplier: 2, maxDelayMs: 100, jitterRatio: 0 },
      { wait: async () => undefined, random: () => 0 },
    );

    expect(outcome.success).toBe(false);
    expect(outcome.attempts).toBe(3);
  });
});
