import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildConfig, isSummarySuccessful, writeGlobalConsolidatedResults } from "../src/index";

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
    expect(config.resultFormat).toBe("csv");
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

  it("treats summaries with failed downloads as unsuccessful", () => {
    expect(isSummarySuccessful({ processed: 2, downloaded: 0, missingLink: 0, failed: 2, bulkZipDownloaded: 0 })).toBe(false);
    expect(isSummarySuccessful({ processed: 2, downloaded: 2, missingLink: 0, failed: 0, bulkZipDownloaded: 0 })).toBe(true);
    expect(isSummarySuccessful({ processed: 0, downloaded: 0, missingLink: 0, failed: 0, bulkZipDownloaded: 0 })).toBe(false);
  });

  it("writes global consolidated csv for multi-bot result sources", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-index-global-csv-"));
    const runA = join(temp, "civil", "run-a", "results");
    const runB = join(temp, "familia", "run-b", "results");
    mkdirSync(runA, { recursive: true });
    mkdirSync(runB, { recursive: true });

    writeFileSync(join(runA, "records.csv"), "bot,runId,id,title,sourcePage\ncivil,run-a,1,Alpha,1\n", "utf8");
    writeFileSync(join(runB, "records.csv"), "bot,runId,id,title,sourcePage\nfamilia,run-b,2,Beta,1\n", "utf8");

    const output = await writeGlobalConsolidatedResults(temp, [
      { path: join(runA, "records.csv"), bot: "civil", runId: "run-a" },
      { path: join(runB, "records.csv"), bot: "familia", runId: "run-b" },
    ]);

    expect(output).toBe(join(temp, "result-global.csv"));
    const raw = readFileSync(join(temp, "result-global.csv"), "utf8");
    expect(raw).toContain("civil,run-a,1,Alpha,1");
    expect(raw).toContain("familia,run-b,2,Beta,1");
  });

  it("writes ordered global consolidated json and preserves provenance fields", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-index-global-json-"));
    const runA = join(temp, "civil", "run-a", "results");
    const runB = join(temp, "familia", "run-b", "results");
    mkdirSync(runA, { recursive: true });
    mkdirSync(runB, { recursive: true });
    writeFileSync(
      join(runA, "records.json"),
      JSON.stringify([
        { id: "2", title: "Zulu", sourcePage: 1, metadata: {}, downloadStatus: "downloaded", downloadAttempts: 1 },
        { id: "1", title: "Alpha", sourcePage: 1, metadata: {}, downloadStatus: "downloaded", downloadAttempts: 1 },
      ]),
      "utf8",
    );
    writeFileSync(
      join(runB, "records.json"),
      JSON.stringify([
        { bot: "familia", runId: "run-b", id: "3", title: "Beta", sourcePage: 1, metadata: {}, downloadStatus: "downloaded", downloadAttempts: 1 },
      ]),
      "utf8",
    );

    const output = await writeGlobalConsolidatedResults(temp, [
      { path: join(runA, "records.json"), bot: "civil", runId: "run-a" },
      { path: join(runB, "records.json"), bot: "familia", runId: "run-b" },
    ]);

    expect(output).toBe(join(temp, "result-global.json"));
    const merged = JSON.parse(readFileSync(join(temp, "result-global.json"), "utf8")) as Array<{ bot: string; runId: string; title: string }>;
    expect(merged[0].bot).toBe("civil");
    expect(merged[0].runId).toBe("run-a");
    expect(merged[0].title).toBe("Alpha");
    expect(merged[1].title).toBe("Zulu");
    expect(merged[2].bot).toBe("familia");
    expect(merged[2].runId).toBe("run-b");
  });
});
