import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildConfig } from "../src/index";

describe("index config", () => {
  it("creates run-scoped defaults with bot and generated runId", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-index-"));
    const argv = ["node", "script", "--bot", "civil", "--runs-dir", temp, "--search", "civil"];

    const config = await buildConfig(argv);

    expect(config.bot).toBe("civil");
    expect(config.runId.length).toBeGreaterThan(10);
    expect(config.dataDir).toContain(join(temp, "civil", config.runId));
    expect(config.outputDir).toContain(join(temp, "civil", config.runId, "artifacts", "pdfs"));
    expect(config.resultsDir).toContain(join(temp, "civil", config.runId, "results"));
    expect(config.resultFormat).toBe("json");
    expect(config.logFilePath).toContain(join(temp, "civil", config.runId, "logs.jsonl"));
  });

  it("reuses latest run for failed-only mode", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-index-latest-"));
    await buildConfig(["node", "script", "--bot", "familia", "--runs-dir", temp, "--search", "familia"]);

    const config = await buildConfig(["node", "script", "--bot", "familia", "--runs-dir", temp, "--failed-only"]);
    expect(config.failedOnly).toBe(true);
    expect(config.dataDir).toContain(join(temp, "familia", config.runId));
  });

  it("throws on resume without prior latest and without explicit run id", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-index-resume-"));
    await expect(buildConfig(["node", "script", "--bot", "robo", "--runs-dir", temp, "--resume"]))
      .rejects
      .toThrow(/No latest run found/);
  });
});
