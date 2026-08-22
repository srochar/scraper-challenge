import { basename, join, relative } from "path";
import { writeFile } from "fs/promises";
import * as cheerio from "cheerio";
import { DocumentRecord, FailedRecord, RunErrorEvent, ScrapeSummary, ScraperConfig, RunStage, TransformedRecord } from "./types";
import { PortalClient } from "./portalClient";
import { parseDocumentsFromPanelHtml } from "./resultParser";
import { PdfDownloadService } from "./pdfDownloadService";
import { resolvePdfUrl } from "./pdfResolver";
import { RunStore } from "./runStore";
import { Logger } from "./logger";
import { NetworkDispatcher } from "./networkDispatcher";
import { extractZipToSiblingFolder } from "./zipExtractor";
import { appendJsonLine, ensureDir, writeJson } from "./utils/fs";
import { toSpanishErrorMessage } from "./utils/errorMessages";

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
    let consecutiveDownloadFailures = 0;
    const transformedRecords: TransformedRecord[] = [];

    if (this.config.failedOnly) {
      const failures = await this.runStore.readFailures();
      this.logger?.info("Processing failed-only mode", { count: failures.length });
      for (const failure of failures) {
        const record = failureToRecord(failure);
        await this.pace("download.retry_failed", { recordId: record.id });
        const result = await this.safeDownload(record, "download.retry_failed");
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
      await this.writeTransformedResults(transformedRecords);
      return { processed, downloaded, missingLink, failed, bulkZipDownloaded };
    }

    const initResult = await this.safePortalInitWithRetry(
      "init",
      "submitSearchFromInicio",
      async () => this.portalClient.submitSearchFromInicio(this.config.searchTerm),
    );
    const records: DocumentRecord[] = [];

    const maxPages = this.config.maxPages && this.config.maxPages > 0 ? this.config.maxPages : 1;
    let page1Records = extractRecordsFromHtml(initResult.raw, 1);
    let usedFallbackSearch = false;
    let shouldAttemptPagination = maxPages > 1 && hasPaginatorInHtml(initResult.raw);

    if (page1Records.length === 0) {
      usedFallbackSearch = true;
      const firstPage = await this.safePortalWithSessionRecovery(
        "search",
        "search",
        async () => this.portalClient.search(this.config.searchTerm),
      );
      page1Records = extractRecordsFromResponse(firstPage, 1);
      this.logger?.debug("Fallback search records", {
        accion: "buscar_fallback",
        records: page1Records.length,
      });
      shouldAttemptPagination = maxPages > 1 && (page1Records.length >= 10 || usedFallbackSearch);
    }

    this.logger?.info("Pagina procesada", { accion: "procesar_pagina", page: 1, records: page1Records.length });
    records.push(...page1Records);

    if (!shouldAttemptPagination) {
      this.logger?.info("Skipping pagination due to missing paginator or low page-1 volume", {
        page1Records: page1Records.length,
        maxPages,
      });
    }

    for (let page = 2; shouldAttemptPagination && page <= maxPages; page += 1) {
      const pageResponse = await this.safePortalWithSessionRecovery(
        "paginate",
        "gotoPage",
        async () => this.portalClient.gotoPage(page, this.config.searchTerm),
        { page },
      );
      const pageRecords = extractRecordsFromResponse(pageResponse, page);
      this.logger?.info("Pagina procesada", { accion: "procesar_pagina", page, records: pageRecords.length });
      if (pageRecords.length === 0) {
        this.logger?.info("Stopping pagination due to empty page", { page });
        break;
      }
      records.push(...pageRecords);
    }

    const resumeState = this.config.resume ? await this.runStore.readProgress() : undefined;
    const alreadyProcessed = new Set(resumeState?.processedIds ?? []);
    const selected = applyBounds(records, this.config.maxRecords, alreadyProcessed);
    this.logger?.info("Registros seleccionados", {
      accion: "seleccionar_registros",
      discovered: records.length,
      selected: selected.length,
      skippedByResume: alreadyProcessed.size,
    });

    let recordIndex = 0;
    for (const record of selected) {
      recordIndex += 1;
      const normalized: DocumentRecord = {
        ...record,
        pdfHref: resolvePdfUrl(record, this.config.baseUrl),
      };

      this.logger?.debug("Processing record", {
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
        await this.recordError("process", "appendRecord", error, {
          recordId: normalized.id,
          page: normalized.sourcePage,
        });
        throw error;
      }

      if (this.config.downloadMode === "individual" || this.config.downloadMode === "both") {
        await this.pace("download.record", {
          recordId: normalized.id,
          page: normalized.sourcePage,
        });
        const download = await this.safeDownload(normalized, "download.record");
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
            await this.runStore.appendFailure(download.failure);
            await this.runStore.appendError({
              timestamp: new Date().toISOString(),
              runId: this.config.runId,
              bot: this.config.bot,
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
          this.assertFailureThreshold(consecutiveDownloadFailures);
        }

        transformedRecords.push({
          bot: this.config.bot,
          runId: this.config.runId,
          id: normalized.id,
          title: normalized.title,
          sourcePage: normalized.sourcePage,
          metadata: normalized.metadata,
          downloadUrl: normalized.pdfHref,
          downloadStatus: download.result.status,
          downloadAttempts: download.result.attempts,
          downloadFile: download.result.filePath ? toRelativeRunPath(this.config.dataDir, download.result.filePath) : undefined,
          downloadReason: download.result.reason,
          bulkDownloadStatus: normalized.bulkFieldName ? "not_requested" : "not_applicable",
          bulkUnzipStatus: normalized.bulkFieldName ? "not_requested" : "not_applicable",
        });
      } else {
        transformedRecords.push({
          bot: this.config.bot,
          runId: this.config.runId,
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
        await this.runStore.writeProgress({
          page: record.sourcePage,
          processedIds: Array.from(alreadyProcessed),
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        await this.recordError("process", "writeProgress", error, {
          recordId: normalized.id,
          page: record.sourcePage,
        });
        throw error;
      }
    }

    if (this.config.downloadMode === "bulk" || this.config.downloadMode === "both") {
      const selectedByPage = groupRecordsByPage(selected.filter((record) => Boolean(record.bulkFieldName)));
      this.logger?.info("Bulk page grouping prepared", {
        accion: "bulk_preparado",
        pages: selectedByPage.map(([page, pageRecords]) => ({ page, selected: pageRecords.length })),
      });
      for (const [page, pageRecords] of selectedByPage) {
        await this.pace("bulk.download", { selectedCount: pageRecords.length, page });
        let zipData: Buffer | undefined;
        try {
          zipData = await this.safePortal(
            "bulk",
            "downloadBulkZip",
            async () => this.portalClient.downloadBulkZip(pageRecords, this.config.searchTerm, page),
            { selectedCount: pageRecords.length, page },
          );
        } catch {
          applyBulkOutcomeForPage(transformedRecords, page, {
            bulkDownloadStatus: "failed",
            bulkUnzipStatus: this.config.unzip ? "unzip_failed" : "not_requested",
          });
          continue;
        }
        if (!zipData) {
          applyBulkOutcomeForPage(transformedRecords, page, {
            bulkDownloadStatus: "failed",
            bulkUnzipStatus: this.config.unzip ? "unzip_failed" : "not_requested",
          });
          continue;
        }

        const zipPath = join(this.config.bulkOutputDir, `Resoluciones_Jurisprudencia_page-${page}_${Date.now()}.zip`);
        try {
          await writeFile(zipPath, zipData);
        } catch (error) {
          await this.recordError("bulk", "writeBulkZip", error, { zipPath, page });
          throw error;
        }
        bulkZipDownloaded += 1;
        const zipRelativePath = toRelativeRunPath(this.config.dataDir, zipPath);
        let bulkUnzipStatus: "unzipped" | "unzip_failed" | "not_requested" = "not_requested";
        let bulkUnzipDir: string | undefined;
        this.logger?.info("ZIP masivo descargado", {
          accion: "descarga_zip",
          archivo: basename(zipPath),
          selectedCount: pageRecords.length,
          page,
        });
        if (this.config.unzip) {
          try {
            const extractedDir = await extractZipToSiblingFolder(zipPath);
            bulkUnzipStatus = "unzipped";
            bulkUnzipDir = toRelativeRunPath(this.config.dataDir, extractedDir);
            this.logger?.info("ZIP masivo descomprimido", {
              accion: "descomprimir_zip",
              archivo: basename(zipPath),
              destino: extractedDir,
            });
          } catch (error) {
            bulkUnzipStatus = "unzip_failed";
            await this.recordError("bulk", "unzip.bulk", error, { zipPath, page });
          }
        }

        applyBulkOutcomeForPage(transformedRecords, page, {
          bulkDownloadStatus: "downloaded",
          bulkZipFile: zipRelativePath,
          bulkUnzipStatus,
          bulkUnzipDir,
        });
      }
    }

    this.logger?.info("Resumen de corrida", {
      accion: "resumen",
      processed,
      downloaded,
      missingLink,
      failed,
    });

    await this.writeTransformedResults(transformedRecords);
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

  private async safePortal<T>(
    stage: RunStage,
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await this.executeNetwork(operation, fn);
    } catch (error) {
      await this.recordError(stage, operation, error, context);
      throw error;
    }
  }

  private async safePortalInitWithRetry<T>(
    stage: RunStage,
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    const maxInitRetries = 2;

    for (let attempt = 0; attempt <= maxInitRetries; attempt += 1) {
      try {
        return await this.executeNetwork(operation, fn);
      } catch (error) {
        const retryable = isRetryableInitError(error);
        const exhausted = attempt >= maxInitRetries;
        if (!retryable || exhausted) {
          await this.recordError(stage, operation, error, context);
          throw error;
        }

        const backoffMs = 600 * (attempt + 1);
        this.logger?.warn("Reintentando inicio por error transitorio", {
          accion: "reintento_init",
          stage,
          operation,
          initRetryAttempt: attempt + 1,
          maxInitRetries,
          backoffMs,
          statusCode: getErrorStatus(error),
          errorMessage: toSpanishErrorMessage(error),
          ...(context ?? {}),
        });
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw new Error(`Unexpected init retry flow termination for ${operation}`);
  }

  private async safePortalWithSessionRecovery<T>(
    stage: RunStage,
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    const maxRecoveryAttempts = 2;

    for (let attempt = 0; attempt <= maxRecoveryAttempts; attempt += 1) {
      try {
        return await this.executeNetwork(operation, fn);
      } catch (error) {
        const shouldRecover = isViewExpiredError(error);
        const retryableTransient = isRetryableInitError(error);
        const exhausted = attempt >= maxRecoveryAttempts;
        if (!shouldRecover && !retryableTransient) {
          await this.recordError(stage, operation, error, context);
          throw error;
        }

        if (exhausted) {
          await this.recordError(stage, operation, error, context);
          throw error;
        }

        if (retryableTransient && !shouldRecover) {
          const backoffMs = 600 * (attempt + 1);
          this.logger?.warn("Reintentando operacion por error transitorio", {
            accion: "reintento_operacion",
            stage,
            operation,
            recoveryAttempt: attempt + 1,
            maxRecoveryAttempts,
            backoffMs,
            statusCode: getErrorStatus(error),
            errorMessage: toSpanishErrorMessage(error),
            ...(context ?? {}),
          });
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        this.logger?.warn("Recuperando sesion tras expiracion", {
          accion: "recuperar_sesion",
          stage,
          operation,
          recoveryAttempt: attempt + 1,
          maxRecoveryAttempts,
          ...(context ?? {}),
        });

        try {
          await this.executeNetwork("recover.submitSearchFromInicio", async () =>
            this.portalClient.submitSearchFromInicio(this.config.searchTerm),
          );

          if (operation !== "search") {
            await this.executeNetwork("recover.search", async () => this.portalClient.search(this.config.searchTerm));
          }
        } catch (recoveryError) {
          const backoffMs = 700 * (attempt + 1);
          this.logger?.warn("Fallo recuperacion de sesion; se reintentara", {
            accion: "recuperacion_fallida",
            stage,
            operation,
            recoveryAttempt: attempt + 1,
            maxRecoveryAttempts,
            backoffMs,
            statusCode: getErrorStatus(recoveryError),
            errorMessage: toSpanishErrorMessage(recoveryError),
            ...(context ?? {}),
          });
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw new Error(`Unexpected recovery flow termination for ${operation}`);
  }

  private async safeDownload(record: DocumentRecord, operation: string): Promise<{ result: { status: "downloaded" | "missing_link" | "failed"; attempts: number; filePath?: string; reason?: string }; failure?: FailedRecord }> {
    try {
      return await this.executeNetwork(operation, async () => this.downloader.download(record));
    } catch (error) {
      await this.recordError("download", operation, error, {
        recordId: record.id,
        page: record.sourcePage,
        url: record.pdfHref,
      });
      throw error;
    }
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

  private async executeNetwork<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (!this.dispatcher) {
      return fn();
    }
    return this.dispatcher.run(this.config.sessionKey, operation, fn);
  }

  private async writeTransformedResults(records: TransformedRecord[]): Promise<void> {
    const ordered = sortTransformedRecords(records);
    const targetPath = join(this.config.resultsDir, this.config.resultFormat === "json" ? "records.json" : "records.csv");
    if (this.config.resultFormat === "json") {
      await writeJson(targetPath, ordered);
      return;
    }

    const allMetadataKeys = Array.from(new Set(ordered.flatMap((record) => Object.keys(record.metadata)))).sort((a, b) => a.localeCompare(b));
    const headers = [
      "bot",
      "runId",
      "id",
      "title",
      "sourcePage",
      ...allMetadataKeys.map((key) => `metadata.${key}`),
      "downloadUrl",
      "downloadStatus",
      "downloadAttempts",
      "downloadFile",
      "downloadReason",
      "bulkDownloadStatus",
      "bulkZipFile",
      "bulkUnzipStatus",
      "bulkUnzipDir",
    ];
    const rows = ordered.map((record) => {
      const metadataValues = allMetadataKeys.map((key) => record.metadata[key] ?? "");
      return [
        record.bot,
        record.runId,
        record.id,
        record.title,
        String(record.sourcePage),
        ...metadataValues,
        record.downloadUrl ?? "",
        record.downloadStatus,
        String(record.downloadAttempts),
        record.downloadFile ?? "",
        record.downloadReason ?? "",
        record.bulkDownloadStatus ?? "",
        record.bulkZipFile ?? "",
        record.bulkUnzipStatus ?? "",
        record.bulkUnzipDir ?? "",
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n");
    await writeFile(targetPath, `${csv}\n`, "utf8");
  }

}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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

function groupRecordsByPage(records: DocumentRecord[]): Array<[number, DocumentRecord[]]> {
  const map = new Map<number, DocumentRecord[]>();
  for (const record of records) {
    const page = record.sourcePage > 0 ? record.sourcePage : 1;
    const bucket = map.get(page);
    if (bucket) {
      bucket.push(record);
    } else {
      map.set(page, [record]);
    }
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}

function applyBulkOutcomeForPage(
  records: TransformedRecord[],
  page: number,
  outcome: {
    bulkDownloadStatus: "downloaded" | "failed" | "not_requested" | "not_applicable";
    bulkZipFile?: string;
    bulkUnzipStatus: "unzipped" | "unzip_failed" | "not_requested" | "not_applicable";
    bulkUnzipDir?: string;
  },
): void {
  for (const record of records) {
    if (record.sourcePage !== page) {
      continue;
    }
    if (record.bulkDownloadStatus === "not_applicable") {
      continue;
    }
    record.bulkDownloadStatus = outcome.bulkDownloadStatus;
    record.bulkZipFile = outcome.bulkZipFile;
    record.bulkUnzipStatus = outcome.bulkUnzipStatus;
    record.bulkUnzipDir = outcome.bulkUnzipDir;
  }
}

function sortTransformedRecords(records: TransformedRecord[]): TransformedRecord[] {
  return [...records].sort((a, b) => {
    const botOrder = a.bot.localeCompare(b.bot);
    if (botOrder !== 0) {
      return botOrder;
    }
    if (a.sourcePage !== b.sourcePage) {
      return a.sourcePage - b.sourcePage;
    }
    const titleOrder = a.title.localeCompare(b.title);
    if (titleOrder !== 0) {
      return titleOrder;
    }
    return a.id.localeCompare(b.id);
  });
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

function extractRecordsFromHtml(html: string, page: number): DocumentRecord[] {
  if (!html.trim()) {
    return [];
  }

  const $ = cheerio.load(html);
  const panel = $("#formBuscador\\:panel").first();
  if (panel.length === 0) {
    return [];
  }

  return parseDocumentsFromPanelHtml($.html(panel), page);
}

function hasPaginatorInHtml(html: string): boolean {
  if (!html.trim()) {
    return false;
  }

  const $ = cheerio.load(html);
  return $("#formBuscador\\:data1ds, [id*='data1ds'], .rf-ds, .rich-datascr").length > 0;
}

function isViewExpiredError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("ViewExpiredException");
}

function isRetryableInitError(error: unknown): boolean {
  if (isViewExpiredError(error)) {
    return true;
  }

  const status = getErrorStatus(error);
  if (typeof status !== "number") {
    return false;
  }

  return status === 408 || status === 429 || status >= 500;
}
