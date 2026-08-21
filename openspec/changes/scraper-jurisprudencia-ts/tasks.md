## 1. Project Setup and Baseline

- [x] 1.1 Initialize Node.js + TypeScript project structure (`src`, `test`, output/data folders) and verify `npm run build` completes successfully
- [x] 1.2 Add runtime dependencies for HTTP/parsing and test dependencies for unit testing/mocking, then verify `npm install` succeeds without errors
- [x] 1.3 Add executable scripts (run scraper, run tests, run lint/typecheck if included) and verify each script resolves from `package.json`

## 2. Stateful JSF Client and Response Normalization

- [x] 2.1 Implement a session-aware portal client that captures cookies and initial ViewState, and verify with a fixture-backed unit test that state is extracted from initial HTML
- [x] 2.2 Implement request-state refresh logic from subsequent responses, and verify unit tests confirm updated ViewState is used on follow-up requests
- [x] 2.3 Implement support for JSF partial AJAX requests/responses and verify unit tests parse `<partial-response>` updates into normalized HTML fragments

## 3. Result Traversal and Metadata Extraction

- [ ] 3.1 Implement result traversal orchestration for paginated/discoverable records and verify with fixtures that traversal stops only when no next page is available
- [x] 3.2 Implement metadata extraction into a structured record model and verify unit tests cover required and optional fields from representative samples
- [x] 3.3 Implement deterministic record identity and output serialization (for resume/use downstream) and verify repeated runs over same fixtures produce stable identifiers

## 4. PDF Resolution, Download, and Failure Handling

- [x] 4.1 Implement PDF target resolution from record/detail context and verify tests confirm resolved download targets for fixture records
- [x] 4.2 Implement bounded retry with exponential backoff and jitter for 429/transient failures and verify unit tests pass for 200-first-try, 429-then-success, and retry-exhausted scenarios
- [x] 4.3 Implement continuation semantics after per-document failure and verify tests confirm processing continues with subsequent documents
- [x] 4.4 Implement descriptive deterministic PDF naming and persistence rules and verify tests confirm filename stability and duplicate-safe behavior

## 5. Progress Persistence and Resume Modes

- [x] 5.1 Implement progress checkpoint persistence during runs and verify an interruption simulation resumes from the persisted cursor instead of restarting
- [x] 5.2 Implement failed-download recording with error categories and attempt metadata and verify failure artifacts are written for exhausted retries
- [x] 5.3 Implement failed-only retry mode and verify tests show only failed records are retried and status outcomes are updated

## 6. Verification, Documentation, and Bounded Live Validation

- [x] 6.1 Build a unit test suite covering JSF state handling, parser behavior, retry/backoff, and continuation semantics, and verify `npm test` passes consistently
- [x] 6.2 Add README usage documentation for full run, resume run, and failed-only retry workflows and verify commands are copy/paste executable
- [ ] 6.3 Execute a bounded live run against the target portal (or optional alternative when needed) and verify produced artifacts include structured metadata output, downloaded PDFs, and failure/progress logs
