import { relative } from "path";
import { DocumentRecord, FailedRecord, RunErrorEvent, ScrapeSummary, ScraperConfig, RunStage, TransformedRecord } from "./types";
import { PortalClient } from "./portal/client";
import { PdfDownloadService } from "./download/pdfDownloadService";
import { RunStore } from "./storage/runStore";
import { Logger } from "./logging/logger";
import { NetworkDispatcher } from "./network/dispatcher";
import { ensureDir } from "./utils/fs";
import { toSpanishErrorMessage } from "./utils/errorMessages";
import { ExecutionEngine } from "./engine/executionEngine";
import { processRecordsPipeline } from "./pipelines/recordPipeline";
import { processBulkPipeline } from "./pipelines/bulkPipeline";
import { writeTransformedResults } from "./pipelines/exportPipeline";
import { RequestExecutor } from "./downloader/requestExecutor";

export class ScrapeOrchestrator {
  constructor(
    private readonly portalClient: PortalClient,
    private readonly downloader: PdfDownloadService,
    private readonly runStore: RunStore,
    private readonly config: ScraperConfig,
    private readonly logger?: Logger,
    private readonly dispatcher?: NetworkDispatcher,
  ) {}

  async run(): Promise<ScrapeSummary> {
    await this.runStore.initialize();
    await ensureDir(this.config.outputDir);
    await ensureDir(this.config.resultsDir);
    await ensureDir(this.config.bulkOutputDir);
    this.logger?.info("Run initialized", {
      accion: "inicializar",
      outputDir: this.config.outputDir,
      resultsDir: this.config.resultsDir,
      dataDir: this.config.dataDir,
      runId: this.config.runId,
      bot: this.config.bot,
      failedOnly: this.config.failedOnly,
      resume: this.config.resume,
    });

    const outputJsonl = this.runStore.getPaths().recordsPath;

    let processed = 0;
    let downloaded = 0;
    let missingLink = 0;
    let failed = 0;
    let bulkZipDownloaded = 0;
    let taskSequence = 0;
    const transformedRecords: TransformedRecord[] = [];
    const beginTask = (task: string, meta?: Record<string, unknown>): TaskTracking => {
      taskSequence += 1;
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const taskId = buildTaskId(taskSequence);
      this.logger?.info("Inicio de tarea", {
        accion: "inicio_tarea",
        task,
        taskId,
        startedAt,
        ...(meta ?? {}),
      });
      return { task, taskId, startedAt, startedAtMs };
    };
    const finishTask = (tracking: TaskTracking, meta?: Record<string, unknown>): void => {
      this.logger?.info("Fin de tarea", {
        accion: "fin_tarea",
        task: tracking.task,
        taskId: tracking.taskId,
        ...(meta ?? {}),
        ...buildTimingMeta(tracking.startedAtMs, tracking.startedAt, Date.now()),
      });
    };
    const requestExecutor = new RequestExecutor({
      sessionKey: this.config.sessionKey,
      searchTerm: this.config.searchTerm,
      portalClient: this.portalClient,
      downloader: this.downloader,
      logger: this.logger,
      dispatcher: this.dispatcher,
      onError: (stage, operation, error, context) => this.recordError(stage, operation, error, context),
    });

    if (this.config.failedOnly) {
      const failedOnlyTask = beginTask("failed_only_pipeline");
      const failures = await this.runStore.readFailures();
      this.logger?.info("Processing failed-only mode", { count: failures.length });
      for (const failure of failures) {
        const record = failureToRecord(failure);
        await this.pace("download.retry_failed", { recordId: record.id });
        const result = await requestExecutor.executeDownload(record, "download.retry_failed");
        if (result.result.status === "downloaded") {
          downloaded += 1;
        } else if (result.result.status === "missing_link") {
          missingLink += 1;
        } else {
          failed += 1;
          if (result.failure) {
            await this.runStore.appendFailure(result.failure);
            await this.runStore.appendError({
              timestamp: new Date().toISOString(),
              runId: this.config.runId,
              bot: this.config.bot,
              stage: "download",
              operation: "download.retry_failed",
              errorName: "DownloadFailed",
              errorMessage: result.failure.reason,
              recordId: result.failure.id,
              attempt: result.failure.attempts,
              url: result.failure.pdfUrl,
              context: {
                retryFailure: true,
              },
            });
          }
        }
        transformedRecords.push({
          bot: this.config.bot,
          runId: this.config.runId,
          id: record.id,
          title: record.title,
          sourcePage: record.sourcePage,
          metadata: record.metadata,
          downloadUrl: record.pdfHref,
          downloadStatus: result.result.status,
          downloadAttempts: result.result.attempts,
          downloadFile: result.result.filePath ? toRelativeRunPath(this.config.dataDir, result.result.filePath) : undefined,
          downloadReason: result.result.reason,
          bulkDownloadStatus: "not_applicable",
          bulkUnzipStatus: "not_applicable",
        });
        processed += 1;
      }
      const exportTask = beginTask("export_results");
      await writeTransformedResults(transformedRecords, this.config);
      finishTask(exportTask);
      finishTask(failedOnlyTask, {
        processed,
        downloaded,
        missingLink,
        failed,
      });
      return { processed, downloaded, missingLink, failed, bulkZipDownloaded };
    }

    const engine = new ExecutionEngine({
      searchTerm: this.config.searchTerm,
      maxPages: this.config.maxPages,
      logger: this.logger,
    });
    const discoveryTask = beginTask("discover_records");
    const records = await engine.collectDiscoveredRecords({
      initialize: async () => requestExecutor.executePortalInitWithRetry(
        "init",
        "initialize",
        async () => this.portalClient.initialize(),
      ),
      submitSearchFromInicio: async () => requestExecutor.executePortalInitWithRetry(
        "init",
        "submitSearchFromInicio",
        async () => this.portalClient.submitSearchFromInicio(this.config.searchTerm),
      ),
      search: async () => requestExecutor.executePortalWithSessionRecovery(
        "search",
        "search",
        async () => this.portalClient.search(this.config.searchTerm),
      ),
      gotoPage: async (page) => requestExecutor.executePortalWithSessionRecovery(
        "paginate",
        "gotoPage",
        async () => this.portalClient.gotoPage(page, this.config.searchTerm),
        { page },
      ),
    });
    finishTask(discoveryTask, {
      discovered: records.length,
    });

    const resumeState = this.config.resume ? await this.runStore.readProgress() : undefined;
    const alreadyProcessed = new Set(resumeState?.processedIds ?? []);
    const selected = applyBounds(records, this.config.maxRecords, alreadyProcessed);
    this.logger?.info("Registros seleccionados", {
      accion: "seleccionar_registros",
      discovered: records.length,
      selected: selected.length,
      skippedByResume: alreadyProcessed.size,
    });

    const recordPipelineTask = beginTask("individual_download_pipeline", {
      selected: selected.length,
    });
    const recordOutcome = await processRecordsPipeline({
      selected,
      alreadyProcessed,
      outputJsonl,
      config: this.config,
      runStore: this.runStore,
      logger: this.logger,
      pace: (operation, context) => this.pace(operation, context),
      safeDownload: (record, operation) => requestExecutor.executeDownload(record, operation),
      recordError: (stage, operation, error, context) => this.recordError(stage, operation, error, context),
      assertFailureThreshold: (count) => this.assertFailureThreshold(count),
    });
    finishTask(recordPipelineTask, {
      processed: recordOutcome.processed,
      downloaded: recordOutcome.downloaded,
      missingLink: recordOutcome.missingLink,
      failed: recordOutcome.failed,
    });

    processed += recordOutcome.processed;
    downloaded += recordOutcome.downloaded;
    missingLink += recordOutcome.missingLink;
    failed += recordOutcome.failed;
    transformedRecords.push(...recordOutcome.transformedRecords);

    if (this.config.downloadMode === "bulk" || this.config.downloadMode === "both") {
      const bulkPipelineTask = beginTask("bulk_download_pipeline");
      const bulkOutcome = await processBulkPipeline({
        selected,
        transformedRecords,
        config: this.config,
        logger: this.logger,
        pace: (operation, context) => this.pace(operation, context),
        safePortal: (stage, operation, fn, context) => requestExecutor.executePortal(stage, operation, fn, context),
        recordError: (stage, operation, error, context) => this.recordError(stage, operation, error, context),
        downloadBulkZip: (pageRecords, searchTerm, page) => this.portalClient.downloadBulkZip(pageRecords, searchTerm, page),
      });
      bulkZipDownloaded += bulkOutcome.bulkZipDownloaded;
      finishTask(bulkPipelineTask, {
        bulkZipDownloaded: bulkOutcome.bulkZipDownloaded,
      });
    }

    this.logger?.info("Resumen de corrida", {
      accion: "resumen",
      processed,
      downloaded,
      missingLink,
      failed,
    });

    const exportTask = beginTask("export_results", {
      records: transformedRecords.length,
    });
    await writeTransformedResults(transformedRecords, this.config);
    finishTask(exportTask, {
      records: transformedRecords.length,
    });
    return { processed, downloaded, missingLink, failed, bulkZipDownloaded };
  }

