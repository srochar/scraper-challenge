import { join } from "path";
import { PortalClient } from "./portalClient";
import { PdfDownloadService } from "./pdfDownloadService";
import { RunStore } from "./runStore";
import { ScrapeOrchestrator } from "./scrapeOrchestrator";
import { RetryConfig, ScraperConfig } from "./types";
import { createLogger, normalizeLogLevel } from "./logger";

function parseArgs(argv: string[]): ScraperConfig {
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

  return {
    baseUrl:
      (args.get("base-url") as string) ??
      "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb",
    searchTerm: (args.get("search") as string) ?? "civil",
    outputDir: (args.get("output-dir") as string) ?? join(process.cwd(), "output", "pdfs"),
    dataDir: (args.get("data-dir") as string) ?? join(process.cwd(), "data"),
    resume: Boolean(args.get("resume")),
    failedOnly: Boolean(args.get("failed-only")),
    maxRecords: args.get("max-records") ? Number(args.get("max-records")) : undefined,
    maxPages: args.get("max-pages") ? Number(args.get("max-pages")) : undefined,
    logLevel: normalizeLogLevel(args.get("log-level") as string | undefined),
    logFilePath: (args.get("log-file") as string | undefined) ?? undefined,
    downloadMode: ((args.get("download-mode") as string | undefined) ?? "individual") as
      | "individual"
      | "bulk"
      | "both",
  };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv);
  const logger = createLogger({
    level: config.logLevel,
    service: "scraping-bot",
    logFilePath: config.logFilePath,
    context: {
      pid: process.pid,
    },
  });
  logger.info("Starting scraper", {
    baseUrl: config.baseUrl,
    searchTerm: config.searchTerm,
    maxRecords: config.maxRecords,
    maxPages: config.maxPages,
    resume: config.resume,
    failedOnly: config.failedOnly,
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

  const runStore = new RunStore(config.dataDir);
  const orchestrator = new ScrapeOrchestrator(
    portalClient,
    downloader,
    runStore,
    config,
    logger.child({ module: "scrapeOrchestrator" }),
  );

  const summary = await orchestrator.run();
  logger.info("Scraper completed", {
    processed: summary.processed,
    downloaded: summary.downloaded,
    missingPdf: summary.missingPdf,
    failed: summary.failed,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Scraper failed: ${message}\n`);
  process.exit(1);
});
