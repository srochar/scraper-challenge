## Why

Current scraper outputs and operational telemetry are mixed in shared directories, which makes multi-bot runs hard to operate, debug, and resume safely. We need run-scoped storage, clearer logs, and containerized execution patterns to support parallel bot workloads with reliable diagnostics.

## What Changes

- Reorganize persistence to run-scoped storage under `runs/<bot>/<runId>/...` including records, progress, failures, errors, logs, and artifacts.
- Add run identity and bot selection semantics to CLI so each execution can be isolated, resumed, and retried deterministically.
- Extend logging with human-readable colored console output while preserving structured JSON log persistence.
- Add structured cross-stage error event persistence that captures where and why a failure occurred.
- Add container assets (`Dockerfile` and `docker-compose.yml`) to execute multiple bot services concurrently (for example: `robo`, `civil`, `familia`).
- Add and update tests for run-scoped storage and bulk ZIP behavior to prevent regressions.

## Capabilities

### New Capabilities
- `containerized-scraper-operations`: Define behavior for running multiple scraper bot profiles via containers with isolated runtime outputs.

### Modified Capabilities
- `jurisprudencia-scraper`: Update persistence, logging, retry diagnostics, and recoverability behavior to be run-scoped and stage-aware.

## Impact

- Affected code: CLI argument parsing, run store, orchestrator flow, logger, error capture, and tests.
- New runtime outputs under `runs/` and potential deprecation path for legacy `data/` + `output/` layout.
- New operational assets: `Dockerfile` and `docker-compose.yml`.
- Improves troubleshooting and reliability for failed requests and bulk ZIP runs.
