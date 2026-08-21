## Context

The current scraper writes operational artifacts into shared `data/` and `output/pdfs/` directories, which is adequate for single-run usage but creates collisions and poor diagnosability in repeated or parallel bot executions. Existing logs are structured JSON but not optimized for interactive monitoring. Failure persistence is focused on PDF download retries and does not provide full pipeline-stage error localization.

## Goals / Non-Goals

**Goals:**
- Introduce run-scoped storage rooted at `runs/<bot>/<runId>/...`.
- Preserve existing scraping behavior while making resume and failed-only operations run-aware.
- Provide dual log rendering: pretty colored console output and JSON line persistence.
- Record structured stage-aware errors across pipeline boundaries.
- Provide first-class Docker and Compose assets for multi-bot execution.
- Add tests that lock in bulk ZIP behavior and new storage semantics.

**Non-Goals:**
- Rebuild portal scraping payload semantics or parser strategy.
- Introduce a database dependency for telemetry.
- Implement distributed scheduling or queue orchestration.

## Decisions

### Decision: Run-scoped directory layout with bot partitioning
- **Choice:** `runs/<bot>/<runId>/` as canonical execution root with:
  - `manifest.json`
  - `progress.json`
  - `records.jsonl`
  - `failed.jsonl`
  - `errors.jsonl`
  - `logs.jsonl`
  - `artifacts/pdfs/`
  - `artifacts/bulk/`
  - and `runs/<bot>/latest.json` pointer.
- **Rationale:** Isolates runs, supports historical auditability, and allows stable resume targeting.
- **Alternatives considered:**
  - `data/<bot>/...` without run IDs: simpler but loses per-run isolation and forensic traceability.
  - single global run ledger: better querying but higher complexity and lock contention.

### Decision: Explicit CLI run identity controls
- **Choice:** Extend CLI with `--bot`, `--runs-dir`, `--run-id`, and `--log-format` while retaining legacy `--data-dir`/`--output-dir` as compatibility overrides.
- **Rationale:** Enables deterministic targeting in local and containerized operations without breaking existing scripts.
- **Alternatives considered:**
  - infer bot from search term only: ambiguous and fragile.
  - remove legacy flags immediately: disruptive to existing automation.

### Decision: Keep JSON as source-of-truth logs, layer pretty rendering for console
- **Choice:** Logger emits structured payload once, then renders either JSON or colorized compact text to console based on `--log-format`; persisted log files remain JSONL.
- **Rationale:** Preserves machine parsing while improving human operability.
- **Alternatives considered:**
  - pretty-only console with no JSON option: hurts CI parsing.
  - fully separate loggers: unnecessary duplication and drift risk.

### Decision: Cross-stage error table as append-only JSONL
- **Choice:** Add `RunErrorEvent` model and `appendError` API in `RunStore` used by orchestrator boundaries (init/search/paginate/process/download/bulk/finalize/main).
- **Rationale:** Captures where failures occur with enough context for debugging without requiring schema migrations.
- **Alternatives considered:**
  - SQLite table: stronger queries but adds dependency and migration surface.
  - only log errors, no store: hard to aggregate reliably after process exits.

### Decision: Compose with one image and multiple named services
- **Choice:** Build one application image and define `bot-civil`, `bot-familia`, `bot-robo` services in `docker-compose.yml`, each with bot-specific CLI args and bind-mounted `runs/` directory.
- **Rationale:** Operationally simple and clear; each service can be observed and restarted independently.
- **Alternatives considered:**
  - single service with dynamic matrix: harder for operators to manage ad hoc runs.

## Risks / Trade-offs

- **[Run directory growth]** -> Mitigate with documented retention policy and optional future prune command.
- **[Backward compatibility complexity]** -> Mitigate by maintaining legacy flags and clearly defining precedence rules.
- **[Error event volume]** -> Mitigate by concise context payloads and JSONL append-only format.
- **[Windows/Linux path differences in containers]** -> Mitigate by using relative runtime paths and composing paths in Node only.

## Migration Plan

1. Introduce run path resolver and `RunStore` extensions while keeping legacy defaults operable.
2. Wire orchestrator to run context paths and error-event persistence.
3. Add logger format selection and fatal error structuring.
4. Add Dockerfile and compose services using new CLI flags.
5. Update README command examples and output documentation.
6. Expand tests for storage layout and bulk ZIP path; run full test suite.
7. Validate by running representative commands in local and containerized modes.
