## Why

The scraping challenge requires a TypeScript scraper that can traverse a JSF-based judicial portal, extract document data, and download associated PDFs reliably. We need a robust, testable approach now because the target site uses session state and can return 429 rate-limit errors that are hard to validate through manual runs alone.

## What Changes

- Add a new scraping capability for the Jurisprudencia portal using HTTP requests and HTML/XML parsing (no browser automation).
- Support JSF/RichFaces stateful navigation (session cookies, ViewState lifecycle, and partial-response parsing) to retrieve paginated/updated result content.
- Extract document metadata into structured output and derive deterministic, descriptive PDF file names.
- Add a PDF download pipeline with retry and exponential backoff for 429 and transient failures, then continue processing after bounded retry exhaustion.
- Persist progress and failed-download records so long runs can resume and failed items can be retried later.
- Add unit tests for retry/backoff and failure-handling behaviors, including simulated 429 sequences.

## Capabilities

### New Capabilities
- `jurisprudencia-scraper`: End-to-end scraping behavior for JSF result traversal, metadata extraction, PDF retrieval, resiliency, and observable progress.

### Modified Capabilities
- None.

## Impact

- Affected code: new TypeScript scraper modules for HTTP client/session management, JSF interaction, parsing, download orchestration, persistence, and CLI entrypoint.
- APIs/systems: outbound requests to `jurisprudencia.pj.gob.pe` (primary) and optional compatibility path for `publico.oefa.gob.pe` style JSF flow.
- Dependencies: TypeScript runtime dependencies for HTTP and parsing; test dependencies for unit testing and HTTP behavior mocking.
- Operations: introduces configurable rate-limiting/retry parameters and structured logs/artifacts for run progress and failures.
