import { appendFile } from "fs/promises";

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
  context?: Record<string, unknown>;
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

    if (this.options.logFilePath) {
      void appendFile(this.options.logFilePath, `${line}\n`, "utf8");
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
  const message = String(payload.message ?? "");
  const context = Object.entries(payload).filter(([key]) => !["ts", "level", "service", "message"].includes(key));
  const contextText = context
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  const color = levelColor[level] ?? "";
  const levelText = `${color}${level.toUpperCase()}${reset}`;
  return `${dim}${ts}${reset} ${levelText} ${service}: ${message}${contextText ? ` ${dim}${contextText}${reset}` : ""}`;
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
