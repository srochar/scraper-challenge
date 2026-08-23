import { Logger } from "../logging/logger";
import { NetworkDispatcher } from "../network/dispatcher";
import { PdfDownloadService } from "../download/pdfDownloadService";
import { PortalClient } from "../portal/client";
import { DocumentRecord, FailedRecord, RunStage } from "../types";
import { toSpanishErrorMessage } from "../utils/errorMessages";

export interface RequestExecutorOptions {
  sessionKey: string;
  searchTerm: string;
  portalClient: PortalClient;
  downloader: PdfDownloadService;
  logger?: Logger;
  dispatcher?: NetworkDispatcher;
  onError: (
    stage: RunStage,
    operation: string,
    error: unknown,
    context?: Record<string, unknown>,
  ) => Promise<void>;
}

export class RequestExecutor {
  constructor(private readonly options: RequestExecutorOptions) {}

  async executePortal<T>(
    stage: RunStage,
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await this.executeNetwork(operation, fn);
    } catch (error) {
      await this.options.onError(stage, operation, error, context);
      throw error;
    }
  }

  async executePortalInitWithRetry<T>(
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
          await this.options.onError(stage, operation, error, context);
          throw error;
        }

        const backoffMs = 600 * (attempt + 1);
        this.options.logger?.warn("Reintentando inicio por error transitorio", {
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

  async executePortalWithSessionRecovery<T>(
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
          await this.options.onError(stage, operation, error, context);
          throw error;
        }

        if (exhausted) {
          await this.options.onError(stage, operation, error, context);
          throw error;
        }

        if (retryableTransient && !shouldRecover) {
          const backoffMs = 600 * (attempt + 1);
          this.options.logger?.warn("Reintentando operacion por error transitorio", {
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

        this.options.logger?.warn("Recuperando sesion tras expiracion", {
          accion: "recuperar_sesion",
          stage,
          operation,
          recoveryAttempt: attempt + 1,
          maxRecoveryAttempts,
          ...(context ?? {}),
        });

        try {
          await this.executeNetwork("recover.submitSearchFromInicio", async () =>
            this.options.portalClient.submitSearchFromInicio(this.options.searchTerm),
          );

          if (operation !== "search") {
            await this.executeNetwork("recover.search", async () => this.options.portalClient.search(this.options.searchTerm));
          }
        } catch (recoveryError) {
          const backoffMs = 700 * (attempt + 1);
          this.options.logger?.warn("Fallo recuperacion de sesion; se reintentara", {
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

  async executeDownload(
    record: DocumentRecord,
    operation: string,
  ): Promise<{ result: { status: "downloaded" | "missing_link" | "failed"; attempts: number; filePath?: string; reason?: string }; failure?: FailedRecord }> {
    try {
      return await this.executeNetwork(operation, async () => this.options.downloader.download(record));
    } catch (error) {
      await this.options.onError("download", operation, error, {
        recordId: record.id,
        page: record.sourcePage,
        url: record.pdfHref,
      });
      throw error;
    }
  }

  private async executeNetwork<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (!this.options.dispatcher) {
      return fn();
    }
    return this.options.dispatcher.run(this.options.sessionKey, operation, fn);
  }
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
