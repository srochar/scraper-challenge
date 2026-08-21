export interface PortalState {
  formId: string;
  viewState: string;
  formDefaults: Record<string, string>;
  bulkSubmitField?: string;
}

export interface PartialUpdateMap {
  [updateId: string]: string;
}

export interface DocumentRecord {
  id: string;
  title: string;
  metadata: Record<string, string>;
  pdfHref?: string;
  bulkFieldName?: string;
  sourcePage: number;
}

export interface FailedRecord {
  id: string;
  reason: string;
  attempts: number;
  pdfUrl?: string;
  timestamp: string;
}

export type RunStage =
  | "init"
  | "search"
  | "paginate"
  | "process"
  | "download"
  | "bulk"
  | "finalize"
  | "main";

export interface RunErrorEvent {
  timestamp: string;
  runId: string;
  bot: string;
  stage: RunStage;
  operation: string;
  errorName: string;
  errorMessage: string;
  stack?: string;
  recordId?: string;
  page?: number;
  url?: string;
  statusCode?: number;
  attempt?: number;
  retryable?: boolean;
  context?: Record<string, unknown>;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export interface RetryDependencies {
  wait: (ms: number) => Promise<void>;
  random: () => number;
}

export interface DownloadResult {
  status: "downloaded" | "missing_pdf" | "failed";
  attempts: number;
  pdfPath?: string;
  reason?: string;
}

export interface ScrapeSummary {
  processed: number;
  downloaded: number;
  missingPdf: number;
  failed: number;
  bulkZipDownloaded?: number;
}

export interface ScraperConfig {
  baseUrl: string;
  searchTerm: string;
  bot: string;
  runId: string;
  runsDir: string;
  outputDir: string;
  bulkOutputDir: string;
  dataDir: string;
  resume: boolean;
  failedOnly: boolean;
  maxRecords?: number;
  maxPages?: number;
  requestDelayMs: number;
  requestJitterMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
  logFormat: "json" | "pretty";
  logFilePath?: string;
  downloadMode: "individual" | "bulk" | "both";
}
