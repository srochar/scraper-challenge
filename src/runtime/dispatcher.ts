import { NetworkDispatcher } from "../network/dispatcher";
import { RuntimeDefaults } from "./types";
import { resolveNumberArg } from "./config";

export function createDispatcher(args: Map<string, string | boolean>, defaults?: RuntimeDefaults): NetworkDispatcher {
  return new NetworkDispatcher({
    requestsPerSecond: resolveNumberArg(args, "network-rps", defaults?.networkRps, 1),
    cooldownMs: resolveNumberArg(args, "network-cooldown-ms", defaults?.networkCooldownMs, 10_000),
    cooldownWindowMs: resolveNumberArg(args, "network-cooldown-window-ms", defaults?.networkCooldownWindowMs, 30_000),
    cooldownThreshold: resolveNumberArg(args, "network-cooldown-threshold", defaults?.networkCooldownThreshold, 3),
    maxCooldownMs: resolveNumberArg(args, "network-max-cooldown-ms", defaults?.networkMaxCooldownMs, 60_000),
    jitterRatio: resolveNumberArg(args, "network-jitter-ratio", defaults?.networkJitterRatio, 0.2),
  });
}
