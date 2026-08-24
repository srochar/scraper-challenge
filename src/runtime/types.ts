import { BotJob } from "../botQueue";

export interface LatestPointer {
  runId: string;
  updatedAt: string;
}

export interface RuntimeDefaults {
  networkRps?: number;
  networkCooldownMs?: number;
  networkCooldownWindowMs?: number;
  networkCooldownThreshold?: number;
  networkMaxCooldownMs?: number;
  networkJitterRatio?: number;
  requestDelayMs?: number;
  requestJitterMs?: number;
  requestTimeoutMs?: number;
  downloadMode?: "individual" | "bulk" | "both";
  resultFormat?: "csv" | "json";
  unzip?: boolean;
  botConcurrency?: number;
  maxConsecutiveDownloadFailures?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
  logFormat?: "json" | "pretty";
}

export interface RuntimeConfigFile {
  defaults?: RuntimeDefaults;
  botJobs?: BotJob[];
  botGroups?: BotGroupConfig[];
}

export type BotGroupSearch =
  | string
  | {
    id?: string;
    term: string;
    maxPages?: number;
    maxRecords?: number;
  };

export interface BotGroupConfig {
  bot: string;
  maxPages?: number;
  maxRecords?: number;
  searchTerms: BotGroupSearch[];
}

export interface RunResultSource {
  path: string;
  bot: string;
  runId: string;
}
