import { randomBytes } from "crypto";
import { readFile } from "fs/promises";
import { isAbsolute, join, resolve } from "path";
import { BotJob } from "../botQueue";
import { normalizeLogFormat, normalizeLogLevel } from "../logging/logger";
import { ScraperConfig } from "../types";
import { stableHash } from "../utils/hash";
import { ensureDir, readJson, writeJson } from "../utils/fs";
import { LatestPointer, RuntimeConfigFile, RuntimeDefaults } from "./types";

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
  const runtimeConfig = await loadRuntimeConfig(args.get("config") as string | undefined);
  return buildConfigFromArgs(args, undefined, runtimeConfig.defaults);
}

export async function buildConfigFromArgs(
  args: Map<string, string | boolean>,
  overrides?: Partial<{ bot: string; searchTerm: string; maxPages: number; maxRecords: number; runId: string }>,
  defaults?: RuntimeDefaults,
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

  const resultFormat = resolveResultFormat(args.get("result-format"), defaults?.resultFormat);

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
    requestDelayMs: resolveNumberArg(args, "request-delay-ms", defaults?.requestDelayMs, 0),
    requestJitterMs: resolveNumberArg(args, "request-jitter-ms", defaults?.requestJitterMs, 0),
    logLevel: normalizeLogLevel((args.get("log-level") as string | undefined) ?? defaults?.logLevel),
    logFormat: normalizeLogFormat((args.get("log-format") as string | undefined) ?? defaults?.logFormat),
    logFilePath,
    downloadMode: (((args.get("download-mode") as string | undefined) ?? defaults?.downloadMode ?? "individual")) as
      | "individual"
      | "bulk"
      | "both",
    resultFormat,
    unzip: resolveBooleanArg(args, "unzip", defaults?.unzip, false),
    sessionKey,
    maxConsecutiveDownloadFailures: resolveNumberArg(
      args,
      "max-consecutive-download-failures",
      defaults?.maxConsecutiveDownloadFailures,
      0,
    ),
    debugCaptureDir,
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

export async function loadRuntimeConfig(configPath: string | undefined): Promise<RuntimeConfigFile> {
  const resolvedPath = resolveConfigPath(configPath);
  if (!resolvedPath) {
    return {};
  }

  let parsed: unknown;
  try {
    const content = await readFile(resolvedPath, "utf8");
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config file '${resolvedPath}': ${reason}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid config file '${resolvedPath}': expected a JSON object`);
  }

  const config = parsed as RuntimeConfigFile;
  const defaults = config.defaults;
  if (defaults && typeof defaults !== "object") {
    throw new Error(`Invalid config file '${resolvedPath}': defaults must be an object`);
  }
  if (defaults?.resultFormat !== undefined && typeof defaults.resultFormat !== "string") {
    throw new Error(`Invalid config file '${resolvedPath}': defaults.resultFormat must be a string`);
  }
  if (config.botJobs && !Array.isArray(config.botJobs)) {
    throw new Error(`Invalid config file '${resolvedPath}': botJobs must be an array`);
  }
  if (config.botGroups && !Array.isArray(config.botGroups)) {
    throw new Error(`Invalid config file '${resolvedPath}': botGroups must be an array`);
  }
  if (config.botJobs) {
    config.botJobs.forEach((job, index) => {
      if (typeof job !== "object" || !job) {
        throw new Error(`Invalid config file '${resolvedPath}': botJobs[${index}] must be an object`);
      }
      if (typeof job.bot !== "string" || typeof job.searchTerm !== "string") {
        throw new Error(`Invalid config file '${resolvedPath}': botJobs[${index}] requires string bot and searchTerm`);
      }
      if (job.id !== undefined && typeof job.id !== "string") {
        throw new Error(`Invalid config file '${resolvedPath}': botJobs[${index}].id must be a string`);
      }
      if (job.maxPages !== undefined && typeof job.maxPages !== "number") {
        throw new Error(`Invalid config file '${resolvedPath}': botJobs[${index}].maxPages must be a number`);
      }
      if (job.maxRecords !== undefined && typeof job.maxRecords !== "number") {
        throw new Error(`Invalid config file '${resolvedPath}': botJobs[${index}].maxRecords must be a number`);
      }
    });
  }
  if (config.botGroups) {
    config.botGroups.forEach((group, index) => {
      if (typeof group !== "object" || !group) {
        throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}] must be an object`);
      }
      if (typeof group.bot !== "string") {
        throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].bot must be a string`);
      }
      if (!Array.isArray(group.searchTerms) || group.searchTerms.length === 0) {
        throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].searchTerms must be a non-empty array`);
      }
      if (group.maxPages !== undefined && typeof group.maxPages !== "number") {
        throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].maxPages must be a number`);
      }
      if (group.maxRecords !== undefined && typeof group.maxRecords !== "number") {
        throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].maxRecords must be a number`);
      }
      group.searchTerms.forEach((entry, entryIndex) => {
        if (typeof entry === "string") {
          if (!entry.trim()) {
            throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].searchTerms[${entryIndex}] cannot be empty`);
          }
          return;
        }
        if (!entry || typeof entry !== "object") {
          throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].searchTerms[${entryIndex}] must be a string or object`);
        }
        if (typeof entry.term !== "string" || !entry.term.trim()) {
          throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].searchTerms[${entryIndex}].term must be a non-empty string`);
        }
        if (entry.id !== undefined && typeof entry.id !== "string") {
          throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].searchTerms[${entryIndex}].id must be a string`);
        }
        if (entry.maxPages !== undefined && typeof entry.maxPages !== "number") {
          throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].searchTerms[${entryIndex}].maxPages must be a number`);
        }
        if (entry.maxRecords !== undefined && typeof entry.maxRecords !== "number") {
          throw new Error(`Invalid config file '${resolvedPath}': botGroups[${index}].searchTerms[${entryIndex}].maxRecords must be a number`);
        }
      });
    });
  }

  return config;
}

export function expandConfigBotJobs(config: RuntimeConfigFile): BotJob[] {
  const explicit = config.botJobs ?? [];
  const fromGroups = (config.botGroups ?? []).flatMap((group) => {
    const bot = group.bot;
    return group.searchTerms.map((entry, index) => {
      if (typeof entry === "string") {
        return {
          id: `${bot}-${index + 1}`,
          bot,
          searchTerm: entry,
          maxPages: group.maxPages,
          maxRecords: group.maxRecords,
        } satisfies BotJob;
      }

      return {
        id: entry.id ?? `${bot}-${index + 1}`,
        bot,
        searchTerm: entry.term,
        maxPages: entry.maxPages ?? group.maxPages,
        maxRecords: entry.maxRecords ?? group.maxRecords,
      } satisfies BotJob;
    });
  });

  return [...explicit, ...fromGroups];
}

function resolveConfigPath(configPath: string | undefined): string | undefined {
  const input = configPath?.trim();
  if (!input) {
    return undefined;
  }
  return isAbsolute(input) ? input : resolve(process.cwd(), input);
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
