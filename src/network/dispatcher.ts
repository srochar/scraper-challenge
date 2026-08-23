export interface NetworkDispatcherOptions {
  requestsPerSecond: number;
  cooldownMs: number;
  cooldownWindowMs: number;
  cooldownThreshold: number;
  maxCooldownMs?: number;
  jitterRatio?: number;
}

interface LaneTask {
  operation: string;
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface SessionLane {
  active: boolean;
  queue: LaneTask[];
}

export class NetworkDispatcher {
  private readonly lanes = new Map<string, SessionLane>();

  private readonly minIntervalMs: number;

  private readonly cooldownMs: number;

  private readonly cooldownWindowMs: number;

  private readonly cooldownThreshold: number;

  private readonly maxCooldownMs: number;

  private readonly jitterRatio: number;

  private cooldownUntil = 0;

  private nextRequestAt = 0;

  private recent429: number[] = [];

  private slotMutex: Promise<void> = Promise.resolve();

  constructor(options: NetworkDispatcherOptions) {
    const rps = Math.max(0.1, options.requestsPerSecond);
    this.minIntervalMs = Math.floor(1000 / rps);
    this.cooldownMs = Math.max(0, options.cooldownMs);
    this.cooldownWindowMs = Math.max(1000, options.cooldownWindowMs);
    this.cooldownThreshold = Math.max(1, options.cooldownThreshold);
    this.maxCooldownMs = Math.max(this.cooldownMs, options.maxCooldownMs ?? this.cooldownMs * 6);
    this.jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? 0.2));
  }

  async run<T>(sessionKey: string, operation: string, execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const lane = this.ensureLane(sessionKey);
      lane.queue.push({
        operation,
        execute,
        resolve: (value) => resolve(value as T),
        reject,
      });
      if (!lane.active) {
        lane.active = true;
        void this.drainLane(sessionKey, lane);
      }
    });
  }

  private ensureLane(sessionKey: string): SessionLane {
    const lane = this.lanes.get(sessionKey);
    if (lane) {
      return lane;
    }
    const created: SessionLane = { active: false, queue: [] };
    this.lanes.set(sessionKey, created);
    return created;
  }

  private async drainLane(sessionKey: string, lane: SessionLane): Promise<void> {
    while (lane.queue.length > 0) {
      const task = lane.queue.shift() as LaneTask;
      try {
        await this.acquireGlobalSlot();
        const value = await task.execute();
        task.resolve(value);
      } catch (error) {
        if (isStatus(error, 429)) {
          this.registerRateLimitHit();
        }
        task.reject(error);
      }
    }
    lane.active = false;
    if (lane.queue.length === 0) {
      this.lanes.delete(sessionKey);
    }
  }

  private async acquireGlobalSlot(): Promise<void> {
    let release: (() => void) | undefined;
    const previous = this.slotMutex;
    this.slotMutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const now = Date.now();
      const allowedAt = Math.max(now, this.cooldownUntil, this.nextRequestAt);
      const waitMs = Math.max(0, allowedAt - now);
      if (waitMs > 0) {
        await wait(waitMs);
      }
      const jitter = Math.floor(this.minIntervalMs * this.jitterRatio * Math.random());
      this.nextRequestAt = Date.now() + this.minIntervalMs + jitter;
    } finally {
      release?.();
    }
  }

  private registerRateLimitHit(): void {
    const now = Date.now();
    this.recent429 = this.recent429.filter((ts) => now - ts <= this.cooldownWindowMs);
    this.recent429.push(now);
    const multiplier = this.recent429.length >= this.cooldownThreshold ? 2 : 1;
    const cooldown = Math.min(this.maxCooldownMs, this.cooldownMs * multiplier);
    this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldown);
  }
}

function isStatus(error: unknown, code: number): boolean {
  if (typeof error === "object" && error && "status" in error) {
    return (error as { status?: unknown }).status === code;
  }
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { status?: unknown } }).response;
    return response?.status === code;
  }
  return false;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
