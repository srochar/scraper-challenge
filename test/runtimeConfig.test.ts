import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseArgs, buildConfig } from "../src/index";
import { resolveBotConcurrency } from "../src/runtime/config";

describe("runtime config", () => {
  it("rejects legacy --config flag", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-rejected-"));
    const configPath = join(temp, "scraper.config.json");
    writeFileSync(configPath, JSON.stringify({ defaults: { requestDelayMs: 1200 } }), "utf8");

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
    ])).rejects.toThrow(/--config is no longer supported/);
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

  it("uses direct CLI flags", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-cli-"));
    const config = await buildConfig([
      "node",
      "script",
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
      "--duplicate-429-window-ms",
      "30000",
      "--duplicate-429-threshold",
      "3",
      "--unzip",
      "false",
      "--log-format",
      "pretty",
    ]);

    expect(config.requestDelayMs).toBe(25);
    expect(config.requestTimeoutMs).toBe(70000);
    expect(config.duplicate429WindowMs).toBe(30000);
    expect(config.duplicate429Threshold).toBe(3);
    expect(config.downloadMode).toBe("individual");
    expect(config.unzip).toBe(false);
    expect(config.logFormat).toBe("pretty");
  });

  it("applies internal defaults when CLI flags are omitted", async () => {
    const temp = mkdtempSync(join(tmpdir(), "scraper-config-defaults-"));
    const config = await buildConfig([
      "node",
      "script",
      "--runs-dir",
      temp,
      "--bot",
      "civil",
      "--search",
      "civil",
    ]);

    expect(config.requestTimeoutMs).toBe(30000);
    expect(config.requestDelayMs).toBe(0);
    expect(config.requestJitterMs).toBe(0);
    expect(config.downloadMode).toBe("individual");
    expect(config.resultFormat).toBe("csv");
    expect(config.unzip).toBe(false);
  });

  it("normalizes bot concurrency with upper bound", () => {
    const fromCli = resolveBotConcurrency(parseArgs(["node", "script", "--bot-concurrency", "9"]));
    expect(fromCli.requested).toBe(9);
    expect(fromCli.effective).toBe(4);

    const fromDefault = resolveBotConcurrency(parseArgs(["node", "script"]));
    expect(fromDefault.requested).toBe(2);
    expect(fromDefault.effective).toBe(2);
  });
});
