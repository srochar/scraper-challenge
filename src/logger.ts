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
    if (level === "error") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }

    if (this.options.logFilePath) {
      void appendFile(this.options.logFilePath, `${line}\n`, "utf8");
    }
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new StructuredLogger(options);
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
