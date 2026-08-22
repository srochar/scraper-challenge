## Context

Current behavior in the scraper pipeline is ZIP-oriented for individual artifacts, while operators now require PDF downloads plus transformed datasets separated from binaries. The existing architecture already has strong building blocks for this change: session-aware portal traversal, per-record orchestration, retry/backoff download handling, run-scoped storage, and structured error/log persistence. See `proposal.md` (Why) for motivation and `specs/jurisprudencia-scraper/spec.md` for behavioral requirements.

Constraints that shape the implementation:
- The portal is JSF/RichFaces and requires consistent `ViewState`/session handling across pagination.
- Download failures (including 429) must remain non-blocking at record level.
- Existing run directory semantics should be preserved where possible to avoid breaking operational tooling.
- New transformed outputs must be explicit, deterministic, and binary-free.

## Goals / Non-Goals

**Goals:**
- Switch individual artifact retrieval to PDF-oriented target resolution and persistence.
- Introduce configurable transformed output format (`csv` or `json`) at run level.
- Persist transformed outputs in a dedicated results directory, separate from PDF binaries.
- Keep retry/backoff, continuation-on-failure, pagination, resume, and error telemetry behavior intact.
- Preserve deterministic record identity and stable output semantics for downstream consumers.

**Non-Goals:**
- Redesigning portal traversal or session lifecycle logic.
- Introducing new bulk download semantics.
- Adding schema-heavy data normalization beyond current extracted metadata surface.
- Changing queue/dispatcher strategy for network orchestration.

## Decisions

1. **Introduce a download target classification pivot for individual mode**

   - Decision: Resolve per-record download targets as PDFs for this flow and treat non-PDF links as missing/unsupported in individual processing.
   - Rationale: Aligns output with the immediate operational contract while preserving per-record processing semantics.
   - Alternatives considered:
     - Keep ZIP detection and add optional PDF later: rejected because it delays the requested contract change.
     - Download both ZIP and PDF for each record: rejected due to extra load/storage and unclear operator need.

2. **Add run-level transformed output selection with strict validation**

   - Decision: Add a runtime option for `resultFormat` constrained to `csv | json`, and fail fast on unsupported values.
   - Rationale: Operators need selectable export format while preserving predictable behavior.
   - Alternatives considered:
     - Always emit JSON only: rejected; does not satisfy configurable output requirement.
     - Emit both CSV and JSON always: rejected as default because of redundant writes and unnecessary complexity for simple runs.

3. **Separate storage roots for binary artifacts and transformed datasets**

   - Decision: Maintain PDF binaries under run-scoped artifact paths and write transformed datasets under a dedicated run-scoped results path.
   - Rationale: Clear separation improves downstream processing and avoids accidental binary coupling in analytics workflows.
   - Alternatives considered:
     - Keep transformed files next to artifact binaries: rejected for weaker boundary between content classes.
     - Store transformed data only in JSONL append logs: rejected because requirement calls for configurable final CSV/JSON output.

4. **Represent download outcome as first-class transformed fields**

   - Decision: Include outcome fields (`status`, attempts, optional file reference/url) in transformed outputs for each record.
   - Rationale: Supports auditability and reprocessing decisions without reading multiple sidecar files.
   - Alternatives considered:
     - Keep outcomes only in failures/errors files: rejected because main dataset would be incomplete for consumers.

5. **Preserve retry and continuation semantics unchanged for failure resilience**

   - Decision: Reuse existing bounded retry/backoff and non-blocking continuation behavior for PDF downloads.
   - Rationale: Existing resilience model is already validated and matches requirements.
   - Alternatives considered:
     - Tighten retry policy for PDF specifically: deferred; not required for this change and could alter runtime expectations.

## Risks / Trade-offs

- [Risk] Portal download actions may be inconsistent (direct link vs JSF-triggered action), leading to missing PDF resolution in edge records. -> Mitigation: centralize resolution rules and preserve `missing_link` outcome instead of hard failure.
- [Risk] CSV flattening of variable metadata keys may yield sparse or evolving columns across runs. -> Mitigation: define deterministic column ordering and include only observed keys for the run with stable sort.
- [Risk] Existing operator automation may assume ZIP artifact directories. -> Mitigation: document PDF-oriented artifact semantics and transformed output locations in runbook/README updates.
- [Trade-off] Strict `resultFormat` validation reduces ambiguity but can fail runs early for misconfiguration. -> Mitigation: provide descriptive config errors before record processing starts.

## Migration Plan

1. Add runtime/config support for transformed output format selection and result path resolution.
2. Update individual record target resolution and downloader wiring to PDF-focused behavior.
3. Add transformed output writer(s) for JSON and CSV, fed from processed record outcomes.
4. Integrate output generation into run finalization while preserving existing telemetry/progress files.
5. Update docs/config examples to reflect PDF artifacts plus transformed outputs.
6. Verify via unit tests and a bounded end-to-end run fixture.

Rollback strategy:
- Revert this change set to restore prior ZIP-oriented individual behavior and previous artifact assumptions.
