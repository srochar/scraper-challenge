import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseArgs, buildConfig, expandConfigBotJobs, loadRuntimeConfig } from "../src/index";
import { resolveBotConcurrency } from "../src/runtime/config";

describe("runtime config", () => {
  it("applies defaults from config file", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-"));
    const configPath = join(temp, "scraper.config.json");
    writeFileSync(configPath, JSON.stringify({
      defaults: {
        requestTimeoutMs: 45000,
        requestDelayMs: 1200,
        requestJitterMs: 900,
        downloadMode: "both",
        resultFormat: "csv",
        unzip: true,
        logFormat: "pretty",
        logLevel: "debug",
      },
    }), "utf8");

    const config = await buildConfig([
      "node",
      "script",
      "--config",
      configPath,
      "--runs-dir",
      temp,
      "--bot",
      "civil",
      "--search",
      "civil",
    ]);

    expect(config.requestDelayMs).toBe(1200);
    expect(config.requestJitterMs).toBe(900);
    expect(config.requestTimeoutMs).toBe(45000);
    expect(config.downloadMode).toBe("both");
    expect(config.resultFormat).toBe("csv");
    expect(config.unzip).toBe(true);
    expect(config.logFormat).toBe("pretty");
    expect(config.logLevel).toBe("debug");
  });

  it("throws with invalid config shape", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-invalid-"));
    const configPath = join(temp, "scraper.config.json");
    writeFileSync(configPath, JSON.stringify({ botJobs: "invalid" }), "utf8");

    await expect(buildConfig([
      "node",
      "script",
      "--config",
      configPath,
      "--runs-dir",
      temp,
      "--bot",
      "civil",
      "--search",
      "civil",
    ])).rejects.toThrow(/botJobs must be an array/);
  });

  it("fails fast on unsupported result format", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-format-"));
    await expect(buildConfig([
      "node",
      "script",
      "--runs-dir",
      temp,
      "--bot",
      "civil",
      "--search",
      "civil",
      "--result-format",
      "xml",
    ])).rejects.toThrow(/Unsupported result format/);
  });

  it("keeps CLI precedence over file defaults", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-cli-"));
    const configPath = join(temp, "scraper.config.json");
    writeFileSync(configPath, JSON.stringify({
      defaults: {
        requestTimeoutMs: 45000,
        requestDelayMs: 1200,
        downloadMode: "bulk",
        logFormat: "json",
      },
    }), "utf8");

    const config = await buildConfig([
      "node",
      "script",
      "--config",
      configPath,
      "--runs-dir",
      temp,
      "--bot",
      "civil",
      "--search",
      "civil",
      "--request-delay-ms",
      "25",
      "--download-mode",
      "individual",
      "--request-timeout-ms",
      "70000",
      "--unzip",
      "false",
      "--log-format",
      "pretty",
    ]);

    expect(config.requestDelayMs).toBe(25);
    expect(config.requestTimeoutMs).toBe(70000);
    expect(config.downloadMode).toBe("individual");
    expect(config.unzip).toBe(false);
    expect(config.logFormat).toBe("pretty");
  });

  it("parses --config in args map", () => {
    const args = parseArgs(["node", "script", "--config", "scraper.config.json"]);
    expect(args.get("config")).toBe("scraper.config.json");
  });

  it("expands botGroups into concrete jobs", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-groups-"));
    const configPath = join(temp, "scraper.config.json");
    writeFileSync(configPath, JSON.stringify({
      botGroups: [
        {
          bot: "civil",
          maxPages: 2,
          searchTerms: ["herencia", "derecho a vivienda"],
        },
        {
          bot: "familia",
          searchTerms: [
            { id: "familia-alimentos", term: "alimentos", maxPages: 4 },
          ],
        },
      ],
    }), "utf8");

    const loaded = await loadRuntimeConfig(configPath);
    const jobs = expandConfigBotJobs(loaded);
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({ id: "civil-1", bot: "civil", searchTerm: "herencia", maxPages: 2 });
    expect(jobs[1]).toMatchObject({ id: "civil-2", bot: "civil", searchTerm: "derecho a vivienda", maxPages: 2 });
    expect(jobs[2]).toMatchObject({ id: "familia-alimentos", bot: "familia", searchTerm: "alimentos", maxPages: 4 });
  });

  it("rejects botGroups with empty searchTerms", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-groups-invalid-"));
    const configPath = join(temp, "scraper.config.json");
    writeFileSync(configPath, JSON.stringify({
      botGroups: [
        {
          bot: "civil",
          searchTerms: [],
        },
      ],
    }), "utf8");

    await expect(loadRuntimeConfig(configPath)).rejects.toThrow(/searchTerms must be a non-empty array/);
  });

  it("rejects non-numeric defaults.botConcurrency", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-bot-concurrency-invalid-"));
    const configPath = join(temp, "scraper.config.json");
    writeFileSync(configPath, JSON.stringify({
      defaults: {
        botConcurrency: "fast",
      },
    }), "utf8");

    await expect(loadRuntimeConfig(configPath)).rejects.toThrow(/defaults\.botConcurrency must be a number/);
  });

  it("rejects non-numeric defaults.requestTimeoutMs", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-timeout-invalid-"));
    const configPath = join(temp, "scraper.config.json");
    writeFileSync(configPath, JSON.stringify({
      defaults: {
        requestTimeoutMs: "slow",
      },
    }), "utf8");

    await expect(loadRuntimeConfig(configPath)).rejects.toThrow(/defaults\.requestTimeoutMs must be a number/);
  });

  it("normalizes bot concurrency with configured upper bound", () => {
    const fromCli = resolveBotConcurrency(parseArgs(["node", "script", "--bot-concurrency", "9"]), {
      botConcurrency: 2,
    });
    expect(fromCli.requested).toBe(9);
    expect(fromCli.effective).toBe(4);

    const fromDefault = resolveBotConcurrency(parseArgs(["node", "script"]), {
      botConcurrency: 3,
    });
    expect(fromDefault.requested).toBe(3);
    expect(fromDefault.effective).toBe(3);
  });
});
