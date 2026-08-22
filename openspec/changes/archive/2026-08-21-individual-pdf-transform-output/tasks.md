## 1. Runtime config and output paths

- [x] 1.1 Add run-level transformed output format configuration (`csv|json`) in CLI/config parsing and verify invalid values fail fast with a descriptive error before record processing starts.
- [x] 1.2 Add run-scoped results path resolution separate from PDF artifact paths and verify a dry run/fixture creates expected directory structure under `runs/<bot>/<runId>/results` and `runs/<bot>/<runId>/artifacts/pdfs`.

## 2. Individual PDF download behavior

- [x] 2.1 Update individual record target resolution to prioritize PDF download targets from record link/action context and verify parser/resolver tests cover direct and relative PDF link cases.
- [x] 2.2 Update individual downloader flow and naming/output assumptions for PDFs (instead of ZIP semantics) and verify unit tests assert successful PDF persistence and stable filename behavior.
- [x] 2.3 Preserve bounded retry/backoff and continuation-on-failure semantics for PDF downloads and verify deterministic tests cover `429 -> success` and exhausted-retry paths without halting later records.

## 3. Transformed output generation

- [x] 3.1 Implement transformed JSON output writer for processed records including download outcome fields and verify output excludes binary content while containing required metadata fields.
- [x] 3.2 Implement transformed CSV output writer with deterministic column ordering and metadata flattening and verify tests cover sparse/variable metadata keys.
- [x] 3.3 Integrate transformed output generation into run finalization for selected format and verify a bounded integration run produces exactly one selected output (`records.json` or `records.csv`) in results directory.

## 4. Compatibility and documentation updates

- [x] 4.1 Update README/runtime usage docs to describe PDF-focused individual mode and transformed output selection/location and verify command examples are consistent with supported flags.
- [x] 4.2 Validate resume/failed-only behavior remains compatible with new transformed output paths and verify with tests or scripted run sequence (`fresh -> interrupt -> resume`, `failed-only`).

## 5. End-to-end verification

- [x] 5.1 Run test suite sections impacted by parser, downloader, and orchestrator changes and verify all updated tests pass.
- [x] 5.2 Execute a bounded scrape scenario and verify outputs include: persisted PDFs in artifact folder, transformed CSV/JSON in results folder, and unchanged progress/failure/error telemetry files.
