## 1. Run-scoped storage foundation

- [x] 1.1 Extend CLI parsing for `--bot`, `--runs-dir`, `--run-id`, and legacy path compatibility precedence; verify `npm run build` succeeds.
- [x] 1.2 Implement run path resolution (`runs/<bot>/<runId>/...`) plus `latest.json` pointer behavior; verify unit tests cover new path contracts.
- [x] 1.3 Update run persistence APIs to write progress/records/failures/errors/logs under run scope; verify orchestrator tests assert scoped file outputs.

## 2. Logging and error observability

- [x] 2.1 Add logger format selection (`json|pretty`) with ANSI colorized level rendering for console while preserving structured payloads; verify logger tests cover both modes.
- [x] 2.2 Capture stage-aware error events (`errors.jsonl`) across init/search/paginate/process/download/bulk/finalize boundaries; verify failing-path tests assert stage and context fields.
- [x] 2.3 Improve top-level fatal error reporting with structured context output; verify a simulated unhandled failure emits expected fatal fields.

## 3. Containerized multi-bot operations

- [x] 3.1 Add `Dockerfile` for deterministic scraper runtime build and execution; verify `docker build` completes successfully.
- [x] 3.2 Add `docker-compose.yml` with `bot-civil`, `bot-familia`, and `bot-robo` services using shared image and isolated bot args; verify `docker compose config` is valid.
- [x] 3.3 Document updated commands and run layout in `README.md`; verify examples align with current CLI flags.

## 4. Regression and ZIP coverage

- [x] 4.1 Expand tests for run-scoped resume and failed-only behavior (`latest.json` / `runId` targeting); verify `npm test` passes these cases.
- [x] 4.2 Strengthen bulk ZIP tests to assert ZIP artifact persistence path and execution in bulk mode; verify `npm test` passes bulk-specific assertions.
- [x] 4.3 Run full validation (`npm run build` and `npm test`) and confirm all tasks complete without regressions.
