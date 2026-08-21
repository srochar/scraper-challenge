import { dirname, join } from "path";
import { FailedRecord } from "./types";
import { appendJsonLine, ensureDir, readJson, readJsonLines, writeJson } from "./utils/fs";

export interface ProgressState {
  page: number;
  processedIds: string[];
  updatedAt: string;
}

export class RunStore {
  private readonly progressPath: string;
  private readonly failuresPath: string;

  constructor(dataDir: string) {
    this.progressPath = join(dataDir, "progress.json");
    this.failuresPath = join(dataDir, "failed.jsonl");
  }

  async initialize(): Promise<void> {
    await ensureDir(dirname(this.progressPath));
  }

  async readProgress(): Promise<ProgressState | undefined> {
    return readJson<ProgressState>(this.progressPath);
  }

  async writeProgress(progress: ProgressState): Promise<void> {
    await writeJson(this.progressPath, progress);
  }

  async appendFailure(failure: FailedRecord): Promise<void> {
    await appendJsonLine(this.failuresPath, failure);
  }

  async readFailures(): Promise<FailedRecord[]> {
    return readJsonLines<FailedRecord>(this.failuresPath);
  }

  getPaths(): { progressPath: string; failuresPath: string } {
    return {
      progressPath: this.progressPath,
      failuresPath: this.failuresPath,
    };
  }
}
