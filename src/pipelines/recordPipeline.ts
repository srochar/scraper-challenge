import { appendJsonLine } from "../utils/fs";
import { relative } from "path";
import { resolvePdfUrl } from "../download/pdfResolver";
import { Logger } from "../logging/logger";
import { RunStore } from "../storage/runStore";
import { DocumentRecord, FailedRecord, RunStage, ScraperConfig, TransformedRecord } from "../types";

export interface RecordDownloadOutcome {
  result: {
    status: "downloaded" | "missing_link" | "failed";
    attempts: number;
    filePath?: string;
    reason?: string;
  };
  failure?: FailedRecord;
}

export interface RecordPipelineParams {
  selected: DocumentRecord[];
  alreadyProcessed: Set<string>;
  outputJsonl: string;
  config: ScraperConfig;
  runStore: RunStore;
  logger?: Logger;
  pace: (operation: string, context?: Record<string, unknown>) => Promise<void>;
  safeDownload: (record: DocumentRecord, operation: string) => Promise<RecordDownloadOutcome>;
  recordError: (
    stage: RunStage,
    operation: string,
    error: unknown,
    context?: Record<string, unknown>,
  ) => Promise<void>;
  assertFailureThreshold: (consecutiveDownloadFailures: number) => void;
}

export interface RecordPipelineResult {
  processed: number;
  downloaded: number;
  missingLink: number;
  failed: number;
  transformedRecords: TransformedRecord[];
}

export async function processRecordsPipeline(params: RecordPipelineParams): Promise<RecordPipelineResult> {
  const {
    selected,
    alreadyProcessed,
    outputJsonl,
    config,
    runStore,
    logger,
    pace,
    safeDownload,
    recordError,
    assertFailureThreshold,
  } = params;

  let processed = 0;
  let downloaded = 0;
  let missingLink = 0;
  let failed = 0;
  let consecutiveDownloadFailures = 0;
  const transformedRecords: TransformedRecord[] = [];

  let recordIndex = 0;
  for (const record of selected) {
    recordIndex += 1;
    const normalized: DocumentRecord = {
      ...record,
      pdfHref: resolvePdfUrl(record, config.baseUrl),
    };

    logger?.debug("Processing record", {
      recordIndex,
      recordTotal: selected.length,
      recordId: normalized.id,
      title: normalized.title,
      sourcePage: normalized.sourcePage,
      hasPdfHref: Boolean(normalized.pdfHref),
      item: normalized,
    });

    try {
      await appendJsonLine(outputJsonl, normalized);
    } catch (error) {
      await recordError("process", "appendRecord", error, {
        recordId: normalized.id,
        page: normalized.sourcePage,
      });
      throw error;
    }

    if (config.downloadMode === "individual" || config.downloadMode === "both") {
      await pace("download.record", {
        recordId: normalized.id,
        page: normalized.sourcePage,
      });
      const download = await safeDownload(normalized, "download.record");
      if (download.result.status === "downloaded") {
        downloaded += 1;
        consecutiveDownloadFailures = 0;
      } else if (download.result.status === "missing_link") {
        missingLink += 1;
        consecutiveDownloadFailures = 0;
      } else {
        failed += 1;
        consecutiveDownloadFailures += 1;
        if (download.failure) {
          await runStore.appendFailure(download.failure);
          await runStore.appendError({
            timestamp: new Date().toISOString(),
            runId: config.runId,
            bot: config.bot,
            stage: "download",
            operation: "download.record",
            errorName: "DownloadFailed",
            errorMessage: download.failure.reason,
            recordId: download.failure.id,
            attempt: download.failure.attempts,
            url: download.failure.pdfUrl,
            page: normalized.sourcePage,
            context: {
              retryFailure: true,
            },
          });
        }
        assertFailureThreshold(consecutiveDownloadFailures);
      }

      transformedRecords.push({
        bot: config.bot,
        runId: config.runId,
        id: normalized.id,
        title: normalized.title,
        sourcePage: normalized.sourcePage,
        metadata: normalized.metadata,
        downloadUrl: normalized.pdfHref,
        downloadStatus: download.result.status,
        downloadAttempts: download.result.attempts,
        downloadFile: download.result.filePath ? toRelativeRunPath(config.dataDir, download.result.filePath) : undefined,
        downloadReason: download.result.reason,
        bulkDownloadStatus: normalized.bulkFieldName ? "not_requested" : "not_applicable",
        bulkUnzipStatus: normalized.bulkFieldName ? "not_requested" : "not_applicable",
      });
    } else {
      transformedRecords.push({
        bot: config.bot,
        runId: config.runId,
        id: normalized.id,
        title: normalized.title,
        sourcePage: normalized.sourcePage,
        metadata: normalized.metadata,
        downloadUrl: normalized.pdfHref,
        downloadStatus: normalized.pdfHref ? "failed" : "missing_link",
        downloadAttempts: 0,
        downloadReason: normalized.pdfHref ? "not_attempted_download_mode_bulk" : "missing_link",
        bulkDownloadStatus: normalized.bulkFieldName ? "not_requested" : "not_applicable",
        bulkUnzipStatus: normalized.bulkFieldName ? "not_requested" : "not_applicable",
      });
    }
    processed += 1;
    alreadyProcessed.add(normalized.id);

    try {
      await runStore.writeProgress({
        page: record.sourcePage,
        processedIds: Array.from(alreadyProcessed),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      await recordError("process", "writeProgress", error, {
        recordId: normalized.id,
        page: record.sourcePage,
      });
      throw error;
    }
  }

  return {
    processed,
    downloaded,
    missingLink,
    failed,
    transformedRecords,
  };
}

function toRelativeRunPath(runRoot: string, filePath: string): string {
  return relative(runRoot, filePath).split("\\").join("/");
}
