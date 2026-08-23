import { basename, join, relative } from "path";
import { writeFile } from "fs/promises";
import { extractZipToSiblingFolder } from "../download/zipExtractor";
import { DocumentRecord, RunStage, ScraperConfig, TransformedRecord } from "../types";
import { Logger } from "../logging/logger";

export interface BulkPipelineParams {
  selected: DocumentRecord[];
  transformedRecords: TransformedRecord[];
  config: ScraperConfig;
  logger?: Logger;
  pace: (operation: string, context?: Record<string, unknown>) => Promise<void>;
  safePortal: <T>(
    stage: RunStage,
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
  ) => Promise<T>;
  recordError: (
    stage: RunStage,
    operation: string,
    error: unknown,
    context?: Record<string, unknown>,
  ) => Promise<void>;
  downloadBulkZip: (records: Array<{ bulkFieldName?: string }>, searchTerm: string, page: number) => Promise<Buffer | undefined>;
}

export interface BulkPipelineResult {
  bulkZipDownloaded: number;
}

export async function processBulkPipeline(params: BulkPipelineParams): Promise<BulkPipelineResult> {
  const {
    selected,
    transformedRecords,
    config,
    logger,
    pace,
    safePortal,
    recordError,
    downloadBulkZip,
  } = params;

  let bulkZipDownloaded = 0;
  const selectedByPage = groupRecordsByPage(selected.filter((record) => Boolean(record.bulkFieldName)));
  logger?.info("Bulk page grouping prepared", {
    accion: "bulk_preparado",
    pages: selectedByPage.map(([page, pageRecords]) => ({ page, selected: pageRecords.length })),
  });

  for (const [page, pageRecords] of selectedByPage) {
    await pace("bulk.download", { selectedCount: pageRecords.length, page });
    let zipData: Buffer | undefined;
    try {
      zipData = await safePortal(
        "bulk",
        "downloadBulkZip",
        async () => downloadBulkZip(pageRecords, config.searchTerm, page),
        { selectedCount: pageRecords.length, page },
      );
    } catch {
      applyBulkOutcomeForPage(transformedRecords, page, {
        bulkDownloadStatus: "failed",
        bulkUnzipStatus: config.unzip ? "unzip_failed" : "not_requested",
      });
      continue;
    }

    if (!zipData) {
      applyBulkOutcomeForPage(transformedRecords, page, {
        bulkDownloadStatus: "failed",
        bulkUnzipStatus: config.unzip ? "unzip_failed" : "not_requested",
      });
      continue;
    }

    const zipPath = join(config.bulkOutputDir, `Resoluciones_Jurisprudencia_page-${page}_${Date.now()}.zip`);
    try {
      await writeFile(zipPath, zipData);
    } catch (error) {
      await recordError("bulk", "writeBulkZip", error, { zipPath, page });
      throw error;
    }

    bulkZipDownloaded += 1;
    const zipRelativePath = toRelativeRunPath(config.dataDir, zipPath);
    let bulkUnzipStatus: "unzipped" | "unzip_failed" | "not_requested" = "not_requested";
    let bulkUnzipDir: string | undefined;
    logger?.info("ZIP masivo descargado", {
      accion: "descarga_zip",
      archivo: basename(zipPath),
      selectedCount: pageRecords.length,
      page,
    });

    if (config.unzip) {
      try {
        const extractedDir = await extractZipToSiblingFolder(zipPath);
        bulkUnzipStatus = "unzipped";
        bulkUnzipDir = toRelativeRunPath(config.dataDir, extractedDir);
        logger?.info("ZIP masivo descomprimido", {
          accion: "descomprimir_zip",
          archivo: basename(zipPath),
          destino: extractedDir,
        });
      } catch (error) {
        bulkUnzipStatus = "unzip_failed";
        await recordError("bulk", "unzip.bulk", error, { zipPath, page });
      }
    }

    applyBulkOutcomeForPage(transformedRecords, page, {
      bulkDownloadStatus: "downloaded",
      bulkZipFile: zipRelativePath,
      bulkUnzipStatus,
      bulkUnzipDir,
    });
  }

  return { bulkZipDownloaded };
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

function toRelativeRunPath(runRoot: string, filePath: string): string {
  return relative(runRoot, filePath).split("\\").join("/");
}
