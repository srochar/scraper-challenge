## MODIFIED Requirements

### Requirement: PDF retrieval with descriptive persistence
The scraper SHALL attempt to download each discovered document PDF and persist files using deterministic, descriptive names within run-scoped artifact storage dedicated to PDF binaries.

#### Scenario: Successful PDF download
- **WHEN** a document has an accessible PDF resource
- **THEN** the scraper stores the PDF under the active run artifact directory inside a PDF-specific location using a stable descriptive filename derived from document data

#### Scenario: Missing PDF link
- **WHEN** a document lacks an accessible PDF resource
- **THEN** the scraper records the condition in run-scoped telemetry without terminating the run

## ADDED Requirements

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
