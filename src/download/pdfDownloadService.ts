import { basename, extname, join } from "path";
import { writeFile } from "fs/promises";
import axios, { AxiosInstance } from "axios";
import { Logger } from "../logging/logger";
import { HeaderSelector } from "../network/headerSelector";
import { DocumentRecord, DownloadResult, FailedRecord, RetryConfig, RetryDependencies } from "../types";
import { executeWithRetry, shouldRetryStatus } from "../retry/retryPolicy";
import { ensureDir, fileExists } from "../utils/fs";
import { toSpanishErrorMessage } from "../utils/errorMessages";
import { normalizeCanonicalPdfUrl } from "./canonicalPdfUrl";

export interface PdfDownloadServiceOptions {
  outputDir: string;
  retryConfig: RetryConfig;
  retryDeps?: RetryDependencies;
  headerSelector?: HeaderSelector;
}

export interface DownloadAttemptSignal {
  attempt: number;
  delayMs: number;
  status?: number;
  url?: string;
  canonicalUrl?: string;
}

export interface DownloadCallOptions {
  onRetrySignal?: (signal: DownloadAttemptSignal) => void;
}

export class PdfDownloadService {
  private readonly axios: AxiosInstance;
  private readonly outputDir: string;
  private readonly retryConfig: RetryConfig;
  private readonly retryDeps: RetryDependencies;
  private readonly logger?: Logger;
  private readonly headerSelector: HeaderSelector;

  constructor(options: PdfDownloadServiceOptions, axiosInstance?: AxiosInstance, logger?: Logger) {
    this.outputDir = options.outputDir;
    this.retryConfig = options.retryConfig;
    this.retryDeps =
      options.retryDeps ?? {
        wait: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
        random: () => Math.random(),
      };
    this.headerSelector = options.headerSelector ?? new HeaderSelector({
      enabled: false,
      strategy: "off",
      sessionKey: "default",
    });
    this.axios = axiosInstance ?? axios.create({
      responseType: "arraybuffer",
    });
    this.logger = logger;
  }

  async download(record: DocumentRecord, options?: DownloadCallOptions): Promise<{ result: DownloadResult; failure?: FailedRecord }> {
    if (!record.pdfHref) {
      this.logger?.warn("Registro sin enlace PDF", { accion: "descarga", recordId: record.id });
      return {
        result: {
          status: "missing_link",
          attempts: 0,
          reason: "missing_link",
        },
      };
    }

    await ensureDir(this.outputDir);
    const path = join(this.outputDir, buildPdfFileName(record));
    if (await fileExists(path)) {
      this.logger?.info("PDF ya existe, se omite descarga", { accion: "descarga", recordId: record.id });
      return {
        result: {
          status: "downloaded",
          attempts: 0,
          filePath: path,
        },
      };
    }

    const outcome = await executeWithRetry(
      async () => {
        this.logger?.debug("Downloading PDF", { recordId: record.id, url: record.pdfHref });
        const response = await this.axios.get<ArrayBuffer>(record.pdfHref as string, {
          responseType: "arraybuffer",
          headers: this.headerSelector.select("pdf-download"),
        });
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
      {
        ...this.retryDeps,
        onRetry: ({ attempt, delayMs, error }) => {
          const status = getErrorStatus(error);
          options?.onRetrySignal?.({
            attempt,
            delayMs,
            status,
            url: record.pdfHref,
            canonicalUrl: normalizeCanonicalPdfUrl(record.pdfHref),
          });
        },
      },
    );

    if (!outcome.success || !outcome.value) {
      const reason = normalizeReason(outcome.lastError);
      this.logger?.error("Fallo la descarga PDF tras reintentos", {
        accion: "descarga",
        recordId: record.id,
        attempts: outcome.attempts,
        reason: toSpanishErrorMessage(reason),
      });
      const failure: FailedRecord = {
        id: record.id,
        reason,
        attempts: outcome.attempts,
        pdfUrl: record.pdfHref,
        canonicalPdfUrl: normalizeCanonicalPdfUrl(record.pdfHref),
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
    this.logger?.info("PDF descargado", {
      accion: "descarga",
      recordId: record.id,
      attempts: outcome.attempts,
      archivo: basename(path),
    });
    return {
      result: {
        status: "downloaded",
        attempts: outcome.attempts,
        filePath: path,
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