  private assertFailureThreshold(consecutiveDownloadFailures: number): void {
    if (this.config.maxConsecutiveDownloadFailures <= 0) {
      return;
    }
    if (consecutiveDownloadFailures < this.config.maxConsecutiveDownloadFailures) {
      return;
    }
    throw new Error(
      `Se detuvo la corrida tras ${consecutiveDownloadFailures} fallas consecutivas de descarga (umbral=${this.config.maxConsecutiveDownloadFailures}).`,
    );
  }

  private async pace(operation: string, context?: Record<string, unknown>): Promise<void> {
    const base = Math.max(0, this.config.requestDelayMs ?? 0);
    const jitter = Math.max(0, this.config.requestJitterMs ?? 0);
    const randomJitter = jitter > 0 ? Math.floor(Math.random() * (jitter + 1)) : 0;
    const total = base + randomJitter;
    if (total <= 0) {
      return;
    }
    this.logger?.debug("Applying request pacing", { operation, delayMs: total, ...(context ?? {}) });
    await new Promise<void>((resolve) => setTimeout(resolve, total));
  }

  private async recordError(
    stage: RunStage,
    operation: string,
    error: unknown,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const statusCode = getErrorStatus(error);
    const recordId = typeof context?.recordId === "string" ? context.recordId : undefined;
    const page = typeof context?.page === "number" ? context.page : undefined;
    const url = typeof context?.url === "string" ? context.url : undefined;
    const event: RunErrorEvent = {
      timestamp: new Date().toISOString(),
      runId: this.config.runId,
      bot: this.config.bot,
      stage,
      operation,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: toSpanishErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
      recordId,
      page,
      url,
      statusCode,
      context,
    };
    await this.runStore.appendError(event);
    this.logger?.error("Falla de etapa", {
      accion: "error",
      stage,
      operation,
      errorName: event.errorName,
      errorMessage: event.errorMessage,
      ...(context ?? {}),
    });
  }

}

interface TaskTracking {
  task: string;
  taskId: string;
  startedAt: string;
  startedAtMs: number;
}

function buildTaskId(sequence: number): string {
  return `task-${String(sequence).padStart(4, "0")}`;
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

function toRelativeRunPath(runRoot: string, filePath: string): string {
  const rel = relative(runRoot, filePath);
  return rel.split("\\").join("/");
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { status?: unknown } }).response;
    if (typeof response?.status === "number") {
      return response.status;
    }
  }
  return undefined;
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
