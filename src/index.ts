import { isAbsolute, join, resolve } from "path";
import { randomBytes } from "crypto";
import { readFile } from "fs/promises";
import { PortalClient } from "./portalClient";
import { PdfDownloadService } from "./pdfDownloadService";
import { BotJob } from "./botQueue";
import { buildInitialManifest, buildRunStorePaths, RunStore } from "./runStore";
import { ScrapeOrchestrator } from "./scrapeOrchestrator";
import { RetryConfig, RunErrorEvent, ScraperConfig } from "./types";
import { createLogger, normalizeLogFormat, normalizeLogLevel } from "./logger";
import { NetworkDispatcher } from "./networkDispatcher";
import { stableHash } from "./utils/hash";
import { ensureDir, readJson, writeJson } from "./utils/fs";
import { toSpanishErrorMessage } from "./utils/errorMessages";

export interface LatestPointer {
  runId: string;
  updatedAt: string;
}

export interface FatalErrorPayload {
  type: "fatal";
  stage: "main";
  operation: string;
  errorName: string;
  errorMessage: string;
  runId?: string;
  bot?: string;
}

interface RuntimeDefaults {
  networkRps?: number;
  networkCooldownMs?: number;
  networkCooldownWindowMs?: number;
  networkCooldownThreshold?: number;
  networkMaxCooldownMs?: number;
  networkJitterRatio?: number;
  requestDelayMs?: number;
  requestJitterMs?: number;
  downloadMode?: "individual" | "bulk" | "both";
  botConcurrency?: number;
  maxConsecutiveDownloadFailures?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
  logFormat?: "json" | "pretty";
}

interface RuntimeConfigFile {
  defaults?: RuntimeDefaults;
  botJobs?: BotJob[];
  botGroups?: BotGroupConfig[];
}

type BotGroupSearch = string | {
  id?: string;
  term: string;
  maxPages?: number;
  maxRecords?: number;
};

interface BotGroupConfig {
  bot: string;
  maxPages?: number;
  maxRecords?: number;
  searchTerms: BotGroupSearch[];
}

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const runtimeConfig = await loadRuntimeConfig(args.get("config") as string | undefined);
  const dispatcher = createDispatcher(args, runtimeConfig.defaults);
  const jobs = parseBotJobs(
    args.get("bot-jobs") as string | undefined,
    expandConfigBotJobs(runtimeConfig),
  );

  if (jobs.length === 0) {
    const config = await buildConfigFromArgs(args, undefined, runtimeConfig.defaults);
    try {
      await runSingleConfig(config, dispatcher);
    } catch (error) {
      process.stderr.write(`${JSON.stringify(toFatalErrorPayload(error, "main", {
        runId: config.runId,
        bot: config.bot,
      }))}\n`);
      process.exit(1);
    }
    return;
  }

  const results: Array<{ id: string; bot: string; success: boolean; error?: string }> = [];
  for (const job of jobs) {
    try {
      const config = await buildConfigFromArgs(
        args,
        {
          bot: job.bot,
          searchTerm: job.searchTerm,
          maxPages: job.maxPages,
          maxRecords: job.maxRecords,
          runId: generateRunId(),
        },
        runtimeConfig.defaults,
      );
      await runSingleConfig(config, dispatcher);
      results.push({ id: job.id, bot: job.bot, success: true });
    } catch (error) {
      results.push({
        id: job.id,
        bot: job.bot,
        success: false,
        error: toSpanishErrorMessage(error),
      });
    }
  }

  process.stdout.write(`${JSON.stringify({ type: "bot-queue-results", results }, null, 2)}\n`);
  if (results.some((result) => !result.success)) {
    process.exit(1);
  }
}

async function buildConfigFromArgs(
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
  const bulkOutputDir = join(runRoot, "artifacts", "bulk");
  const logFilePath = (args.get("log-file") as string | undefined) ?? join(runRoot, "logs.jsonl");
  const baseUrl =
    (args.get("base-url") as string) ??
    "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb";
  const searchTerm = overrides?.searchTerm ?? (args.get("search") as string) ?? "civil";
  const sessionKey = buildSessionKey(baseUrl, bot, searchTerm);

  await ensureDir(join(runsDir, bot));
  await writeJson(latestPath, { runId, updatedAt: new Date().toISOString() } as LatestPointer);

  return {
    baseUrl,
    searchTerm,
    bot,
    runId,
    runsDir,
    outputDir,
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
    sessionKey,
    maxConsecutiveDownloadFailures: resolveNumberArg(
      args,
      "max-consecutive-download-failures",
      defaults?.maxConsecutiveDownloadFailures,
      0,
    ),
  };
}

