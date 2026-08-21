## Purpose

Define the expected behavior of a resilient scraper that can traverse the jurisprudencia portal, extract document data, and retrieve associated PDFs despite rate limiting and long-running interruptions.

## ADDED Requirements

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
The scraper SHALL attempt to download each discovered document PDF and persist files using deterministic, descriptive names.

#### Scenario: Successful PDF download
- **WHEN** a document has an accessible PDF resource
- **THEN** the scraper stores the PDF on disk with a stable descriptive filename derived from document data

#### Scenario: Missing PDF link
- **WHEN** a document lacks an accessible PDF resource
- **THEN** the scraper records the condition without terminating the run

### Requirement: Resilient handling of rate limiting and transient failures
The scraper SHALL apply bounded retries with exponential backoff for rate-limited and transient download failures, and SHALL continue with remaining documents when retries are exhausted.

#### Scenario: Eventual success after rate limiting
- **WHEN** PDF download attempts return one or more 429 responses before a successful response
- **THEN** the scraper retries with increasing wait intervals and completes the download once success is returned

#### Scenario: Exhausted retries
- **WHEN** retry attempts reach the configured maximum without a successful response
- **THEN** the scraper marks the document as failed with a reason and proceeds to the next document

### Requirement: Progress and failure recoverability
The scraper SHALL persist run progress and failed-download records so operators can resume interrupted runs and retry only failed documents.

#### Scenario: Resume after interruption
- **WHEN** a run is interrupted and restarted with resume enabled
- **THEN** the scraper continues from persisted progress rather than restarting all completed work

#### Scenario: Retry failed set
- **WHEN** operators invoke a failed-only retry mode
- **THEN** the scraper processes the persisted failed-document set and updates their status outcomes

### Requirement: Deterministic verification of retry behavior
The project SHALL include automated unit-level verification that validates retry, backoff, and continuation behavior under simulated response sequences.

#### Scenario: Simulated 429 sequence
- **WHEN** tests simulate responses in the sequence 429, 429, then success
- **THEN** verification confirms bounded retries occurred and the final outcome is success

#### Scenario: Simulated persistent failure sequence
- **WHEN** tests simulate responses that never succeed within the retry limit
- **THEN** verification confirms the document is marked failed and subsequent documents are still processed
