import { join } from "path";
import { DocumentRecord, FailedRecord, ScraperConfig } from "./types";
import { PortalClient } from "./portalClient";
import { parseDocumentsFromPanelHtml } from "./resultParser";
import { PdfDownloadService } from "./pdfDownloadService";
import { resolvePdfUrl } from "./pdfResolver";
import { RunStore } from "./runStore";
import { appendJsonLine, ensureDir } from "./utils/fs";

export interface ScrapeSummary {
  processed: number;
  downloaded: number;
  missingPdf: number;
  failed: number;
}

export class ScrapeOrchestrator {
  constructor(
    private readonly portalClient: PortalClient,
    private readonly downloader: PdfDownloadService,
    private readonly runStore: RunStore,
    private readonly config: ScraperConfig,
  ) {}

  async run(): Promise<ScrapeSummary> {
    await this.runStore.initialize();
    await ensureDir(this.config.outputDir);
    await ensureDir(this.config.dataDir);

    const outputJsonl = join(this.config.dataDir, "records.jsonl");

    let processed = 0;
    let downloaded = 0;
    let missingPdf = 0;
    let failed = 0;

    if (this.config.failedOnly) {
      const failures = await this.runStore.readFailures();
      for (const failure of failures) {
        const record = failureToRecord(failure);
        const result = await this.downloader.download(record);
        if (result.result.status === "downloaded") {
          downloaded += 1;
        } else if (result.result.status === "missing_pdf") {
          missingPdf += 1;
        } else {
          failed += 1;
          if (result.failure) {
            await this.runStore.appendFailure(result.failure);
          }
        }
        processed += 1;
      }

      return { processed, downloaded, missingPdf, failed };
    }

    await this.portalClient.initialize();
    const response = await this.portalClient.search(this.config.searchTerm);
    const panelHtml = response.updates?.["formBuscador:panel"] ?? "";
    const records = parseDocumentsFromPanelHtml(panelHtml, 1);

    const resumeState = this.config.resume ? await this.runStore.readProgress() : undefined;
    const alreadyProcessed = new Set(resumeState?.processedIds ?? []);
    const selected = applyBounds(records, this.config.maxRecords, alreadyProcessed);

    for (const record of selected) {
      const normalized: DocumentRecord = {
        ...record,
        pdfHref: resolvePdfUrl(record, this.config.baseUrl),
      };

      await appendJsonLine(outputJsonl, normalized);
      const download = await this.downloader.download(normalized);
      if (download.result.status === "downloaded") {
        downloaded += 1;
      } else if (download.result.status === "missing_pdf") {
        missingPdf += 1;
      } else {
        failed += 1;
        if (download.failure) {
          await this.runStore.appendFailure(download.failure);
        }
      }
      processed += 1;
      alreadyProcessed.add(normalized.id);

      await this.runStore.writeProgress({
        page: record.sourcePage,
        processedIds: Array.from(alreadyProcessed),
        updatedAt: new Date().toISOString(),
      });
    }

    return { processed, downloaded, missingPdf, failed };
  }
}

function applyBounds(records: DocumentRecord[], maxRecords: number | undefined, skipIds: Set<string>): DocumentRecord[] {
  const filtered = records.filter((record) => !skipIds.has(record.id));
  if (!maxRecords || maxRecords <= 0) {
    return filtered;
  }
  return filtered.slice(0, maxRecords);
}

function failureToRecord(failure: FailedRecord): DocumentRecord {
  return {
    id: failure.id,
    title: `retry-${failure.id}`,
    metadata: {},
    pdfHref: failure.pdfUrl,
    sourcePage: 0,
  };
}
