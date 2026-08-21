import { join } from "path";
import { PortalClient } from "./portalClient";
import { PdfDownloadService } from "./pdfDownloadService";
import { RunStore } from "./runStore";
import { ScrapeOrchestrator } from "./scrapeOrchestrator";
import { RetryConfig, ScraperConfig } from "./types";

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
      "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml",
    searchTerm: (args.get("search") as string) ?? "civil",
    outputDir: (args.get("output-dir") as string) ?? join(process.cwd(), "output", "pdfs"),
    dataDir: (args.get("data-dir") as string) ?? join(process.cwd(), "data"),
    resume: Boolean(args.get("resume")),
    failedOnly: Boolean(args.get("failed-only")),
    maxRecords: args.get("max-records") ? Number(args.get("max-records")) : undefined,
    maxPages: args.get("max-pages") ? Number(args.get("max-pages")) : undefined,
  };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv);
  const retryConfig: RetryConfig = {
    maxRetries: 4,
    initialDelayMs: 500,
    backoffMultiplier: 2,
    maxDelayMs: 10_000,
    jitterRatio: 0.2,
  };

  const portalClient = new PortalClient({
    baseUrl: config.baseUrl,
  });

  const downloader = new PdfDownloadService({
    outputDir: config.outputDir,
    retryConfig,
  });

  const runStore = new RunStore(config.dataDir);
  const orchestrator = new ScrapeOrchestrator(portalClient, downloader, runStore, config);

  const summary = await orchestrator.run();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Scraper failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
