import { dirname, join } from "path";
import { FailedRecord, RunErrorEvent, ScrapeSummary, ScraperConfig } from "./types";
import { appendJsonLine, ensureDir, readJson, readJsonLines, writeJson } from "./utils/fs";

export interface ProgressState {
  page: number;
  processedIds: string[];
  updatedAt: string;
}

export interface RunManifest {
  runId: string;
  bot: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  config: {
    searchTerm: string;
    maxRecords?: number;
    maxPages?: number;
    requestDelayMs?: number;
    requestJitterMs?: number;
    downloadMode: "individual" | "bulk" | "both";
  };
  summary?: ScrapeSummary;
}

export interface RunStorePaths {
  runRoot: string;
  progressPath: string;
  failuresPath: string;
  errorsPath: string;
  recordsPath: string;
  logsPath: string;
  manifestPath: string;
}

export class RunStore {
  private readonly paths: RunStorePaths;

  constructor(paths: RunStorePaths) {
    this.paths = paths;
  }

  async initialize(): Promise<void> {
    await ensureDir(dirname(this.paths.progressPath));
    await ensureDir(dirname(this.paths.failuresPath));
    await ensureDir(dirname(this.paths.errorsPath));
    await ensureDir(dirname(this.paths.recordsPath));
    await ensureDir(dirname(this.paths.logsPath));
    await ensureDir(dirname(this.paths.manifestPath));
  }

  async readProgress(): Promise<ProgressState | undefined> {
    return readJson<ProgressState>(this.paths.progressPath);
  }

  async writeProgress(progress: ProgressState): Promise<void> {
    await writeJson(this.paths.progressPath, progress);
  }

  async appendFailure(failure: FailedRecord): Promise<void> {
    await appendJsonLine(this.paths.failuresPath, failure);
  }

  async readFailures(): Promise<FailedRecord[]> {
    return readJsonLines<FailedRecord>(this.paths.failuresPath);
  }

  async appendError(event: RunErrorEvent): Promise<void> {
    await appendJsonLine(this.paths.errorsPath, event);
  }

  async writeManifest(manifest: RunManifest): Promise<void> {
    await writeJson(this.paths.manifestPath, manifest);
  }

  async readManifest(): Promise<RunManifest | undefined> {
    return readJson<RunManifest>(this.paths.manifestPath);
  }

  getPaths(): RunStorePaths {
    return {
      ...this.paths,
    };
  }
}

export function buildRunStorePaths(runRoot: string): RunStorePaths {
  return {
    runRoot,
    progressPath: join(runRoot, "progress.json"),
    failuresPath: join(runRoot, "failed.jsonl"),
    errorsPath: join(runRoot, "errors.jsonl"),
    recordsPath: join(runRoot, "records.jsonl"),
    logsPath: join(runRoot, "logs.jsonl"),
    manifestPath: join(runRoot, "manifest.json"),
  };
}

export function buildInitialManifest(config: ScraperConfig): RunManifest {
  return {
    runId: config.runId,
    bot: config.bot,
    startedAt: new Date().toISOString(),
    status: "running",
    config: {
      searchTerm: config.searchTerm,
      maxRecords: config.maxRecords,
      maxPages: config.maxPages,
      requestDelayMs: config.requestDelayMs,
      requestJitterMs: config.requestJitterMs,
      downloadMode: config.downloadMode,
    },
  };
}
