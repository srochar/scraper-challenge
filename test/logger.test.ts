import { describe, expect, it, vi, afterEach } from "vitest";
import { createLogger } from "../src/logger";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits JSON line in json format", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logger = createLogger({ level: "info", service: "test", format: "json" });

    logger.info("hello", { module: "x" });

    const payload = String(writeSpy.mock.calls[0][0]);
    expect(payload).toContain('"level":"info"');
    expect(payload).toContain('"message":"hello"');
  });

  it("emits colored line in pretty format", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logger = createLogger({ level: "info", service: "test", format: "pretty" });

    logger.info("hello", { module: "x" });

    const payload = String(writeSpy.mock.calls[0][0]);
    expect(payload).toContain("\u001b[");
    expect(payload).toContain("INFO");
    expect(payload).toContain("test:");
  });
});
