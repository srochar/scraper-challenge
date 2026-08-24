const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("fs");
const { join, resolve } = require("path");

const ROOT = process.cwd();
const MAX_FAILED_ONLY_ROUNDS = 5;

const PROFILE_DEFINITIONS = [
  {
    id: "baseline",
    intent: "Balanced conservative defaults for first-pass stability.",
    keyParameters: {
      networkRps: 0.7,
      requestDelayMs: 1800,
      requestTimeoutMs: 45000,
      downloadMode: "both",
    },
    runtimeArgs: [
      "--network-rps", "0.7",
      "--network-cooldown-ms", "12000",
      "--network-cooldown-threshold", "3",
      "--network-cooldown-window-ms", "30000",
      "--network-max-cooldown-ms", "60000",
      "--network-jitter-ratio", "0.25",
      "--request-timeout-ms", "45000",
      "--request-delay-ms", "1800",
      "--request-jitter-ms", "900",
      "--max-consecutive-download-failures", "8",
      "--download-mode", "both",
      "--result-format", "csv",
      "--unzip", "true",
      "--log-level", "info",
      "--log-format", "pretty",
    ],
  },
  {
    id: "conservative",
    intent: "Lower throughput and stronger cooldown to reduce transient failures.",
    keyParameters: {
      networkRps: 0.4,
      requestDelayMs: 2600,
      requestTimeoutMs: 60000,
      downloadMode: "both",
    },
    runtimeArgs: [
      "--network-rps", "0.4",
      "--network-cooldown-ms", "18000",
      "--network-cooldown-threshold", "2",
      "--network-cooldown-window-ms", "45000",
      "--network-max-cooldown-ms", "120000",
      "--network-jitter-ratio", "0.35",
      "--request-timeout-ms", "60000",
      "--request-delay-ms", "2600",
      "--request-jitter-ms", "1400",
      "--max-consecutive-download-failures", "12",
      "--download-mode", "both",
      "--result-format", "csv",
      "--unzip", "true",
      "--log-level", "info",
      "--log-format", "pretty",
    ],
  },
  {
    id: "ultra-conservative",
    intent: "Maximum patience for unstable portal windows.",
    keyParameters: {
      networkRps: 0.25,
      requestDelayMs: 4000,
      requestTimeoutMs: 90000,
      downloadMode: "both",
    },
    runtimeArgs: [
      "--network-rps", "0.25",
      "--network-cooldown-ms", "25000",
      "--network-cooldown-threshold", "2",
      "--network-cooldown-window-ms", "60000",
      "--network-max-cooldown-ms", "180000",
      "--network-jitter-ratio", "0.4",
      "--request-timeout-ms", "90000",
      "--request-delay-ms", "4000",
      "--request-jitter-ms", "2000",
      "--max-consecutive-download-failures", "20",
      "--download-mode", "both",
      "--result-format", "csv",
      "--unzip", "true",
      "--log-level", "info",
      "--log-format", "pretty",
    ],
  },
];

const ENVIRONMENTS = {
  local: {
    description: "Direct host execution.",
    profileIds: PROFILE_DEFINITIONS.map((p) => p.id),
  },
  vpn: {
    description: "Host execution while VPN connectivity is active.",
    profileIds: PROFILE_DEFINITIONS.map((p) => p.id),
  },
  docker: {
    description: "Containerized execution through existing project image.",
    profileIds: PROFILE_DEFINITIONS.map((p) => p.id),
  },
};

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
  const options = {
    environment: "all",
    bot: "civil",
    search: "civil",
    maxPages: 2,
    maxRecords: 20,
    maxFailedOnlyRounds: MAX_FAILED_ONLY_ROUNDS,
    outDir: join(ROOT, "artifacts", "reliability", nowStamp()),
    reportOnly: false,
    input: undefined,
    selfCheck: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--environment" && next) {
      options.environment = next;
      i += 1;
      continue;
    }
    if (arg === "--bot" && next) {
      options.bot = next;
      i += 1;
      continue;
    }
    if (arg === "--search" && next) {
      options.search = next;
      i += 1;
      continue;
    }
    if (arg === "--max-pages" && next) {
      options.maxPages = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--max-records" && next) {
      options.maxRecords = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--max-failed-only-rounds" && next) {
      options.maxFailedOnlyRounds = Math.max(1, Math.min(MAX_FAILED_ONLY_ROUNDS, Number(next)));
      i += 1;
      continue;
    }
    if (arg === "--out-dir" && next) {
      options.outDir = resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--report-only") {
      options.reportOnly = true;
      continue;
    }
    if (arg === "--input" && next) {
      options.input = resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--self-check") {
      options.selfCheck = true;
      continue;
    }
  }

  return options;
}