async function runSingleConfig(config: ScraperConfig, dispatcher: NetworkDispatcher): Promise<void> {
  const runStore = new RunStore(buildRunStorePaths(config.dataDir));
  await runStore.initialize();
  const manifest = buildInitialManifest(config);
  await runStore.writeManifest(manifest);
  const globalLogFilePath = join(config.runsDir, "global.logs.jsonl");
  const logger = createLogger({
    level: config.logLevel,
    format: config.logFormat,
    service: "scraping-bot",
    logFilePath: config.logFilePath ?? runStore.getPaths().logsPath,
    additionalLogFilePaths: [globalLogFilePath],
    context: {
      bot: config.bot,
      busqueda: config.searchTerm,
    },
  });
  logger.info("Inicio de corrida", { accion: "inicio" });

  const retryConfig: RetryConfig = {
    maxRetries: 4,
    initialDelayMs: 500,
    backoffMultiplier: 2,
    maxDelayMs: 10_000,
    jitterRatio: 0.2,
  };

  const portalClient = new PortalClient({
    baseUrl: config.baseUrl,
    initPath: "/faces/page/inicio.xhtml",
    resultPath: "/faces/page/resultado.xhtml",
  }, undefined, logger.child({ module: "portalClient" }));

  const downloader = new PdfDownloadService({
    outputDir: config.outputDir,
    retryConfig,
  }, undefined, logger.child({ module: "pdfDownloadService" }));

  const orchestrator = new ScrapeOrchestrator(
    portalClient,
    downloader,
    runStore,
    config,
    logger.child({ module: "scrapeOrchestrator" }),
    dispatcher,
  );

  try {
    const summary = await orchestrator.run();
    logger.info("Corrida finalizada", {
      accion: "fin",
      processed: summary.processed,
      downloaded: summary.downloaded,
      missingPdf: summary.missingPdf,
      failed: summary.failed,
      bulkZipDownloaded: summary.bulkZipDownloaded,
    });
    await runStore.writeManifest({
      ...manifest,
      endedAt: new Date().toISOString(),
      status: "completed",
      summary,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    const message = toSpanishErrorMessage(error);
    const event: RunErrorEvent = {
      timestamp: new Date().toISOString(),
      runId: config.runId,
      bot: config.bot,
      stage: "main",
      operation: "main",
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: message,
      stack: error instanceof Error ? error.stack : undefined,
      context: {
        searchTerm: config.searchTerm,
        downloadMode: config.downloadMode,
      },
    };
    await runStore.appendError(event);
    await runStore.writeManifest({
      ...manifest,
      endedAt: new Date().toISOString(),
      status: "failed",
    });
    throw error;
  }
}

function createDispatcher(args: Map<string, string | boolean>, defaults?: RuntimeDefaults): NetworkDispatcher {
  return new NetworkDispatcher({
    requestsPerSecond: resolveNumberArg(args, "network-rps", defaults?.networkRps, 1),
    cooldownMs: resolveNumberArg(args, "network-cooldown-ms", defaults?.networkCooldownMs, 10_000),
    cooldownWindowMs: resolveNumberArg(args, "network-cooldown-window-ms", defaults?.networkCooldownWindowMs, 30_000),
    cooldownThreshold: resolveNumberArg(args, "network-cooldown-threshold", defaults?.networkCooldownThreshold, 3),
    maxCooldownMs: resolveNumberArg(args, "network-max-cooldown-ms", defaults?.networkMaxCooldownMs, 60_000),
    jitterRatio: resolveNumberArg(args, "network-jitter-ratio", defaults?.networkJitterRatio, 0.2),
  });
}

function parseBotJobs(value: string | undefined, defaults?: BotJob[]): BotJob[] {
  if (!value) {
    return defaults ?? [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    parsed = parseLooseBotJobs(value);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("--bot-jobs must be a JSON array");
  }
  return parsed.map((item, index) => {
    if (typeof item !== "object" || !item) {
      throw new Error(`Invalid bot job at index ${index}`);
    }
    const job = item as {
      id?: unknown;
      bot?: unknown;
      searchTerm?: unknown;
      maxPages?: unknown;
      maxRecords?: unknown;
    };
    if (typeof job.bot !== "string" || typeof job.searchTerm !== "string") {
      throw new Error(`Bot job at index ${index} requires string bot and searchTerm`);
    }
    return {
      id: typeof job.id === "string" ? job.id : `job-${index + 1}`,
      bot: job.bot,
      searchTerm: job.searchTerm,
      maxPages: typeof job.maxPages === "number" ? job.maxPages : undefined,
      maxRecords: typeof job.maxRecords === "number" ? job.maxRecords : undefined,
    };
  });
}

function resolveNumberArg(
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

function parseLooseBotJobs(input: string): unknown {
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

function buildSessionKey(baseUrl: string, bot: string, searchTerm: string): string {
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

export function toFatalErrorPayload(
  error: unknown,
  operation: string,
  context?: { runId?: string; bot?: string },
): FatalErrorPayload {
  return {
    type: "fatal",
    stage: "main",
    operation,
    errorName: error instanceof Error ? error.name : "Error",
    errorMessage: toSpanishErrorMessage(error),
    runId: context?.runId,
    bot: context?.bot,
  };
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${JSON.stringify(toFatalErrorPayload(error, "bootstrap"))}\n`);
    process.exit(1);
  });
}
