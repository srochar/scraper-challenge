import { RetryConfig, RetryDependencies } from "../types";

export interface RetryOutcome<T> {
  value?: T;
  attempts: number;
  success: boolean;
  lastError?: unknown;
}

export function shouldRetryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function computeBackoffDelay(attempt: number, config: RetryConfig, random: number): number {
  const base = config.initialDelayMs * Math.pow(config.backoffMultiplier, Math.max(0, attempt - 1));
  const capped = Math.min(base, config.maxDelayMs);
  const jitter = capped * config.jitterRatio * random;
  return Math.floor(capped + jitter);
}

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  config: RetryConfig,
  deps: RetryDependencies,
): Promise<RetryOutcome<T>> {
  let attempts = 0;
  let lastError: unknown;

  while (attempts <= config.maxRetries) {
    attempts += 1;
    try {
      const value = await operation();
      return { value, attempts, success: true };
    } catch (error) {
      lastError = error;
      if (attempts > config.maxRetries || !shouldRetry(error)) {
        return { attempts, success: false, lastError };
      }
      const delay = computeBackoffDelay(attempts, config, deps.random());
      await deps.wait(delay);
    }
  }

  return { attempts, success: false, lastError };
}
