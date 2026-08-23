import { join } from "path";
import { PortalClient } from "./portal/client";
import { PdfDownloadService } from "./download/pdfDownloadService";
import { buildInitialManifest, buildRunStorePaths, RunStore } from "./storage/runStore";
import { ScrapeOrchestrator } from "./scrapeOrchestrator";
import { RetryConfig, RunErrorEvent, ScrapeSummary, ScraperConfig } from "./types";
import { createLogger, normalizeLogFormat, normalizeLogLevel } from "./logging/logger";
import { createDispatcher } from "./runtime/dispatcher";
import { buildConfig, buildConfigFromArgs, expandConfigBotJobs, generateRunId, loadRuntimeConfig, parseArgs } from "./runtime/config";
import { toFatalErrorPayload } from "./runtime/fatal";
import { parseBotJobs } from "./runtime/jobs";
import { buildUnsuccessfulSummaryMessage, isSummarySuccessful, writeGlobalConsolidatedResults } from "./runtime/results";
import { toSpanishErrorMessage } from "./utils/errorMessages";

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const runtimeConfig = await loadRuntimeConfig(args.get("config") as string | undefined);
  const runsRoot = (args.get("runs-dir") as string | undefined) ?? join(process.cwd(), "runs");
  const processLogger = createLogger({
    level: normalizeLogLevel((args.get("log-level") as string | undefined) ?? runtimeConfig.defaults?.logLevel),
    format: normalizeLogFormat((args.get("log-format") as string | undefined) ?? runtimeConfig.defaults?.logFormat),
    service: "scraping-bot",
    logFilePath: join(runsRoot, "global.logs.jsonl"),
    context: { module: "main" },
  });
  const dispatcher = createDispatcher(args, runtimeConfig.defaults);
  const jobs = parseBotJobs(
    args.get("bot-jobs") as string | undefined,
    expandConfigBotJobs(runtimeConfig),
  );
  const processStartedAtMs = Date.now();
  const processStartedAt = new Date(processStartedAtMs).toISOString();
  processLogger.info("Inicio de proceso total", {
    accion: "inicio_proceso_total",
    startedAt: processStartedAt,
    jobsPlanned: jobs.length > 0 ? jobs.length : 1,
    queueMode: jobs.length > 0,
  });
  let processSuccess = false;
  let processErrorMessage: string | undefined;

  try {
    if (jobs.length === 0) {
      const config = await buildConfigFromArgs(args, undefined, runtimeConfig.defaults);
      const spiderStartedAtMs = Date.now();
      const spiderStartedAt = new Date(spiderStartedAtMs).toISOString();
      processLogger.info("Inicio de arana", {
        accion: "inicio_arana",
        bot: config.bot,
        busqueda: config.searchTerm,
        runId: config.runId,
        startedAt: spiderStartedAt,
      });
      let spiderSuccess = false;
      let spiderErrorMessage: string | undefined;
      try {
        const summary = await runSingleConfig(config, dispatcher);
        spiderSuccess = isSummarySuccessful(summary);
        processSuccess = spiderSuccess;
      } catch (error) {
        spiderErrorMessage = toSpanishErrorMessage(error);
        processErrorMessage = spiderErrorMessage;
        process.stderr.write(`${JSON.stringify(toFatalErrorPayload(error, "main", {
          runId: config.runId,
          bot: config.bot,
        }))}\n`);
        process.exitCode = 1;
      } finally {
        const spiderFinishedAtMs = Date.now();
        processLogger.info("Fin de arana", {
          accion: "fin_arana",
          bot: config.bot,
          busqueda: config.searchTerm,
          runId: config.runId,
          success: spiderSuccess,
          errorMessage: spiderErrorMessage,
          ...buildTimingMeta(spiderStartedAtMs, spiderStartedAt, spiderFinishedAtMs),
        });
      }
      return;
    }

    const results: Array<{ id: string; bot: string; success: boolean; error?: string }> = [];
    const runResultSources: Array<{ path: string; bot: string; runId: string }> = [];
    for (const job of jobs) {
      const spiderStartedAtMs = Date.now();
      const spiderStartedAt = new Date(spiderStartedAtMs).toISOString();
      processLogger.info("Inicio de arana", {
        accion: "inicio_arana",
        jobId: job.id,
        bot: job.bot,
        busqueda: job.searchTerm,
        startedAt: spiderStartedAt,
      });
      let spiderSuccess = false;
      let spiderErrorMessage: string | undefined;
      let spiderRunId: string | undefined;
      try {
        const config = await buildConfigFromArgs(
          args,
          {
            bot: job.bot,
            searchTerm: job.searchTerm,
            maxPages: job.maxPages,
            maxRecords: job.maxRecords,
            runId: generateRunId(),
          },
          runtimeConfig.defaults,
        );
        spiderRunId = config.runId;
        const summary = await runSingleConfig(config, dispatcher);
        runResultSources.push({
          path: join(config.resultsDir, config.resultFormat === "json" ? "records.json" : "records.csv"),
          bot: config.bot,
          runId: config.runId,
        });
        spiderSuccess = isSummarySuccessful(summary);
        spiderErrorMessage = spiderSuccess ? undefined : buildUnsuccessfulSummaryMessage(summary);
        results.push({
          id: job.id,
          bot: job.bot,
          success: spiderSuccess,
          error: spiderErrorMessage,
        });
      } catch (error) {
        spiderErrorMessage = toSpanishErrorMessage(error);
        results.push({
          id: job.id,
          bot: job.bot,
          success: false,
          error: spiderErrorMessage,
        });
      } finally {
        const spiderFinishedAtMs = Date.now();
        processLogger.info("Fin de arana", {
          accion: "fin_arana",
          jobId: job.id,
          bot: job.bot,
          busqueda: job.searchTerm,
          runId: spiderRunId,
          success: spiderSuccess,
          errorMessage: spiderErrorMessage,
          ...buildTimingMeta(spiderStartedAtMs, spiderStartedAt, spiderFinishedAtMs),
        });
      }
    }

    if (runResultSources.length > 0) {
      await writeGlobalConsolidatedResults(runsRoot, runResultSources);
    }

    process.stdout.write(`${JSON.stringify({ type: "bot-queue-results", results }, null, 2)}\n`);
    processSuccess = !results.some((result) => !result.success);
    if (!processSuccess) {
      processErrorMessage = "Una o mas aranas terminaron con error.";
      process.exitCode = 1;
    }
  } finally {
    const processFinishedAtMs = Date.now();
    processLogger.info("Fin de proceso total", {
      accion: "fin_proceso_total",
      success: processSuccess,
      errorMessage: processErrorMessage,
      ...buildTimingMeta(processStartedAtMs, processStartedAt, processFinishedAtMs),
    });
  }
}

