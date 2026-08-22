## Why

The current individual flow is optimized for ZIP-oriented artifacts, but the immediate operational need is to process per-record resolution downloads as PDFs and publish structured datasets separately from binary files. We need this now to standardize downstream consumption and keep extraction outputs usable for analysis pipelines.

## What Changes

- Update the individual download flow to resolve and fetch per-record PDF files from the "ver resolucion" action.
- Add a configurable transformed output format for extracted records (`csv` or `json`).
- Persist PDFs and transformed datasets in separate run-scoped directories.
- Ensure transformed outputs contain extracted metadata and download outcome fields, without embedding PDF binary content.
- Preserve pagination traversal, retry/backoff behavior, and per-record failure continuation.
- **BREAKING**: change individual artifact semantics from ZIP-focused outputs to PDF-focused outputs for this mode.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `jurisprudencia-scraper`: change artifact retrieval and output requirements for the individual flow to download PDFs and emit configurable transformed datasets (CSV/JSON) separated from binary artifacts.

## Impact

- Affected code: portal link resolution, per-record download pipeline, run artifact layout, and result export/serialization paths.
- Affected operational behavior: individual runs produce PDF artifacts plus CSV/JSON transformed outputs instead of ZIP-focused artifacts.
- Affected docs/config: CLI/runtime configuration and runbook guidance must describe transformed output selection and output directory separation.
