# jurisprudencia-scraper Specification

## Purpose
Define the expected behavior of a resilient scraper that can traverse the jurisprudencia portal, extract document data, and retrieve associated PDFs despite rate limiting and long-running interruptions.

## Requirements

### Requirement: Stateful portal traversal
The scraper SHALL maintain a valid portal session and request state across interactions so it can retrieve result content from JSF-driven pages.

#### Scenario: Initial state acquisition
- **WHEN** a scraping run starts
- **THEN** the scraper establishes a session and obtains the request state needed to request result content

#### Scenario: State refresh after response
- **WHEN** a server response includes updated request state
- **THEN** the scraper uses the updated state for subsequent requests in the same run

### Requirement: Complete result traversal and extraction
The scraper SHALL traverse available result pages and extract document metadata exposed by the portal for each discovered record.

#### Scenario: Multi-page traversal
- **WHEN** more than one result page is available
- **THEN** the scraper continues requesting subsequent pages until no further page is available

#### Scenario: Metadata capture
- **WHEN** a document record is discovered
- **THEN** the scraper emits a structured record containing the available document metadata fields for that record

### Requirement: PDF retrieval with descriptive persistence
The scraper SHALL attempt to download each discovered document PDF and persist files using deterministic, descriptive names within run-scoped artifact storage dedicated to PDF binaries.

#### Scenario: Successful PDF download
- **WHEN** a document has an accessible PDF resource
- **THEN** the scraper stores the PDF under the active run artifact directory inside a PDF-specific location using a stable descriptive filename derived from document data

#### Scenario: Missing PDF link
- **WHEN** a document lacks an accessible PDF resource
- **THEN** the scraper records the condition in run-scoped telemetry without terminating the run

### Requirement: Transformed dataset output separate from binaries
The scraper SHALL generate transformed record outputs in a run-scoped results location that is separate from PDF binary artifacts, and SHALL not embed PDF binary content in transformed datasets.

#### Scenario: JSON transformed output
- **WHEN** operators select JSON transformed output
- **THEN** the scraper writes a structured JSON dataset containing extracted record metadata and per-record download outcome fields

#### Scenario: CSV transformed output
- **WHEN** operators select CSV transformed output
- **THEN** the scraper writes a CSV dataset with stable columns derived from extracted metadata and per-record download outcome fields

#### Scenario: Artifact separation
- **WHEN** a run includes successful PDF downloads and transformed output generation
- **THEN** PDF files are stored in a PDF artifact directory and transformed CSV/JSON outputs are stored in a separate results directory

### Requirement: Configurable transformed output format
The scraper SHALL support run-level selection of transformed output format for extracted records.

#### Scenario: Explicit format selection
- **WHEN** operators provide a supported output format selection for transformed results
- **THEN** the scraper emits transformed output in the selected format for that run

#### Scenario: Unsupported format selection
- **WHEN** operators provide an unsupported transformed output format
- **THEN** the scraper fails fast with a descriptive configuration error before processing records

### Requirement: Resilient handling of rate limiting and transient failures
The scraper SHALL apply bounded retries with exponential backoff for rate-limited and transient download failures, and SHALL continue with remaining documents when retries are exhausted.

#### Scenario: Eventual success after rate limiting
- **WHEN** PDF download attempts return one or more 429 responses before a successful response
- **THEN** the scraper retries with increasing wait intervals and completes the download once success is returned

#### Scenario: Exhausted retries
- **WHEN** retry attempts reach the configured maximum without a successful response
- **THEN** the scraper marks the document as failed with a reason and proceeds to the next document

### Requirement: Progress and failure recoverability
The scraper SHALL persist run progress and failure records within the active run directory so operators can resume interrupted runs and retry failed documents for a selected bot and run.

#### Scenario: Resume after interruption
- **WHEN** a run is interrupted and restarted with resume enabled
- **THEN** the scraper resumes from persisted progress in the selected run scope instead of restarting completed work

#### Scenario: Retry failed set
- **WHEN** operators invoke failed-only retry mode
- **THEN** the scraper processes failed records from the selected run scope and updates resulting outcomes

### Requirement: Structured run-scoped observability
The scraper SHALL persist structured operational telemetry per run, including records, logs, and stage-aware errors that identify where failures occurred.

#### Scenario: Stage-aware error capture
- **WHEN** a request or processing step fails in any pipeline stage
- **THEN** the scraper appends a structured error event including stage, operation, timestamp, and available context fields without losing prior run data

#### Scenario: Fatal run termination
- **WHEN** the run terminates due to an unhandled error
- **THEN** the scraper emits a structured fatal error output that includes error type, message, and execution context for diagnosis

### Requirement: Human-friendly and machine-friendly logging
The scraper SHALL support both structured JSON logs and colorized human-readable console logs, while retaining structured persisted logs for automation.

#### Scenario: Pretty console mode
- **WHEN** operators select human-readable logging mode
- **THEN** console output renders colored log levels and concise context fields suitable for interactive monitoring

#### Scenario: JSON persistence mode
- **WHEN** run logging is persisted
- **THEN** log records are written as structured JSON lines compatible with downstream parsing tools

### Requirement: Deterministic verification of retry behavior
The project SHALL include automated unit-level verification that validates retry, backoff, and continuation behavior under simulated response sequences.

#### Scenario: Simulated 429 sequence
- **WHEN** tests simulate responses in the sequence 429, 429, then success
- **THEN** verification confirms bounded retries occurred and the final outcome is success

#### Scenario: Simulated persistent failure sequence
- **WHEN** tests simulate responses that never succeed within the retry limit
- **THEN** verification confirms the document is marked failed and subsequent documents are still processed
