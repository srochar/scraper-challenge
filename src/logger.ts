import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  service: string;
  format?: "json" | "pretty";
  logFilePath?: string;
  additionalLogFilePaths?: string[];
  context?: Record<string, unknown>;
  persistence?: {
    appendFile?: typeof appendFile;
    mkdir?: typeof mkdir;
  };
}

const order: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

class StructuredLogger implements Logger {
  constructor(private readonly options: LoggerOptions) {}

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }

  child(context: Record<string, unknown>): Logger {
    return new StructuredLogger({
      ...this.options,
      context: {
        ...(this.options.context ?? {}),
        ...context,
      },
    });
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (order[level] < order[this.options.level]) {
      return;
    }

    const payload = {
      ts: new Date().toISOString(),
      level,
      service: this.options.service,
      message,
      ...(this.options.context ?? {}),
      ...(meta ?? {}),
    };

    const line = JSON.stringify(payload);
    const consoleLine = this.options.format === "pretty" ? renderPretty(payload) : line;
    if (level === "error") {
      process.stderr.write(`${consoleLine}\n`);
    } else {
      process.stdout.write(`${consoleLine}\n`);
    }

    const fileTargets = [
      this.options.logFilePath,
      ...(this.options.additionalLogFilePaths ?? []),
    ].filter((value): value is string => Boolean(value));

    const uniqueTargets = Array.from(new Set(fileTargets));
    for (const target of uniqueTargets) {
      void this.persistLine(target, line);
    }
  }

  private async persistLine(target: string, line: string): Promise<void> {
    const append = this.options.persistence?.appendFile ?? appendFile;
    const makeDir = this.options.persistence?.mkdir ?? mkdir;

    try {
      await append(target, `${line}\n`, "utf8");
      return;
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      if (code !== "ENOENT") {
        return;
      }
    }

    try {
      await makeDir(dirname(target), { recursive: true });
      await append(target, `${line}\n`, "utf8");
    } catch {
      // Best-effort persistence: console logging already succeeded.
    }
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new StructuredLogger(options);
}

const levelColor: Record<LogLevel, string> = {
  debug: "\u001b[36m",
  info: "\u001b[32m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
};

const dim = "\u001b[90m";
const reset = "\u001b[0m";

function renderPretty(payload: Record<string, unknown>): string {
  const level = String(payload.level ?? "info") as LogLevel;
  const ts = String(payload.ts ?? "");
  const service = String(payload.service ?? "service");
  const action = String(payload.accion ?? payload.message ?? "");
  const bot = payload.bot !== undefined ? String(payload.bot) : "";
  const busqueda = payload.busqueda !== undefined ? String(payload.busqueda) : "";
  const errorMessage = payload.errorMessage !== undefined ? String(payload.errorMessage) : "";
  const color = levelColor[level] ?? "";
  const levelText = `${color}${level.toUpperCase()}${reset}`;
  const core = [
    bot ? `bot=${bot}` : "",
    action ? `accion=${action}` : "",
    busqueda ? `busqueda=${busqueda}` : "",
  ].filter(Boolean).join(" ");
  const tail = errorMessage ? ` ${dim}error=${errorMessage}${reset}` : "";
  return `${dim}${ts}${reset} ${levelText} ${service}: ${core}${tail}`.trim();
}

export function normalizeLogLevel(value: string | undefined): LogLevel {
  if (!value) {
    return "info";
  }
  const lowered = value.toLowerCase();
  if (lowered === "debug" || lowered === "info" || lowered === "warn" || lowered === "error") {
    return lowered;
  }
  return "info";
}

export function normalizeLogFormat(value: string | undefined): "json" | "pretty" {
  if (!value) {
    return "json";
  }
  const lowered = value.toLowerCase();
  if (lowered === "json" || lowered === "pretty") {
    return lowered;
  }
  return "json";
}
