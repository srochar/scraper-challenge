import { NetworkDispatcher } from "../network/dispatcher";
import { resolveNumberArg } from "./config";

export function createDispatcher(args: Map<string, string | boolean>): NetworkDispatcher {
  return new NetworkDispatcher({
    requestsPerSecond: resolveNumberArg(args, "network-rps", undefined, 1),
    cooldownMs: resolveNumberArg(args, "network-cooldown-ms", undefined, 10_000),
    cooldownWindowMs: resolveNumberArg(args, "network-cooldown-window-ms", undefined, 30_000),
    cooldownThreshold: resolveNumberArg(args, "network-cooldown-threshold", undefined, 3),
    maxCooldownMs: resolveNumberArg(args, "network-max-cooldown-ms", undefined, 60_000),
    jitterRatio: resolveNumberArg(args, "network-jitter-ratio", undefined, 0.2),
  });
}
