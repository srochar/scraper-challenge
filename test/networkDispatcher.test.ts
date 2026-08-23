import { describe, expect, it } from "vitest";
import { NetworkDispatcher } from "../src/network/dispatcher";

describe("network dispatcher", () => {
  it("serializes operations per session lane", async () => {
    const dispatcher = new NetworkDispatcher({
      requestsPerSecond: 100,
      cooldownMs: 100,
      cooldownWindowMs: 1000,
      cooldownThreshold: 3,
      jitterRatio: 0,
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const start: string[] = [];

    const p1 = dispatcher.run("s1", "a", async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      start.push("a");
      await wait(20);
      inFlight -= 1;
      return "a";
    });
    const p2 = dispatcher.run("s1", "b", async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      start.push("b");
      await wait(5);
      inFlight -= 1;
      return "b";
    });

    const out = await Promise.all([p1, p2]);
    expect(out).toEqual(["a", "b"]);
    expect(start).toEqual(["a", "b"]);
    expect(maxInFlight).toBe(1);
  });

  it("keeps global request spacing", async () => {
    const dispatcher = new NetworkDispatcher({
      requestsPerSecond: 2,
      cooldownMs: 100,
      cooldownWindowMs: 1000,
      cooldownThreshold: 3,
      jitterRatio: 0,
    });

    const times: number[] = [];
    await Promise.all([
      dispatcher.run("a", "x", async () => {
        times.push(Date.now());
      }),
      dispatcher.run("b", "y", async () => {
        times.push(Date.now());
      }),
    ]);

    const sorted = [...times].sort((x, y) => x - y);
    expect(sorted.length).toBe(2);
    expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(450);
  });

  it("applies cooldown after repeated 429", async () => {
    const dispatcher = new NetworkDispatcher({
      requestsPerSecond: 100,
      cooldownMs: 120,
      cooldownWindowMs: 5000,
      cooldownThreshold: 2,
      jitterRatio: 0,
    });

    const err = () => {
      const e = new Error("HTTP_429") as Error & { status?: number };
      e.status = 429;
      return e;
    };

    await expect(dispatcher.run("s", "r1", async () => Promise.reject(err()))).rejects.toThrow();
    await expect(dispatcher.run("s", "r2", async () => Promise.reject(err()))).rejects.toThrow();

    const start = Date.now();
    await dispatcher.run("s", "ok", async () => undefined);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
