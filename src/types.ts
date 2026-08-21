export interface PortalState {
  formId: string;
  viewState: string;
}

export interface PartialUpdateMap {
  [updateId: string]: string;
}

export interface DocumentRecord {
  id: string;
  title: string;
  metadata: Record<string, string>;
  pdfHref?: string;
  sourcePage: number;
}

export interface FailedRecord {
  id: string;
  reason: string;
  attempts: number;
  pdfUrl?: string;
  timestamp: string;
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

export interface ScraperConfig {
  baseUrl: string;
  searchTerm: string;
  outputDir: string;
  dataDir: string;
  resume: boolean;
  failedOnly: boolean;
  maxRecords?: number;
  maxPages?: number;
}
