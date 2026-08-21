## MODIFIED Requirements

### Requirement: PDF retrieval with descriptive persistence
The scraper SHALL attempt to download each discovered document PDF and persist files using deterministic, descriptive names within run-scoped artifact storage.

#### Scenario: Successful PDF download
- **WHEN** a document has an accessible PDF resource
- **THEN** the scraper stores the PDF under the active run artifact directory using a stable descriptive filename derived from document data

#### Scenario: Missing PDF link
- **WHEN** a document lacks an accessible PDF resource
- **THEN** the scraper records the condition in run-scoped telemetry without terminating the run

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
