import { describe, expect, it } from "vitest";
import { toFatalErrorPayload } from "../src/index";

describe("fatal error payload", () => {
  it("maps error and context into structured fatal output", () => {
    const payload = toFatalErrorPayload(new Error("boom"), "main", {
      runId: "run-1",
      bot: "civil",
    });

    expect(payload.type).toBe("fatal");
    expect(payload.stage).toBe("main");
    expect(payload.operation).toBe("main");
    expect(payload.errorName).toBe("Error");
    expect(payload.errorMessage).toBe("boom");
    expect(payload.runId).toBe("run-1");
    expect(payload.bot).toBe("civil");
  });
});
