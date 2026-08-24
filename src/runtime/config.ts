import { randomBytes } from "crypto";
import { join } from "path";
import { normalizeLogFormat, normalizeLogLevel } from "../logging/logger";
import { isHeaderRotationStrategy } from "../network/headerSelector";
import { ScraperConfig } from "../types";
import { stableHash } from "../utils/hash";
import { ensureDir, readJson, writeJson } from "../utils/fs";
import { LatestPointer } from "./types";

export const DEFAULT_BOT_CONCURRENCY = 2;
export const MAX_BOT_CONCURRENCY = 4;

export function parseArgs(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>();
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args.set(key, true);
      } else {
        args.set(key, next);
        i += 1;
      }
    }
  }

  return args;
}

export async function buildConfig(argv: string[]): Promise<ScraperConfig> {
  const args = parseArgs(argv);
  if (args.has("config")) {
    throw new Error("--config is no longer supported. Use direct CLI flags instead.");
  }
  return buildConfigFromArgs(args);
}

export async function buildConfigFromArgs(
  args: Map<string, string | boolean>,
  overrides?: Partial<{ bot: string; searchTerm: string; maxPages: number; maxRecords: number; runId: string }>,
): Promise<ScraperConfig> {
  const bot = sanitizeBotName(overrides?.bot ?? (args.get("bot") as string | undefined) ?? "default");
  const runsDir = (args.get("runs-dir") as string | undefined) ?? join(process.cwd(), "runs");
  const latestPath = join(runsDir, bot, "latest.json");
  const shouldReuseLatest = Boolean(args.get("resume") || args.get("failed-only"));
  const explicitRunId = overrides?.runId ?? ((args.get("run-id") as string | undefined) ?? undefined);
  const latest = shouldReuseLatest ? await readJson<LatestPointer>(latestPath) : undefined;
  if ((args.get("resume") || args.get("failed-only")) && !explicitRunId && !latest?.runId) {
    throw new Error(`No latest run found for bot '${bot}'. Provide --run-id or run a fresh scrape first.`);
  }
  const runId = explicitRunId ?? latest?.runId ?? generateRunId();

  const runRoot = join(runsDir, bot, runId);
  const dataDir = (args.get("data-dir") as string | undefined) ?? runRoot;
  const outputDir = (args.get("output-dir") as string | undefined) ?? join(runRoot, "artifacts", "pdfs");
  const resultsDir = join(runRoot, "results");
  const bulkOutputDir = join(runRoot, "artifacts", "bulk");
  const debugCaptureDir = join(runRoot, "debug", "http-captures");
  const logFilePath = (args.get("log-file") as string | undefined) ?? join(runRoot, "logs.jsonl");
  const baseUrl =
    (args.get("base-url") as string) ??
    "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb";
  const searchTerm = overrides?.searchTerm ?? (args.get("search") as string) ?? "civil";
  const sessionKey = buildSessionKey(baseUrl, bot, searchTerm);

  await ensureDir(join(runsDir, bot));
  await writeJson(latestPath, { runId, updatedAt: new Date().toISOString() } as LatestPointer);

  const resultFormat = resolveResultFormat(args.get("result-format"), undefined);
  const headerRotationEnabled = resolveBooleanArg(args, "header-rotation", undefined, false);
  const headerRotationStrategy = resolveHeaderRotationStrategy(args.get("header-rotation-strategy"), headerRotationEnabled);
  const headerProfileId = resolveOptionalStringArg(args.get("header-profile-id"));

  return {
    baseUrl,
    searchTerm,
    bot,
    runId,
    runsDir,
    outputDir,
    resultsDir,
    bulkOutputDir,
    dataDir,
    resume: Boolean(args.get("resume")),
    failedOnly: Boolean(args.get("failed-only")),
    maxRecords: overrides?.maxRecords ?? (args.get("max-records") ? Number(args.get("max-records")) : undefined),
    maxPages: overrides?.maxPages ?? (args.get("max-pages") ? Number(args.get("max-pages")) : undefined),
    requestTimeoutMs: resolveNumberArg(args, "request-timeout-ms", undefined, 30_000),
    requestDelayMs: resolveNumberArg(args, "request-delay-ms", undefined, 0),
    requestJitterMs: resolveNumberArg(args, "request-jitter-ms", undefined, 0),
    logLevel: normalizeLogLevel(args.get("log-level") as string | undefined),
    logFormat: normalizeLogFormat(args.get("log-format") as string | undefined),
    logFilePath,
    downloadMode: (((args.get("download-mode") as string | undefined) ?? "individual")) as
      | "individual"
      | "bulk"
      | "both",
    resultFormat,
    unzip: resolveBooleanArg(args, "unzip", undefined, false),
    sessionKey,
    maxConsecutiveDownloadFailures: resolveNumberArg(
      args,
      "max-consecutive-download-failures",
      undefined,
      0,
    ),
    duplicate429WindowMs: resolveNumberArg(args, "duplicate-429-window-ms", undefined, 30_000),
    duplicate429Threshold: resolveNumberArg(args, "duplicate-429-threshold", undefined, 3),
    debugCaptureDir,
    headerRotationEnabled,
    headerRotationStrategy,
    headerProfileId,
  };
}

