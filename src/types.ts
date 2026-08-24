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
  status: "downloaded" | "missing_link" | "failed";
  attempts: number;
  filePath?: string;
  reason?: string;
}

export interface ScrapeSummary {
  processed: number;
  downloaded: number;
  missingLink: number;
  failed: number;
  bulkZipDownloaded?: number;
}

export type ResultFormat = "csv" | "json";

export interface TransformedRecord {
  bot: string;
  runId: string;
  id: string;
  title: string;
  sourcePage: number;
  metadata: Record<string, string>;
  downloadUrl?: string;
  downloadStatus: "downloaded" | "missing_link" | "failed";
  downloadAttempts: number;
  downloadFile?: string;
  downloadReason?: string;
  bulkDownloadStatus?: "downloaded" | "failed" | "not_requested" | "not_applicable";
  bulkZipFile?: string;
  bulkUnzipStatus?: "unzipped" | "unzip_failed" | "not_requested" | "not_applicable";
  bulkUnzipDir?: string;
}

export interface ScraperConfig {
  baseUrl: string;
  searchTerm: string;
  bot: string;
  runId: string;
  runsDir: string;
  outputDir: string;
  resultsDir: string;
  bulkOutputDir: string;
  dataDir: string;
  resume: boolean;
  failedOnly: boolean;
  maxRecords?: number;
  maxPages?: number;
  requestTimeoutMs: number;
  requestDelayMs: number;
  requestJitterMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
  logFormat: "json" | "pretty";
  logFilePath?: string;
  downloadMode: "individual" | "bulk" | "both";
  resultFormat: ResultFormat;
  unzip: boolean;
  sessionKey: string;
  maxConsecutiveDownloadFailures: number;
  debugCaptureDir?: string;
}