function buildTimingMeta(startedAtMs: number, startedAt: string, endedAtMs: number): {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  durationSec: number;
} {
  const durationMs = Math.max(0, endedAtMs - startedAtMs);
  return {
    startedAt,
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs,
    durationSec: Number((durationMs / 1000).toFixed(3)),
  };
}

async function runSingleConfig(config: ScraperConfig, dispatcher: ReturnType<typeof createDispatcher>): Promise<ScrapeSummary> {
  const runStore = new RunStore(buildRunStorePaths(config.dataDir));
  await runStore.initialize();
  const manifest = buildInitialManifest(config);
  await runStore.writeManifest(manifest);
  const globalLogFilePath = join(config.runsDir, "global.logs.jsonl");
  const logger = createLogger({
    level: config.logLevel,
    format: config.logFormat,
    service: "scraping-bot",
    logFilePath: config.logFilePath ?? runStore.getPaths().logsPath,
    additionalLogFilePaths: [globalLogFilePath],
    context: {
      bot: config.bot,
      busqueda: config.searchTerm,
    },
  });
  logger.info("Inicio de corrida", { accion: "inicio" });

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
    debugCaptureDir: config.debugCaptureDir,
    requestTimeoutMs: 30_000,
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
    dispatcher,
  );

  try {
    const summary = await orchestrator.run();
    logger.info("Corrida finalizada", {
      accion: "fin",
      processed: summary.processed,
      downloaded: summary.downloaded,
      missingLink: summary.missingLink,
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
    return summary;
  } catch (error) {
    const message = toSpanishErrorMessage(error);
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
    throw error;
  }
}

export {
  parseArgs,
  buildConfig,
  loadRuntimeConfig,
  expandConfigBotJobs,
  isSummarySuccessful,
  writeGlobalConsolidatedResults,
  toFatalErrorPayload,
};

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${JSON.stringify(toFatalErrorPayload(error, "bootstrap"))}\n`);
    process.exit(1);
  });
}