export function resolveNumberArg(
  args: Map<string, string | boolean>,
  key: string,
  defaultValue: number | undefined,
  fallback: number,
): number {
  const fromCli = args.get(key);
  if (typeof fromCli === "string") {
    return Number(fromCli);
  }
  if (typeof defaultValue === "number") {
    return defaultValue;
  }
  return fallback;
}

export function normalizeBotConcurrency(raw: number): number {
  if (!Number.isFinite(raw)) {
    return DEFAULT_BOT_CONCURRENCY;
  }
  return Math.max(1, Math.min(MAX_BOT_CONCURRENCY, Math.floor(raw)));
}

export function resolveBotConcurrency(
  args: Map<string, string | boolean>,
): { requested: number; effective: number } {
  const requested = resolveNumberArg(args, "bot-concurrency", undefined, DEFAULT_BOT_CONCURRENCY);
  return {
    requested,
    effective: normalizeBotConcurrency(requested),
  };
}

export function resolveBooleanArg(
  args: Map<string, string | boolean>,
  key: string,
  defaultValue: boolean | undefined,
  fallback: boolean,
): boolean {
  const fromCli = args.get(key);
  if (typeof fromCli === "boolean") {
    return fromCli;
  }
  if (typeof fromCli === "string") {
    const normalized = fromCli.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    return Boolean(normalized);
  }
  if (typeof defaultValue === "boolean") {
    return defaultValue;
  }
  return fallback;
}

export function resolveResultFormat(
  fromCli: string | boolean | undefined,
  fromDefault: "csv" | "json" | undefined,
): "csv" | "json" {
  const raw = fromCli ?? fromDefault ?? "csv";
  if (typeof raw !== "string") {
    throw new Error("Unsupported result format. Use --result-format csv|json.");
  }
  const normalized = raw.toLowerCase();
  if (normalized !== "json" && normalized !== "csv") {
    throw new Error(`Unsupported result format '${normalized}'. Use --result-format csv|json.`);
  }
  return normalized;
}

function resolveHeaderRotationStrategy(
  value: string | boolean | undefined,
  enabled: boolean,
): "off" | "per-run" | "per-request" {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (isHeaderRotationStrategy(normalized)) {
      return normalized;
    }
    throw new Error(`Unsupported header rotation strategy '${normalized}'. Use --header-rotation-strategy off|per-run|per-request.`);
  }
  return enabled ? "per-run" : "off";
}

function resolveOptionalStringArg(value: string | boolean | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseLooseBotJobs(input: string): unknown {
  const trimmed = input.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error("--bot-jobs must be a JSON array");
  }
  const body = trimmed.slice(1, -1).trim();
  if (!body) {
    return [];
  }

  const chunks = body
    .split(/\}\s*,\s*\{/)
    .map((part, index, all) => {
      if (index === 0) {
        return part.replace(/^\s*\{/, "");
      }
      if (index === all.length - 1) {
        return part.replace(/\}\s*$/, "");
      }
      return part;
    })
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return chunks.map((chunk) => {
    const obj: Record<string, unknown> = {};
    const pairs = chunk.split(",");
    for (const pairRaw of pairs) {
      const pair = pairRaw.trim();
      if (!pair) {
        continue;
      }
      const colonIndex = pair.indexOf(":");
      if (colonIndex <= 0) {
        continue;
      }
      const key = pair.slice(0, colonIndex).trim().replace(/^['"]|['"]$/g, "");
      const rawValue = pair.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
        obj[key] = Number(rawValue);
      } else if (rawValue.toLowerCase() === "true" || rawValue.toLowerCase() === "false") {
        obj[key] = rawValue.toLowerCase() === "true";
      } else {
        obj[key] = rawValue;
      }
    }
    return obj;
  });
}

export function buildSessionKey(baseUrl: string, bot: string, searchTerm: string): string {
  const normalized = `${baseUrl.toLowerCase()}|${bot.toLowerCase()}|${searchTerm.trim().toLowerCase()}`;
  return `${bot}:${stableHash(normalized).slice(0, 12)}`;
}

export function sanitizeBotName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "default";
}

export function generateRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}_${randomBytes(3).toString("hex")}`;
}
