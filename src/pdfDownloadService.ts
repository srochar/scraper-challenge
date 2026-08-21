import { basename, extname, join } from "path";
import { writeFile } from "fs/promises";
import axios, { AxiosInstance } from "axios";
import { Logger } from "./logger";
import { DocumentRecord, DownloadResult, FailedRecord, RetryConfig, RetryDependencies } from "./types";
import { executeWithRetry, shouldRetryStatus } from "./retryPolicy";
import { ensureDir, fileExists } from "./utils/fs";

export interface PdfDownloadServiceOptions {
  outputDir: string;
  retryConfig: RetryConfig;
  retryDeps?: RetryDependencies;
}

export class PdfDownloadService {
  private readonly axios: AxiosInstance;
  private readonly outputDir: string;
  private readonly retryConfig: RetryConfig;
  private readonly retryDeps: RetryDependencies;
  private readonly logger?: Logger;

  constructor(options: PdfDownloadServiceOptions, axiosInstance?: AxiosInstance, logger?: Logger) {
    this.outputDir = options.outputDir;
    this.retryConfig = options.retryConfig;
    this.retryDeps =
      options.retryDeps ?? {
        wait: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
        random: () => Math.random(),
      };
    this.axios = axiosInstance ?? axios.create({ responseType: "arraybuffer" });
    this.logger = logger;
  }

  async download(record: DocumentRecord): Promise<{ result: DownloadResult; failure?: FailedRecord }> {
    if (!record.pdfHref) {
      this.logger?.warn("Missing PDF link for record", { recordId: record.id, title: record.title });
      return {
        result: {
          status: "missing_pdf",
          attempts: 0,
          reason: "missing_pdf",
        },
      };
    }

    await ensureDir(this.outputDir);
    const path = join(this.outputDir, buildPdfFileName(record));
    if (await fileExists(path)) {
      this.logger?.info("PDF already exists, skipping download", { recordId: record.id, path });
      return {
        result: {
          status: "downloaded",
          attempts: 0,
          pdfPath: path,
        },
      };
    }

    const outcome = await executeWithRetry(
      async () => {
        this.logger?.debug("Downloading PDF", { recordId: record.id, url: record.pdfHref });
        const response = await this.axios.get<ArrayBuffer>(record.pdfHref as string, { responseType: "arraybuffer" });
        if (response.status >= 400) {
          const err = new Error(`HTTP_${response.status}`);
          (err as Error & { status?: number }).status = response.status;
          throw err;
        }
        return Buffer.from(response.data);
      },
      (error) => {
        const status = getErrorStatus(error);
        return status ? shouldRetryStatus(status) : true;
      },
      this.retryConfig,
      this.retryDeps,
    );

    if (!outcome.success || !outcome.value) {
      const reason = normalizeReason(outcome.lastError);
      this.logger?.error("PDF download failed after retries", {
        recordId: record.id,
        attempts: outcome.attempts,
        reason,
      });
      const failure: FailedRecord = {
        id: record.id,
        reason,
        attempts: outcome.attempts,
        pdfUrl: record.pdfHref,
        timestamp: new Date().toISOString(),
      };

      return {
        result: {
          status: "failed",
          attempts: outcome.attempts,
          reason,
        },
        failure,
      };
    }

    await writeFile(path, outcome.value);
    this.logger?.info("PDF downloaded", {
      recordId: record.id,
      attempts: outcome.attempts,
      path,
    });
    return {
      result: {
        status: "downloaded",
        attempts: outcome.attempts,
        pdfPath: path,
      },
    };
  }

}

export function buildPdfFileName(record: DocumentRecord): string {
  const titlePart = sanitizeFileName(record.title).slice(0, 80) || `document-${record.id}`;
  const sourceName = record.pdfHref ? basename(record.pdfHref.split("?")[0]) : "";
  const extension = extname(sourceName).toLowerCase() === ".pdf" ? ".pdf" : ".pdf";
  return `${titlePart}-${record.id}${extension}`;
}

function sanitizeFileName(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\-_. ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  if (axios.isAxiosError(error) && error.response?.status) {
    return error.response.status;
  }
  return undefined;
}

function normalizeReason(error: unknown): string {
  const status = getErrorStatus(error);
  if (status === 429) {
    return "http_429";
  }
  if (typeof status === "number") {
    return `http_${status}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown_error";
}
