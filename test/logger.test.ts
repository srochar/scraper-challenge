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

  it("includes non-core metadata in pretty format", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logger = createLogger({ level: "debug", service: "test", format: "pretty", context: { bot: "familia", busqueda: "familia" } });

    logger.debug("Processing record", {
      recordIndex: 2,
      recordTotal: 10,
      recordId: "abc123",
      title: "Apelacion 034983-2024",
      item: { id: "abc123", sourcePage: 2 },
    });

    const payload = String(writeSpy.mock.calls[0][0]);
    expect(payload).toContain("accion=Processing record");
    expect(payload).toContain("recordIndex=2");
    expect(payload).toContain("recordTotal=10");
    expect(payload).toContain("recordId=abc123");
    expect(payload).toContain("title=\"Apelacion 034983-2024\"");
    expect(payload).toContain("item={\"id\":\"abc123\",\"sourcePage\":2}");
  });

  it("recovers from ENOENT when persisting logs", async () => {
    const appendFile = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      .mockResolvedValue(undefined);
    const mkdir = vi.fn().mockResolvedValue(undefined);

    const logger = createLogger({
      level: "info",
      service: "test",
      format: "json",
      logFilePath: "runs/civil/run-1/logs.jsonl",
      persistence: {
        appendFile,
        mkdir,
      },
    });

    logger.info("hello");

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(appendFile).toHaveBeenCalledTimes(2);
    expect(mkdir).toHaveBeenCalledTimes(1);
  });
});
