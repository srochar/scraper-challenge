## Context

See `proposal.md` for motivation and scope. The target portal is JSF/RichFaces and serves search/result content through stateful requests that depend on session cookies and `javax.faces.ViewState`. Recent exploration confirmed partial AJAX responses (`Faces-Request: partial/ajax`) and dynamic content updates in `formBuscador:panel`, so the scraper must model request state transitions instead of assuming static pagination links.

The challenge constrains implementation to TypeScript plus HTTP/parsing libraries, with no browser automation. The site may emit HTTP 429 for PDF retrieval, and this behavior can be infrequent, so verification must be deterministic through unit tests that simulate response sequences.

## Goals / Non-Goals

**Goals:**
- Build a stateful scraping architecture that can navigate JSF result flows and collect document metadata.
- Support resilient PDF download with bounded retries, exponential backoff, jitter, and continuation after failure.
- Persist progress and failed downloads for resume and targeted retries.
- Make retry and continuation behavior testable offline through unit tests and mocked responses.

**Non-Goals:**
- Real-time browser emulation or JavaScript DOM execution.
- A generic crawler framework for arbitrary websites.
- Perfectly stable selectors against all future UI redesigns; instead, provide practical fallback parsing strategies.

## Decisions

### 1) Layered pipeline with explicit boundaries
Decision: implement the scraper as composable modules: `PortalClient` (stateful HTTP + JSF payloads), `ResultParser`, `PdfDownloadService`, `RunStore` (progress/failures), and `ScrapeOrchestrator`.

Rationale:
- Keeps volatile protocol logic (JSF state handling) isolated from parsing and retry policy.
- Enables unit tests around small deterministic units.
- Improves maintainability when site fields or request payloads evolve.

Alternatives considered:
- Single monolithic script: faster to start but fragile, hard to test, and hard to resume safely.

### 2) Stateful JSF client contract
Decision: model a JSF session object that tracks cookies, current ViewState, and request form identifiers; after each response, extract and refresh ViewState before the next request.

Rationale:
- Exploration showed responses include mutable ViewState values, and stale state can invalidate follow-up requests.
- Session continuity is required for consistent result traversal.

Alternatives considered:
- Stateless request replay: simpler but unreliable on JSF portals with evolving state tokens.

### 3) Dual response parsing strategy
Decision: parse both full HTML pages and JSF partial XML responses. For partial responses, decode `update` payloads and parse embedded HTML fragments (especially the result panel).

Rationale:
- JSF interactions may return `<partial-response>` instead of full documents.
- Normalizing both response types into shared domain models avoids duplicated business logic.

Alternatives considered:
- Full-page only scraping: misses AJAX-driven updates and can silently lose records.

### 4) Retry policy as injectable behavior
Decision: implement retry policy as a pure, configurable component used by `PdfDownloadService` with parameters: `maxRetries`, `initialDelayMs`, `backoffMultiplier`, `maxDelayMs`, and `jitterRatio`.

Rationale:
- Makes behavior deterministic in tests by injecting time/sleep/random abstractions.
- Allows safe tuning for production-like runs without code changes.

Alternatives considered:
- Hard-coded retries in download loop: less flexible and difficult to verify thoroughly.

### 5) Failure isolation and resumability
Decision: persist two append-friendly artifacts during execution:
- progress checkpoint (last processed cursor/page/document id)
- failure log with document identity, reason category, and attempt metadata

Rationale:
- Supports long-running operations and crash recovery.
- Enables explicit failed-only reruns, required by challenge expectations.

Alternatives considered:
- In-memory-only tracking: easier initially but unusable for interrupted runs.

### 6) Test strategy centered on behavior contracts
Decision: prioritize unit tests for protocol, parsing, and retry outcomes with mocked HTTP transport and fake timers; add a lightweight smoke flow test over canned fixtures.

Rationale:
- 429 events are nondeterministic in real environments.
- Tests must prove continuation semantics even when one document fails persistently.

Alternatives considered:
- Depend mostly on end-to-end tests against live site: flaky due to VPN, data drift, and server variability.

## Risks / Trade-offs

- [JSF element IDs may shift across deployments] -> Mitigation: derive selectors from stable structure/text where possible and centralize parser fallbacks.
- [Rate-limiting profile may vary by time or IP] -> Mitigation: configurable throttling and conservative default concurrency.
- [Large result sets increase runtime and storage] -> Mitigation: checkpointing, resume mode, and incremental output flush.
- [PDF endpoints may require indirect request flow] -> Mitigation: capture link/action metadata per record and route through a dedicated resolver step before download.
- [Overfitting tests to one response sample] -> Mitigation: include multiple HTML/XML fixtures and scenario-driven parser assertions.

## Migration Plan

1. Scaffold project and baseline configuration for TypeScript execution and tests.
2. Implement stateful portal client and response normalization over recorded fixtures.
3. Implement parser and orchestrator for traversal and metadata emission.
4. Implement PDF resolver/downloader with retry policy and failure recording.
5. Add checkpoint/resume and failed-only retry command modes.
6. Validate against a bounded live run, inspect logs/output, and tune rate limits.

Rollback strategy:
- Feature is additive in a new repository context; rollback is reverting the introduced scraper modules and scripts.

## Open Questions

- What is the most stable record identity to persist for resume semantics when display fields are incomplete?
- Are there portal-side anti-automation controls beyond 429 (for example, challenge pages) that require explicit detection and fail-fast messaging?