function getTargetEnvironments(environment) {
  if (environment === "all") {
    return ["local", "vpn", "docker"];
  }
  if (!Object.prototype.hasOwnProperty.call(ENVIRONMENTS, environment)) {
    throw new Error(`Unsupported environment '${environment}'. Use local|vpn|docker|all.`);
  }
  return [environment];
}

function runCommand(command, args, cwd, logPath) {
  let executable = command;
  let executableArgs = args;
  if (/\.cmd$/i.test(command)) {
    executable = "cmd.exe";
    executableArgs = ["/d", "/s", "/c", command, ...args];
  }

  const result = spawnSync(executable, executableArgs, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  const errorMessage = result.error ? `${result.error.name}: ${result.error.message}` : "";
  const exitCode = typeof result.status === "number" ? result.status : -1;
  const payload = [
    `command=${executable} ${executableArgs.join(" ")}`,
    `exitCode=${String(exitCode)}`,
    `error=${errorMessage || "none"}`,
    "",
    "STDOUT:",
    result.stdout || "",
    "",
    "STDERR:",
    result.stderr || "",
    "",
  ].join("\n");
  writeFileSync(logPath, payload, "utf8");
  return {
    ...result,
    exitCode,
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function tryReadJson(filePath) {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    return readJson(filePath);
  } catch {
    return undefined;
  }
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const output = [];
  for (const line of lines) {
    try {
      output.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return output;
}

function computeDurationMs(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return 0;
  }
  const started = Date.parse(String(manifest.startedAt || ""));
  const ended = Date.parse(String(manifest.endedAt || ""));
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return 0;
  }
  return Math.max(0, ended - started);
}

function buildRunsDir(outDir, environment, profileId) {
  return join(outDir, "runs", environment, profileId);
}

function getLatestRunRoot(runsDir, bot) {
  const latestPath = join(runsDir, bot, "latest.json");
  const latest = tryReadJson(latestPath);
  if (!latest || typeof latest.runId !== "string" || !latest.runId) {
    return undefined;
  }
  return {
    latestPath,
    runId: latest.runId,
    runRoot: join(runsDir, bot, latest.runId),
  };
}

function collectRoundEvidence(runsDir, bot) {
  const latest = getLatestRunRoot(runsDir, bot);
  if (!latest) {
    return {
      runId: "unknown",
      runRoot: "",
      manifestPath: "",
      failuresPath: "",
      errorsPath: "",
      summary: {
        processed: 0,
        downloaded: 0,
        missingLink: 0,
        failed: 1,
      },
      metrics: {
        durationMs: 0,
        hardErrors: 1,
      },
      missingEvidence: true,
    };
  }
  const manifestPath = join(latest.runRoot, "manifest.json");
  const failuresPath = join(latest.runRoot, "failed.jsonl");
  const errorsPath = join(latest.runRoot, "errors.jsonl");
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {};
  const summary = manifest.summary || {};
  const errors = readJsonLines(errorsPath);
  const hardErrors = errors.filter((event) => {
    if (!event || typeof event !== "object") {
      return false;
    }
    if (event.stage === "main") {
      return true;
    }
    return event.errorName !== "DownloadFailed";
  }).length;

  return {
    runId: latest.runId,
    runRoot: latest.runRoot,
    manifestPath,
    failuresPath,
    errorsPath,
    summary: {
      processed: Number(summary.processed || 0),
      downloaded: Number(summary.downloaded || 0),
      missingLink: Number(summary.missingLink || 0),
      failed: Number(summary.failed || 0),
    },
    metrics: {
      durationMs: computeDurationMs(manifest),
      hardErrors,
    },
    missingEvidence: false,
  };
}

function runScrapeRound(params) {
  const {
    environment,
    profile,
    bot,
    search,
    maxPages,
    maxRecords,
    outDir,
    round,
    failedOnly,
  } = params;
  const logsDir = join(outDir, "logs", environment, profile.id);
  mkdirSync(logsDir, { recursive: true });
  const logPath = join(logsDir, `round-${String(round).padStart(2, "0")}${failedOnly ? "-failed-only" : "-initial"}.log.txt`);
  const runsDir = buildRunsDir(outDir, environment, profile.id);
  mkdirSync(runsDir, { recursive: true });
  const baseArgs = [
    "run",
    "scrape",
    "--",
    ...profile.runtimeArgs,
    "--bot",
    bot,
    "--search",
    search,
    "--max-pages",
    String(maxPages),
    "--max-records",
    String(maxRecords),
    "--runs-dir",
    runsDir,
    "--log-format",
    "json",
  ];
  if (failedOnly) {
    baseArgs.push("--failed-only");
  }

  const command = environment === "docker" ? "docker" : "npm.cmd";
  const commandArgs =
    environment === "docker"
      ? [
        "compose",
        "run",
        "--rm",
        "-v",
        `${runsDir}:/app/runs`,
        "bot-runner",
        "npm",
        "run",
        "scrape",
        "--",
        ...profile.runtimeArgs,
        "--bot",
        bot,
        "--search",
        search,
        "--max-pages",
        String(maxPages),
        "--max-records",
        String(maxRecords),
        "--runs-dir",
        "runs",
        "--log-format",
        "json",
        ...(failedOnly ? ["--failed-only"] : []),
      ]
      : baseArgs;

  const result = runCommand(command, commandArgs, ROOT, logPath);
  const evidence = collectRoundEvidence(runsDir, bot);
  if (result.exitCode !== 0) {
    evidence.summary.failed = Math.max(1, evidence.summary.failed);
    evidence.metrics.hardErrors = Math.max(1, evidence.metrics.hardErrors);
  }
  return {
    round,
    failedOnly,
    command,
    commandArgs,
    exitCode: result.exitCode,
    ok: result.exitCode === 0,
    logPath,
    ...evidence,
  };
}

function rankProfiles(profileResults) {
  const ranked = profileResults.slice().sort((a, b) => {
    const failedOrder = a.finalMetrics.residualFailed - b.finalMetrics.residualFailed;
    if (failedOrder !== 0) {
      return failedOrder;
    }
    const completionOrder = b.finalMetrics.completionRate - a.finalMetrics.completionRate;
    if (completionOrder !== 0) {
      return completionOrder;
    }
    const hardErrorsOrder = a.finalMetrics.hardErrors - b.finalMetrics.hardErrors;
    if (hardErrorsOrder !== 0) {
      return hardErrorsOrder;
    }
    const runtimeOrder = a.finalMetrics.totalDurationMs - b.finalMetrics.totalDurationMs;
    if (runtimeOrder !== 0) {
      return runtimeOrder;
    }
    return a.profileId.localeCompare(b.profileId);
  });
  return ranked;
}

function buildJustification(profile) {
  return `failed=${profile.finalMetrics.residualFailed}, completionRate=${profile.finalMetrics.completionRate.toFixed(4)}, hardErrors=${profile.finalMetrics.hardErrors}, totalDurationMs=${profile.finalMetrics.totalDurationMs}`;
}

function createMarkdownReport(data) {
  const lines = [];
  lines.push("# Reliability Campaign Report");
  lines.push("");
  lines.push(`Generated at: ${data.generatedAt}`);
  lines.push("");
  for (const envResult of data.environments) {
    lines.push(`## Environment: ${envResult.environment}`);
    lines.push("");
    lines.push("| Rank | Profile | Approved | Residual Failed | Completion Rate | Hard Errors | Runtime ms | Winner Justification |");
    lines.push("|---|---|---|---:|---:|---:|---:|---|");
    envResult.ranking.forEach((profile, index) => {
      lines.push(`| ${index + 1} | ${profile.profileId} | ${profile.approved ? "yes" : "no"} | ${profile.finalMetrics.residualFailed} | ${profile.finalMetrics.completionRate.toFixed(4)} | ${profile.finalMetrics.hardErrors} | ${profile.finalMetrics.totalDurationMs} | ${buildJustification(profile)} |`);
    });
    lines.push("");
    lines.push(`Winner: ${envResult.winner.profileId}`);
    lines.push("");
    lines.push("### Evidence Pointers");
    lines.push("");
    for (const profile of envResult.ranking) {
      const finalRound = profile.rounds[profile.rounds.length - 1];
      lines.push(`- ${profile.profileId}: manifest=${finalRound.manifestPath || "missing"}, failures=${finalRound.failuresPath || "missing"}, errors=${finalRound.errorsPath || "missing"}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function createRolloutRecommendation(data) {
  const lines = [];
  lines.push("# Rollout Recommendation");
  lines.push("");
  lines.push("Rollback baseline profile: baseline");
  lines.push("");
  lines.push("| Environment | Recommended Profile | Rollback Profile |");
  lines.push("|---|---|---|");
  for (const envResult of data.environments) {
    lines.push(`| ${envResult.environment} | ${envResult.winner.profileId} | baseline |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeReportOutputs(data, outDir) {
  const reportPath = join(outDir, "campaign-report.md");
  const recommendationPath = join(outDir, "rollout-recommendation.md");
  writeFileSync(reportPath, createMarkdownReport(data), "utf8");
  writeFileSync(recommendationPath, createRolloutRecommendation(data), "utf8");
  return { reportPath, recommendationPath };
}

function runSelfCheck() {
  const expected = PROFILE_DEFINITIONS.map((profile) => profile.id).join("|");
  for (const [env, config] of Object.entries(ENVIRONMENTS)) {
    const current = config.profileIds.join("|");
    if (current !== expected) {
      throw new Error(`Environment '${env}' profile set mismatch.`);
    }
  }

  for (const profile of PROFILE_DEFINITIONS) {
    if (!Array.isArray(profile.runtimeArgs) || profile.runtimeArgs.length === 0) {
      throw new Error(`Missing runtime args for profile: ${profile.id}`);
    }
  }

  const sample = [
    {
      profileId: "b",
      finalMetrics: { residualFailed: 0, completionRate: 0.9, hardErrors: 2, totalDurationMs: 1000 },
    },
    {
      profileId: "a",
      finalMetrics: { residualFailed: 0, completionRate: 0.9, hardErrors: 2, totalDurationMs: 1000 },
    },
  ];
  const ranked = rankProfiles(sample);
  if (ranked[0].profileId !== "a") {
    throw new Error("Deterministic ranking tie-break failed.");
  }
}

function buildEnvironmentResult(environment, profileResults) {
  const ranking = rankProfiles(profileResults);
  const winner = ranking[0];
  return {
    environment,
    ranking,
    winner: {
      profileId: winner.profileId,
      justification: buildJustification(winner),
    },
  };
}

function executeCampaign(options) {
  const environments = getTargetEnvironments(options.environment);
  mkdirSync(options.outDir, { recursive: true });

  const campaign = {
    generatedAt: new Date().toISOString(),
    maxFailedOnlyRounds: options.maxFailedOnlyRounds,
    strictAcceptanceResidualFailed: 0,
    tieBreakOrder: [
      "residualFailed asc",
      "completionRate desc",
      "hardErrors asc",
      "totalDurationMs asc",
      "profileId lexicographic",
    ],
    environments: [],
  };

  for (const environment of environments) {
    const envConfig = ENVIRONMENTS[environment];
    const profileResults = [];
    for (const profileId of envConfig.profileIds) {
      const profile = PROFILE_DEFINITIONS.find((item) => item.id === profileId);
      if (!profile) {
        throw new Error(`Unknown profile id '${profileId}' in environment '${environment}'.`);
      }

      const rounds = [];
      const initialRound = runScrapeRound({
        environment,
        profile,
        bot: options.bot,
        search: options.search,
        maxPages: options.maxPages,
        maxRecords: options.maxRecords,
        outDir: options.outDir,
        round: 0,
        failedOnly: false,
      });
      rounds.push(initialRound);

      let currentFailed = initialRound.summary.failed;
      let stopReason = currentFailed === 0 ? "initial_success_pending_audit_round" : "max_rounds_reached";

      for (let round = 1; round <= options.maxFailedOnlyRounds; round += 1) {
        const nextRound = runScrapeRound({
          environment,
          profile,
          bot: options.bot,
          search: options.search,
          maxPages: options.maxPages,
          maxRecords: options.maxRecords,
          outDir: options.outDir,
          round,
          failedOnly: true,
        });
        rounds.push(nextRound);
        currentFailed = nextRound.summary.failed;
        if (currentFailed === 0) {
          stopReason = "converged_zero_failed";
          break;
        }
        if (round === options.maxFailedOnlyRounds) {
          stopReason = "max_rounds_reached";
        }
      }

      const finalRound = rounds[rounds.length - 1];
      const totalProcessed = rounds.reduce((sum, item) => sum + item.summary.processed, 0);
      const totalDownloaded = rounds.reduce((sum, item) => sum + item.summary.downloaded, 0);
      const totalDurationMs = rounds.reduce((sum, item) => sum + item.metrics.durationMs, 0);
      const hardErrors = rounds.reduce((sum, item) => sum + item.metrics.hardErrors, 0);
      const completionRate = totalProcessed > 0 ? totalDownloaded / totalProcessed : 0;
      const residualFailed = finalRound.summary.failed;

      profileResults.push({
        profileId: profile.id,
        intent: profile.intent,
        keyParameters: profile.keyParameters,
        runtimeArgs: profile.runtimeArgs,
        rounds,
        stopReason,
        approved: residualFailed === 0,
        finalMetrics: {
          residualFailed,
          completionRate,
          hardErrors,
          totalDurationMs,
        },
      });
    }

    campaign.environments.push(buildEnvironmentResult(environment, profileResults));
  }

  const resultPath = join(options.outDir, "campaign-results.json");
  writeFileSync(resultPath, `${JSON.stringify(campaign, null, 2)}\n`, "utf8");
  const reportOutputs = writeReportOutputs(campaign, options.outDir);
  return {
    campaign,
    resultPath,
    reportPath: reportOutputs.reportPath,
    recommendationPath: reportOutputs.recommendationPath,
  };
}

function reportOnly(inputPath, outDir) {
  if (!inputPath) {
    throw new Error("--input is required with --report-only");
  }
  const campaign = readJson(inputPath);
  mkdirSync(outDir, { recursive: true });
  const reportOutputs = writeReportOutputs(campaign, outDir);
  return {
    reportPath: reportOutputs.reportPath,
    recommendationPath: reportOutputs.recommendationPath,
  };
}

function main() {
  const options = parseArgs(process.argv);
  if (options.selfCheck) {
    runSelfCheck();
    console.log(JSON.stringify({ ok: true, mode: "self-check" }, null, 2));
    return;
  }
  if (options.reportOnly) {
    const output = reportOnly(options.input, options.outDir);
    console.log(JSON.stringify({ ok: true, mode: "report-only", ...output }, null, 2));
    return;
  }
  const output = executeCampaign(options);
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "execute",
        resultPath: output.resultPath,
        reportPath: output.reportPath,
        recommendationPath: output.recommendationPath,
      },
      null,
      2,
    ),
  );
}

main();
