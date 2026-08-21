import { join } from "path";
import { randomBytes } from "crypto";
import { PortalClient } from "./portalClient";
import { PdfDownloadService } from "./pdfDownloadService";
import { buildInitialManifest, buildRunStorePaths, RunStore } from "./runStore";
import { ScrapeOrchestrator } from "./scrapeOrchestrator";
import { RetryConfig, RunErrorEvent, ScraperConfig } from "./types";
import { createLogger, normalizeLogFormat, normalizeLogLevel } from "./logger";
import { ensureDir, readJson, writeJson } from "./utils/fs";

export interface LatestPointer {
  runId: string;
  updatedAt: string;
}

export interface FatalErrorPayload {
  type: "fatal";
  stage: "main";
  operation: string;
  errorName: string;
  errorMessage: string;
  runId?: string;
  bot?: string;
}

export function parseArgs(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>();
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args.set(key, true);
      } else {
        args.set(key, next);
        i += 1;
      }
    }
  }

  return args;
}

export async function buildConfig(argv: string[]): Promise<ScraperConfig> {
  const args = parseArgs(argv);
  const bot = sanitizeBotName((args.get("bot") as string | undefined) ?? "default");
  const runsDir = (args.get("runs-dir") as string | undefined) ?? join(process.cwd(), "runs");
  const latestPath = join(runsDir, bot, "latest.json");
  const shouldReuseLatest = Boolean(args.get("resume") || args.get("failed-only"));
  const explicitRunId = (args.get("run-id") as string | undefined) ?? undefined;
  const latest = shouldReuseLatest ? await readJson<LatestPointer>(latestPath) : undefined;
  if ((args.get("resume") || args.get("failed-only")) && !explicitRunId && !latest?.runId) {
    throw new Error(`No latest run found for bot '${bot}'. Provide --run-id or run a fresh scrape first.`);
  }
  const runId = explicitRunId ?? latest?.runId ?? generateRunId();

  const runRoot = join(runsDir, bot, runId);
  const dataDir = (args.get("data-dir") as string | undefined) ?? runRoot;
  const outputDir = (args.get("output-dir") as string | undefined) ?? join(runRoot, "artifacts", "pdfs");
  const bulkOutputDir = join(runRoot, "artifacts", "bulk");
  const logFilePath = (args.get("log-file") as string | undefined) ?? join(runRoot, "logs.jsonl");

  await ensureDir(join(runsDir, bot));
  await writeJson(latestPath, { runId, updatedAt: new Date().toISOString() } as LatestPointer);

  return {
    baseUrl:
      (args.get("base-url") as string) ??
      "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb",
    searchTerm: (args.get("search") as string) ?? "civil",
    bot,
    runId,
    runsDir,
    outputDir,
    bulkOutputDir,
    dataDir,
    resume: Boolean(args.get("resume")),
    failedOnly: Boolean(args.get("failed-only")),
    maxRecords: args.get("max-records") ? Number(args.get("max-records")) : undefined,
    maxPages: args.get("max-pages") ? Number(args.get("max-pages")) : undefined,
    requestDelayMs: args.get("request-delay-ms") ? Number(args.get("request-delay-ms")) : 0,
    requestJitterMs: args.get("request-jitter-ms") ? Number(args.get("request-jitter-ms")) : 0,
    logLevel: normalizeLogLevel(args.get("log-level") as string | undefined),
    logFormat: normalizeLogFormat(args.get("log-format") as string | undefined),
    logFilePath,
    downloadMode: ((args.get("download-mode") as string | undefined) ?? "individual") as
      | "individual"
      | "bulk"
      | "both",
  };
}

async function main(): Promise<void> {
  const config = await buildConfig(process.argv);
  const runStore = new RunStore(buildRunStorePaths(config.dataDir));
  await runStore.initialize();
  const manifest = buildInitialManifest(config);
  await runStore.writeManifest(manifest);
  const logger = createLogger({
    level: config.logLevel,
    format: config.logFormat,
    service: "scraping-bot",
    logFilePath: config.logFilePath ?? runStore.getPaths().logsPath,
    context: {
      pid: process.pid,
      bot: config.bot,
      runId: config.runId,
    },
  });
  logger.info("Starting scraper", {
    baseUrl: config.baseUrl,
    searchTerm: config.searchTerm,
    maxRecords: config.maxRecords,
    maxPages: config.maxPages,
    requestDelayMs: config.requestDelayMs,
    requestJitterMs: config.requestJitterMs,
    resume: config.resume,
    failedOnly: config.failedOnly,
    runsDir: config.runsDir,
    dataDir: config.dataDir,
    outputDir: config.outputDir,
    bulkOutputDir: config.bulkOutputDir,
  });

  const retryConfig: RetryConfig = {
    maxRetries: 4,
    initialDelayMs: 500,
    backoffMultiplier: 2,
    maxDelayMs: 10_000,
    jitterRatio: 0.2,
  };

  const portalClient = new PortalClient({
    baseUrl: config.baseUrl,
    initPath: "/faces/page/inicio.xhtml",
    resultPath: "/faces/page/resultado.xhtml",
  }, undefined, logger.child({ module: "portalClient" }));

  const downloader = new PdfDownloadService({
    outputDir: config.outputDir,
    retryConfig,
  }, undefined, logger.child({ module: "pdfDownloadService" }));

  const orchestrator = new ScrapeOrchestrator(
    portalClient,
    downloader,
    runStore,
    config,
    logger.child({ module: "scrapeOrchestrator" }),
  );

  try {
    const summary = await orchestrator.run();
    logger.info("Scraper completed", {
      processed: summary.processed,
      downloaded: summary.downloaded,
      missingPdf: summary.missingPdf,
      failed: summary.failed,
      bulkZipDownloaded: summary.bulkZipDownloaded,
    });
    await runStore.writeManifest({
      ...manifest,
      endedAt: new Date().toISOString(),
      status: "completed",
      summary,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const event: RunErrorEvent = {
      timestamp: new Date().toISOString(),
      runId: config.runId,
      bot: config.bot,
      stage: "main",
      operation: "main",
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: message,
      stack: error instanceof Error ? error.stack : undefined,
      context: {
        searchTerm: config.searchTerm,
        downloadMode: config.downloadMode,
      },
    };
    await runStore.appendError(event);
    await runStore.writeManifest({
      ...manifest,
      endedAt: new Date().toISOString(),
      status: "failed",
    });
    process.stderr.write(`${JSON.stringify(toFatalErrorPayload(error, "main", {
      runId: config.runId,
      bot: config.bot,
    }))}\n`);
    process.exit(1);
  }
}

export function sanitizeBotName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "default";
}

export function generateRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}_${randomBytes(3).toString("hex")}`;
}

export function toFatalErrorPayload(
  error: unknown,
  operation: string,
  context?: { runId?: string; bot?: string },
): FatalErrorPayload {
  return {
    type: "fatal",
    stage: "main",
    operation,
    errorName: error instanceof Error ? error.name : "Error",
    errorMessage: error instanceof Error ? error.message : String(error),
    runId: context?.runId,
    bot: context?.bot,
  };
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${JSON.stringify(toFatalErrorPayload(error, "bootstrap"))}\n`);
    process.exit(1);
  });
}
