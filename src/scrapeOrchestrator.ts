import { join } from "path";
import { writeFile } from "fs/promises";
import { DocumentRecord, FailedRecord, ScraperConfig } from "./types";
import { PortalClient } from "./portalClient";
import { parseDocumentsFromPanelHtml } from "./resultParser";
import { PdfDownloadService } from "./pdfDownloadService";
import { resolvePdfUrl } from "./pdfResolver";
import { RunStore } from "./runStore";
import { Logger } from "./logger";
import { appendJsonLine, ensureDir } from "./utils/fs";

export interface ScrapeSummary {
  processed: number;
  downloaded: number;
  missingPdf: number;
  failed: number;
  bulkZipDownloaded?: number;
}

export class ScrapeOrchestrator {
  constructor(
    private readonly portalClient: PortalClient,
    private readonly downloader: PdfDownloadService,
    private readonly runStore: RunStore,
    private readonly config: ScraperConfig,
    private readonly logger?: Logger,
  ) {}

  async run(): Promise<ScrapeSummary> {
    await this.runStore.initialize();
    await ensureDir(this.config.outputDir);
    await ensureDir(this.config.dataDir);
    this.logger?.info("Run initialized", {
      outputDir: this.config.outputDir,
      dataDir: this.config.dataDir,
      failedOnly: this.config.failedOnly,
      resume: this.config.resume,
    });

    const outputJsonl = join(this.config.dataDir, "records.jsonl");

    let processed = 0;
    let downloaded = 0;
    let missingPdf = 0;
    let failed = 0;
    let bulkZipDownloaded = 0;

    if (this.config.failedOnly) {
      const failures = await this.runStore.readFailures();
      this.logger?.info("Processing failed-only mode", { count: failures.length });
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

      return { processed, downloaded, missingPdf, failed, bulkZipDownloaded };
    }

    await this.portalClient.submitSearchFromInicio(this.config.searchTerm);
    const firstPage = await this.portalClient.search(this.config.searchTerm);
    const records: DocumentRecord[] = [];

    const maxPages = this.config.maxPages && this.config.maxPages > 0 ? this.config.maxPages : 1;
    const page1Records = extractRecordsFromResponse(firstPage, 1);
    this.logger?.info("Page processed", { page: 1, records: page1Records.length });
    records.push(...page1Records);

    for (let page = 2; page <= maxPages; page += 1) {
      const pageResponse = await this.portalClient.gotoPage(page, this.config.searchTerm);
      const pageRecords = extractRecordsFromResponse(pageResponse, page);
      this.logger?.info("Page processed", { page, records: pageRecords.length });
      if (pageRecords.length === 0) {
        this.logger?.info("Stopping pagination due to empty page", { page });
        break;
      }
      records.push(...pageRecords);
    }

    const resumeState = this.config.resume ? await this.runStore.readProgress() : undefined;
    const alreadyProcessed = new Set(resumeState?.processedIds ?? []);
    const selected = applyBounds(records, this.config.maxRecords, alreadyProcessed);
    this.logger?.info("Records selected for processing", {
      discovered: records.length,
      selected: selected.length,
      skippedByResume: alreadyProcessed.size,
    });

    for (const record of selected) {
      const normalized: DocumentRecord = {
        ...record,
        pdfHref: resolvePdfUrl(record, this.config.baseUrl),
      };

      this.logger?.debug("Processing record", {
        recordId: normalized.id,
        sourcePage: normalized.sourcePage,
        hasPdfHref: Boolean(normalized.pdfHref),
      });

      await appendJsonLine(outputJsonl, normalized);

      if (this.config.downloadMode === "individual" || this.config.downloadMode === "both") {
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
      }
      processed += 1;
      alreadyProcessed.add(normalized.id);

      await this.runStore.writeProgress({
        page: record.sourcePage,
        processedIds: Array.from(alreadyProcessed),
        updatedAt: new Date().toISOString(),
      });
    }

    if (this.config.downloadMode === "bulk" || this.config.downloadMode === "both") {
      const selectedWithBulk = selected.filter((record) => Boolean(record.bulkFieldName));
      if (selectedWithBulk.length > 0) {
        const zipData = await this.portalClient.downloadBulkZip(selectedWithBulk, this.config.searchTerm);
        if (zipData) {
          const zipPath = join(this.config.outputDir, `Resoluciones_Jurisprudencia_${Date.now()}.zip`);
          await writeFile(zipPath, zipData);
          bulkZipDownloaded = 1;
          this.logger?.info("Bulk ZIP downloaded", { zipPath, selectedCount: selectedWithBulk.length });
        }
      }
    }

    this.logger?.info("Run summary", { processed, downloaded, missingPdf, failed });

    return { processed, downloaded, missingPdf, failed, bulkZipDownloaded };
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

function extractRecordsFromResponse(response: { updates?: Record<string, string> }, page: number): DocumentRecord[] {
  const panel = response.updates?.["formBuscador:panel"];
  if (!panel) {
    return [];
  }
  return parseDocumentsFromPanelHtml(panel, page);
}
