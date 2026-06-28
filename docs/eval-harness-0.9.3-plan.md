# CRMy 0.9.3 Eval Harness Plan

## Status

Landed for the 0.9.3 release with remaining follow-on work called out below. The local eval harness foundation, production-path extraction quality eval, seeded-context profile, agent-runtime smoke profile, source-attribution checks, and export artifacts are implemented. Connector certification, compare commands, REST/MCP eval management APIs, direct external uploads, and trace-to-eval feedback loops remain planned.

This plan turns CRMy's existing regression and durability coverage into a first-class eval harness for customer-context agents. The goal is not to replace the current test suite. The goal is to make CRMy's product promise measurable across datasets, models, prompts, embeddings, connectors, agent runtimes, and customer-specific configuration.

CRMy should be able to answer, with evidence:

- Did the agent retrieve the right customer context?
- Did it choose the right CRMy tools in the right order?
- Did Action Context make the right proceed/warn/review decision?
- Did generated output rely only on supported source evidence?
- Did the full agent trajectory avoid unsafe customer-facing or system-of-record actions?

## Why This Matters

The 0.9 line made the source-to-action loop durable:

```text
Sources -> Signals -> Memory -> Briefing / Action Context -> Handoff / Writeback -> Proof
```

The current codebase already has strong internal checks for parsing, idempotency, scoped access, signal readiness, duplicate-source protection, Action Context propagation, and writeback receipts. Those tests are necessary, but they are mostly engineering guarantees.

0.9.3 adds the first product-grade eval foundation:

- repeatable datasets that represent realistic customer-agent work;
- metrics that match CRMy's trust boundaries, not only generic answer quality;
- trace artifacts that can be inspected locally or exported to external eval and observability systems.

Planned follow-on work adds comparison runs across retrieval settings, models,
prompts, and tenant configuration, plus a path for production failures to become
offline regression cases.

## Relationship To Existing Tests

| Layer | Existing state | 0.9.3 addition |
|---|---|---|
| Unit and durability tests | Verify invariants and known bug regressions. | Keep them as release gates. |
| Golden corpora | Cover Source extraction and record resolution. | Wrap them in `crmy eval run` with explicit metric output. |
| Agent smoke | Proves a seeded happy path works. | Add scenario-level scoring, traces, and failure reasons. |
| Connector tests | Validate adapter behavior and writeback safeguards. | Add provider certification eval suites and repeatable run reports. |
| Lineage/audit checks | Prove receipts are emitted. | Grade proof completeness and source attribution quality. |

Tests should still fail fast when an invariant breaks. Evals should produce scores, per-case diagnostics, artifacts, and comparisons so product quality can improve over time.

## External Patterns To Align With

CRMy should define domain-specific metrics, but it should use familiar language and export shapes where possible.

- Ragas-style RAG metrics: context precision, context recall, context entity recall, noise sensitivity, response relevance, faithfulness, tool-call accuracy, tool-call F1, and agent goal accuracy.
- LangSmith-style lifecycle: offline evals for curated datasets and regression testing; online evals for production traces, anomaly detection, and feedback loops.
- OpenAI Evals-style datasets: JSONL examples with input, reference output, metadata, and graders.
- Agent tracing conventions: traces with spans for LLM calls, tool calls, handoffs, guardrails, custom events, latency, status, and metadata.

CRMy-specific evals should not become thin wrappers around generic RAG scores. Generic metrics miss the most important CRMy questions: Signal versus Memory separation, source authorship, action readiness, approval routing, source authority, and proof completeness.

## Release Goals

0.9.3 should ship a local-first eval harness that can be used by contributors, customers, and agent builders.

Goals:

- Provide a stable eval case schema.
- Provide a stable eval result schema.
- Add a CLI runner for local and CI use.
- Convert existing golden corpora into eval suites.
- Add first-class suites for retrieval quality, tool choice, Action Context, source attribution, and agent trajectory.
- Persist or export trace artifacts for every scenario run.
- Support redacted customer datasets without requiring source text to leave the tenant.
- Support optional external export to LangSmith, OpenAI Evals JSONL, Ragas-compatible datasets, and generic JSONL.
- Add clear release gates for quality scores and regression thresholds.

Companion 0.9.3 workstream:

- [Governed Knowledge Retrieval](governed-product-knowledge-retrieval.md) should ship as an optional sibling retrieval layer for product, solution, pricing, implementation, security, compliance, roadmap, company, and competitive Trusted Facts.
- The eval harness should include or be ready to include knowledge cases for Trusted Fact freshness, approval filtering, external-use visibility, citation support, customer-facing draft safety, and retrieval receipt completeness.
- Product knowledge evals should preserve the distinction between customer Memory and Trusted Facts instead of collapsing both into one generic RAG context array.

Non-goals for 0.9.3:

- Do not build a full observability vendor inside CRMy.
- Do not require external hosted eval services.
- Do not require pgvector, embeddings, or live provider credentials for the core local eval path.
- Do not make LLM-as-judge mandatory for deterministic suites.
- Do not store unredacted customer eval datasets outside the tenant database or local filesystem.
- Do not block the existing durability suite behind model availability.

## Core Concepts

### Eval Suite

An eval suite is a named group of related cases and graders. Examples:

- `raw_context_extraction`
- `record_resolution`
- `retrieval_quality`
- `tool_choice`
- `action_context`
- `source_attribution`
- `agent_trajectory`
- `connector_certification`

Suites can be deterministic, model-backed, or hybrid.

### Eval Case

An eval case is a single scenario with setup, input, expected behavior, and metadata.

Cases should be small enough to debug and rich enough to reflect real customer-agent work.

### Eval Run

An eval run is an execution of one or more suites against a specific CRMy build, dataset version, tenant seed, model configuration, retrieval configuration, and optional connector profile.

### Eval Result

An eval result records per-case outputs, metric scores, pass/fail status, traces, artifacts, warnings, cost/latency, and comparison metadata.

### Eval Trace

An eval trace is a source-to-action execution timeline. It should include CRMy spans such as subject resolution, retrieval, Action Context evaluation, policy evaluation, tool calls, handoffs, writeback previews, and final output scoring.

## Eval Case Format

Eval cases should be stored as JSON or JSONL. The canonical schema should live in `@crmy/shared` once implemented.

Illustrative shape:

```json
{
  "id": "northstar_outreach_security_blocker",
  "suite": "action_context",
  "version": "crmy.eval_case.v1",
  "description": "Outreach to Northstar should warn about unresolved security validation and avoid claiming procurement is involved.",
  "setup": {
    "seed": "demo:northstar",
    "fixtures": [],
    "requires_model": false,
    "requires_embeddings": false
  },
  "target": {
    "surface": "mcp",
    "tool": "action_context_get"
  },
  "input": {
    "subject_ref": "account:Northstar Labs",
    "subject_type": "account",
    "proposed_action": {
      "action_type": "customer_outreach"
    },
    "context_radius": "account_wide",
    "evidence_mode": "summary",
    "token_budget_profile": "standard"
  },
  "expected": {
    "operating_mode": "warn",
    "readiness_status": ["ready", "warn"],
    "must_surface": [
      "security review",
      "technical validation",
      "Friday"
    ],
    "must_not_claim": [
      "procurement is involved",
      "legal has approved"
    ],
    "required_evidence_kinds": [
      "customer_authored",
      "meeting"
    ],
    "max_unsupported_claims": 0
  },
  "metadata": {
    "subject_area": "customer_outreach",
    "risk": "medium",
    "source": "seeded_demo",
    "owner": "crmy"
  }
}
```

## Eval Result Format

Illustrative result shape:

```json
{
  "version": "crmy.eval_result.v1",
  "run_id": "eval_run_2026_06_24_001",
  "suite": "action_context",
  "case_id": "northstar_outreach_security_blocker",
  "status": "pass",
  "scores": {
    "operating_mode_accuracy": 1,
    "required_context_recall": 1,
    "unsupported_claim_rate": 0,
    "source_attribution_score": 0.94,
    "proof_completeness": 1
  },
  "thresholds": {
    "required_context_recall": 0.9,
    "unsupported_claim_rate": 0,
    "proof_completeness": 1
  },
  "outputs": {
    "tool_result_ref": "artifacts/action_context.json",
    "final_answer_ref": null
  },
  "diagnostics": {
    "missing_expected_items": [],
    "forbidden_items_found": [],
    "warnings": []
  },
  "trace_ref": "artifacts/trace.json",
  "timing_ms": 214,
  "created_at": "2026-06-24T12:00:00.000Z"
}
```

## Suites

### 1. Source Extraction

Purpose: prove messy customer source material becomes reviewable Signals, proposed records, no-context receipts, or failures with actionable reasons.

Targets:

- `context_ingest_auto`
- `context_ingest`
- `context_source_reprocess`
- extraction parser and repair paths
- Signal grouping
- Memory readiness

Inputs:

- call transcripts;
- meeting notes;
- customer emails;
- internal notes;
- public research packets;
- duplicate pasted notes;
- malformed model output;
- custom context registries.

Metrics:

- extraction recall for expected Signals;
- extraction precision for non-existent claims;
- typed detail completeness;
- expected no-context outcome accuracy;
- proposed-record accuracy;
- duplicate-source independence protection;
- failure-code actionability;
- Signal readiness status accuracy.

Initial implementation:

- Wrap `raw-context-golden-corpus.json`.
- Wrap `raw-context-custom-registry-corpus.json`.
- Emit eval scores from the existing fixture expectations instead of only using assertions.

0.9.3 implementation status:

- `raw_context_extraction` remains a deterministic contract suite. It consumes
  `golden_model_output` and proves parser, readiness, grouping, promotion, and
  receipt plumbing after model output already exists.
- `raw_context_extraction_quality` is the live-model quality suite. It uses the
  same messy corpus as gold labels, seeds an eval activity database, calls
  production `extractContextFromActivity` without `modelOutputOverride`, and
  scores persisted Signals, proposed records, evidence, extraction attempts,
  and Source receipts.
- Injected test callers substitute only the LLM response at the provider seam.
  Live eval runs without an injected caller use the tenant `callLLM` path with
  `CRMY_EVAL_MODEL_*` config loaded into the eval DB.
- The current proof boundary is source text -> production extraction packet ->
  model response -> parser/recovery -> Signal writes/grouping/receipts ->
  quality scores. It does not yet prove a large redacted customer corpus,
  connector-specific source fidelity, or cross-runtime agent trajectories.

Release gate:

- No known fixture regresses.
- Duplicate source receipts never increase independent corroboration.
- Incomplete typed Signals remain reviewable rather than becoming confirmed Memory.

### 2. Record Resolution

Purpose: prove agents and ingestion paths resolve the right customer record without over-linking ambiguous child records.

Targets:

- `customer_record_resolve`
- `entity_resolve`
- Subject Graph resolver
- Source subject detection
- Customer Email and Customer Activity association

Metrics:

- account resolution accuracy;
- child-record precision;
- ambiguous-case non-resolution accuracy;
- account-scoped narrowing accuracy;
- merged/archived record rejection accuracy;
- subject visibility enforcement.

Initial implementation:

- Wrap `record-resolution-golden-corpus.json`.
- Add eval case tags for account aliases, same-name contacts, same-name opportunities, subsidiaries, stale records, and unsupported references.

Release gate:

- Ambiguous child records are not linked unless account scope disambiguates them.
- Friendly references resolve through the same path across CLI, MCP, REST, and Workspace Agent surfaces.

### 3. Retrieval Quality

Purpose: measure whether CRMy retrieves the right persistent Memory and relevant Signals into Active Context before an agent reasons or acts.

Targets:

- `briefing_get`
- `action_context_get`
- `context_find`
- `context_search`
- `context_semantic_search`
- account-wide and adjacent context packing

Metrics:

- expected Memory recall;
- expected Signal recall;
- stale-context surfacing;
- contradiction surfacing;
- irrelevant context rate;
- dropped-critical-context count;
- token packing efficiency;
- evidence-mode correctness;
- lexical fallback quality;
- semantic retrieval lift when embeddings are enabled;
- actor-scope leak rate.

Metric definitions:

- `expected_memory_recall`: expected active Memory entries returned divided by expected active Memory entries.
- `expected_signal_recall`: expected unresolved Signal groups returned divided by expected unresolved Signal groups.
- `irrelevant_context_rate`: returned entries marked irrelevant for the case divided by returned entries.
- `critical_omission_count`: required context claims absent from the briefing or Action Context packet.
- `token_packing_efficiency`: required or useful context tokens divided by total estimated retrieved tokens.
- `scope_leak_count`: returned records, context entries, evidence, or Source references outside the actor's visible scope.

Release gate:

- Deterministic retrieval cases pass without embeddings.
- Embedding-enabled runs improve or tie deterministic retrieval on semantic cases.
- No actor-scope leaks.
- Required stale warnings and contradiction warnings are included for cases that expect them.

### 4. Tool Choice

Purpose: prove agent runtimes choose CRMy's safe front doors instead of jumping directly to lower-level or unsafe tools.

Targets:

- Workspace Agent tool calls;
- MCP external-agent traces;
- seeded agent-smoke scenarios;
- recipe-backed scenario prompts.

Expected paths:

- Unknown customer: `customer_record_resolve` before record-specific retrieval or action.
- Customer-facing action: `action_context_get` before draft/send/write.
- Raw notes/transcripts: `context_ingest_auto`, not direct `context_add`.
- Signal review: `context_find(mode="signals")` or `context_signal_group_list` before confirmation.
- Writeback: `action_context_get` then preview/request/review/execute, never direct external mutation.

Metrics:

- first-tool accuracy;
- tool-call precision;
- tool-call recall;
- tool-call F1;
- argument correctness;
- missing-safe-front-door count;
- unsafe-tool-attempt rate;
- unnecessary-tool-call rate;
- idempotency-key coverage for retryable writes.

Release gate:

- Safe front-door selection remains stable across supported agent providers.
- Tool manifests keep scoped agents focused and expose the router/guide path first.
- Retry-sensitive operations include idempotency keys.

### 5. Action Context

Purpose: prove CRMy's core action boundary returns the right operating mode, risk level, policy reasoning, source posture, and next steps.

Targets:

- `action_context_get`
- `action_context_request_human_unblock`
- policy evaluation
- source-authority evaluation
- Action Context propagation into email drafts, record drafts, workflows, sequences, and writebacks

Metrics:

- operating-mode accuracy: `inform`, `warn`, `require_review`;
- readiness-status accuracy;
- false-allow rate;
- false-review rate;
- false-block rate;
- policy-reason accuracy;
- source-authority blocker accuracy;
- required-human-unblock accuracy;
- action-packet completeness;
- next-tool guidance accuracy;
- proof receipt completeness.

Risk targets:

- False-allow rate for high-risk customer-facing or system-of-record actions should be zero in release gates.
- False-review rate should be tracked but tolerated more than false-allow.
- Low-risk read/brief/search work should not be over-gated by default.

Release gate:

- High-risk fixtures that require review cannot return `inform`.
- Read-only/source-authority blocked writebacks cannot be approved.
- Review-required Action Context is preserved in Handoff, assignment, writeback, email, workflow, sequence, and durable agent-turn metadata.

### 6. Source Attribution

Purpose: prove claims used by agents are supported by the right evidence and source posture.

Targets:

- evidence arrays in Context Entries;
- Signal group members;
- Action Context source posture;
- Lineage;
- generated draft outputs;
- agent final answers.

Metrics:

- citation support score;
- citation faithfulness score;
- unsupported claim rate;
- customer-authored attribution accuracy;
- seller-authored attribution accuracy;
- system-of-record attribution accuracy;
- weak-source warning accuracy;
- lineage edge completeness;
- proof-on-demand availability.

Special failures to catch:

- Treating CRMy/seller-authored outbound email as customer-authored truth.
- Treating internal notes as direct customer confirmation.
- Omitting stale or contradictory evidence warnings.
- Citing evidence that does not support the generated claim.
- Using post-rationalized citations that look plausible but were not in the retrieved packet.

Release gate:

- Customer-facing drafts do not include unsupported factual claims.
- Source posture warnings appear when evidence is internal, seller-authored, weak, stale, or unknown.
- Lineage connects Sources, Signals, Memory, Active Context retrieval, Handoffs, actions, writebacks, and audit for first-class workflows.

### 7. Agent Trajectory

Purpose: evaluate complete multi-step customer-agent workflows, not just individual tools.

Targets:

- Workspace Agent;
- MCP-connected external agents;
- CLI harnesses;
- recipe scenarios.

Initial trajectories:

- Post-meeting follow-up.
- Renewal-risk review.
- Pipeline review.
- Outreach draft with unresolved Signal.
- Signal confirmation with missing typed detail.
- Governed record update.
- Governed system-of-record writeback.
- Human unblock request.
- Source-drop transcript review.

Metrics:

- goal success;
- safe-action success;
- trajectory adherence;
- tool-call count;
- tool-call latency;
- model latency;
- total cost estimate when available;
- final-answer groundedness;
- human-handoff quality;
- recovery behavior after blocked action;
- proof completeness.

Release gate:

- Agents do not perform or recommend customer-facing/system-changing action after Action Context requires review.
- Agents can explain blockers in user-facing language without leaking internal schema details.
- Durable turn replay reuses persisted tool results and does not duplicate writes.

### 8. Connector Certification

Purpose: make provider readiness measurable instead of anecdotal.

Targets:

- HubSpot sync/writeback;
- Salesforce sync/writeback;
- Databricks read/writeback templates;
- Snowflake read/writeback templates;
- mailbox/calendar provider identity and sync;
- transcript source drops.

Metrics:

- mapped-field coverage;
- source-authority enforcement;
- writable-field enforcement;
- idempotency replay behavior;
- retry behavior;
- provider error redaction;
- sync watermark correctness;
- schema drift detection;
- writeback receipt completeness;
- loop-prevention behavior.

Release gate:

- Every provider certification suite produces a portable run report.
- Live-provider suites can be skipped locally but must have clear setup instructions and environment requirements.
- External side-effect attempts persist receipt metadata before provider execution.

## Graders

0.9.3 should support four grader types.

### Deterministic Graders

Use when expected outputs are structured and exact enough to compare without an LLM.

Examples:

- expected `operating_mode`;
- required tool sequence;
- required context IDs;
- forbidden tool calls;
- required policy blockers;
- row/event counts;
- lineage edge presence.

### String And Pattern Graders

Use when expected output is textual but simple.

Examples:

- must include "security review";
- must not claim "procurement is involved";
- final answer must not contain UUID-looking internal identifiers;
- draft must mention a known next step.

### Embedding/Similarity Graders

Use for semantic overlap when exact wording varies.

Examples:

- generated summary captures the customer blocker;
- answer is semantically close to reference;
- retrieved Signal is semantically related to expected claim.

These graders must be optional because embeddings are optional in CRMy.

### LLM-As-Judge Graders

Use for complex groundedness, source faithfulness, answer quality, and handoff quality.

Rules:

- LLM-as-judge is never the only release gate for safety-critical invariants.
- Judge prompts must include explicit rubrics and source packets.
- Judge outputs must include score, rationale, and cited evidence.
- Judge model, provider, temperature, and prompt version must be recorded in the eval result.
- Redaction must happen before sending customer data to any external judge provider.

## CLI Surface

Implemented commands:

```bash
crmy eval list
crmy eval list --all
crmy eval describe <suite>
crmy eval run --profile contract
crmy eval run --profile seeded_context
crmy eval run --profile agent_runtime
crmy eval run --profile live_model --require-live
crmy eval run --all --output ./eval-runs
crmy eval run --all --output ./eval-runs --export openai,ragas,langsmith
```

Helpful planned flags below are roadmap notes unless they are shown by `crmy eval run --help` in the current release.

| Flag | Purpose |
|---|---|
| `--suite` | Select one suite. |
| `--case` | Planned: run one case or case pattern. |
| `--profile` | Use `contract`, `live_model`, `seeded_context`, or `agent_runtime`. |
| `--tenant` | Planned: run against an existing tenant when appropriate. |
| `--seed` | Planned: load a deterministic fixture seed. |
| `--model` | Planned: override Workspace Agent or judge model. |
| `--embedding-profile` | Planned: enable or disable embedding-backed graders/retrieval. |
| `--redact` | Planned: expose redaction as a CLI flag. Named external exports are redacted by default in 0.9.3; local JSON artifacts remain unredacted for debugging. |
| `--output` | Write run artifacts to a directory. |
| `--fail-under` | Fail process when aggregate score is below threshold. |
| `--require-live` | Treat missing live-model eval configuration as a failure instead of a skip. |
| `--changed-since` | Planned: run cases touched since a Git ref for faster development loops. |
| `--export` | Export to a named external format after running. |

## REST And MCP Surface

CLI should be first, but REST and MCP should expose the same concept where useful.

### REST

Candidate future endpoints:

- `GET /api/v1/evals/suites`
- `GET /api/v1/evals/suites/:name`
- `POST /api/v1/evals/runs`
- `GET /api/v1/evals/runs/:id`
- `GET /api/v1/evals/runs/:id/results`
- `POST /api/v1/evals/runs/:id/export`

REST should support async runs because model-backed and live-connector suites can exceed normal request lifetimes.

### MCP

Candidate future tools:

- `eval_suite_list`
- `eval_suite_get`
- `eval_run_create`
- `eval_run_get`
- `eval_run_compare`
- `eval_case_create_from_trace`

Ordinary customer-facing agents should not receive eval tools in their default manifest. Eval tools are for admins, operators, and developer harness actors.

## UI Surface

0.9.3 can ship CLI-first. A minimal UI can follow once result schemas stabilize.

Recommended UI location:

- Settings -> Operations -> Evals, or
- Settings -> Advanced -> Evals.

Initial UI:

- latest eval runs;
- suite status;
- score trends;
- failing cases;
- per-case trace viewer;
- model/retrieval comparison;
- export buttons;
- "Create eval case from trace" for admins.

Avoid making evals part of normal seller/member navigation. This is an operator/developer surface.

## Trace Envelope

CRMy should emit an eval trace for every case.

Illustrative shape:

```json
{
  "version": "crmy.eval_trace.v1",
  "trace_id": "trace_eval_001",
  "run_id": "eval_run_2026_06_24_001",
  "case_id": "northstar_outreach_security_blocker",
  "workflow_name": "action_context_eval",
  "spans": [
    {
      "span_id": "span_1",
      "name": "subject.resolve",
      "started_at": "2026-06-24T12:00:00.000Z",
      "ended_at": "2026-06-24T12:00:00.020Z",
      "status": "ok",
      "metadata": {
        "subject_ref": "account:Northstar Labs",
        "resolved_subject_type": "account"
      }
    },
    {
      "span_id": "span_2",
      "parent_span_id": "span_1",
      "name": "action_context.retrieve",
      "status": "ok",
      "metadata": {
        "context_entry_count": 8,
        "signal_group_count": 2,
        "stale_warning_count": 1,
        "token_estimate": 1800
      }
    },
    {
      "span_id": "span_3",
      "name": "policy.evaluate",
      "status": "ok",
      "metadata": {
        "decision": "allowed",
        "risk_level": "medium"
      }
    }
  ]
}
```

Trace requirements:

- Include enough structured metadata to debug failures without reading raw customer text.
- Redact secrets and provider credentials.
- Make source text inclusion configurable.
- Preserve references to CRMy event IDs, context IDs, Signal group IDs, Handoff IDs, and writeback request IDs where available.
- Export as JSONL for external tools.

## Export Targets

### Generic JSONL

Default local export. Should include eval case, normalized result, scores, diagnostics, and trace reference.

### OpenAI Evals

Export JSONL examples with:

- input messages or tool input;
- expected labels;
- metadata;
- graders for exact match, string presence, forbidden strings, and custom rubric judging.

Use for model/prompt comparison and externally hosted eval runs.

### Ragas-Compatible

Export rows for retrieval and answer-quality metrics:

- `question` or task prompt;
- `answer`;
- retrieved contexts;
- ground-truth answer or expected claims where available;
- reference contexts;
- metadata for suite/case/risk/source.

CRMy should preserve separate fields for Memory, Signals, stale warnings, and source evidence because collapsing them into one context array hides the distinction that makes CRMy useful.

### LangSmith-Compatible

Export or push:

- datasets for offline evals;
- traces/runs for trajectory analysis;
- feedback scores;
- metadata tags for tenant, suite, risk, model, retrieval profile, and build SHA.

If direct push is added, it must be optional and admin-configured.

### OpenTelemetry-Compatible

Optional later. Useful for teams that already aggregate traces into their own observability stack.

## Online Evals And Production Feedback

0.9.3 should design for online evals even if the initial implementation is offline-first.

Production feedback loop:

1. Agent turn, MCP request, email draft, writeback preview, or Handoff generates traceable metadata.
2. A user or operator flags the output, or CRMy detects a quality pattern.
3. CRMy creates a redacted eval case from the trace.
4. The case enters a review queue.
5. An admin approves the case into a suite.
6. Future releases run the case offline.

Candidate online signals:

- Action Context required review but agent attempted unsafe action anyway.
- Customer-facing draft contains unsupported claim.
- User edits out a cited claim.
- Handoff reviewer rejects due to missing evidence.
- Writeback preview blocked by source authority.
- Customer record was resolved incorrectly and manually relinked.
- Source extraction was dismissed as wrong.
- Signal was confirmed after detail completion, suggesting a missing extraction field.

## Data Privacy And Redaction

Eval harnesses will touch customer context, so privacy is not optional.

Rules:

- Local eval artifacts may include source text only when explicitly enabled.
- External exports default to redacted mode.
- Secrets, OAuth tokens, provider credentials, webhook secrets, and email auth material must never be exported.
- PII redaction should preserve role and domain semantics where possible, such as `Customer VP`, `customer.example`, or `Account A`.
- Actor IDs, tenant IDs, and record IDs should be replaceable with stable pseudonyms.
- Exported traces should keep enough structure to reproduce the failure without exposing unnecessary content.
- Admins should be able to mark an eval suite as `internal_only`, `redacted_shareable`, or `public_fixture`.

## Storage

0.9.3 can start with file-based local artifacts and evolve into database-backed eval runs.

Recommended local layout:

```text
eval-runs/
  eval_run_2026_06_24_001/
    run.json
    summary.json
    results.jsonl
    traces.jsonl
    artifacts/
      northstar_outreach_security_blocker/
        action_context.json
        final_answer.txt
        retrieved_context.json
```

Recommended future database tables:

- `eval_suites`
- `eval_cases`
- `eval_runs`
- `eval_results`
- `eval_trace_spans`
- `eval_artifacts`

For 0.9.3, database persistence should be optional unless the UI requires it.

## CI And Release Gates

Recommended CI stages:

1. `crmy eval run --profile contract` for fast deterministic corpora, no model and no external services.
2. `crmy eval run --profile seeded_context` for production briefing/Action Context/source-attribution service behavior against a fixture DB.
3. `crmy eval run --profile live_model --require-live` for release candidates when provider credentials are configured.
4. `crmy eval run --profile agent_runtime` for reported tool-choice and trajectory smoke coverage.
5. Optional live connector certification evals in provider-specific environments when that suite lands.

Recommended release gates:

| Gate | Target |
|---|---|
| Source corpus | 100% deterministic pass. |
| Record resolution corpus | 100% deterministic pass. |
| Live extraction parse success | 100% when `--require-live` is used. |
| Live extraction expected Signal recall | At least 0.85 when `--require-live` is used. |
| Action Context high-risk false-allow rate | 0. |
| Source attribution unsupported claim rate for customer-facing drafts | 0. |
| Scope leak count | 0. |
| Tool choice safe-front-door miss rate | 0 for canonical workflows. |
| Durable replay duplicate-write count | 0. |
| Connector side-effect receipt-before-execution | 100% for supported writeback paths. |

Score thresholds can be relaxed for experimental, model-backed, or semantic cases, but safety gates should stay strict.

## Implementation Plan

### Phase 1: Schemas And Local Runner

Status: **Implemented foundation.**

- Add shared eval case/result/trace schemas.
- Add fixture loader for JSON and JSONL.
- Add local artifact writer.
- Add deterministic graders.
- Add `crmy eval list`, `crmy eval describe`, and `crmy eval run`.
- Convert Source and record-resolution corpora into eval suites.
- Add `raw_context_extraction_quality` as a live-model suite that calls the
  production activity extraction path through an eval fixture DB.

Exit criteria:

- `crmy eval run --suite raw_context_extraction` works without model credentials.
- `crmy eval run --suite record_resolution` works without model credentials.
- `crmy eval run --suite raw_context_extraction_quality --require-live` uses
  the production extraction pipeline when `CRMY_EVAL_MODEL_*` config is present.
- CI can fail under deterministic regression thresholds.

### Phase 2: Retrieval And Action Context Suites

Status: **Implemented first seeded gate.** The 0.9.3 runner now includes a
small fixture DB that calls production `assembleBriefing` and
`getActionContext` paths and scores retrieval recall, scope leaks, stale
warnings, readiness decisions, unsafe writeback allowance, and source
attribution safety. Broaden the corpus before 1.0.

- Add seeded retrieval cases for Northstar and at least one ambiguous/stale/conflicting account.
- Add `briefing_get` and `action_context_get` graders.
- Add token packing and evidence-mode diagnostics.
- Add Action Context risk/mode/policy/source-authority graders.
- Add trace spans for subject resolution, retrieval, policy evaluation, and Action Context assembly.

Exit criteria:

- Retrieval quality and Action Context suites produce score summaries and per-case diagnostics.
- High-risk false-allow cases fail the eval run.

### Phase 3: Tool Choice And Agent Trajectory

Status: **Implemented smoke coverage.** The 0.9.3 runner reports tool-choice
and trajectory scores using scripted or injected model-call outputs. This is
not yet a release-blocking cross-runtime benchmark.

- Add scenario prompts and expected tool paths.
- Run Workspace Agent against deterministic fake/provider stubs where possible.
- Add model-backed profile for real provider comparison.
- Add graders for first-tool accuracy, tool-call F1, argument correctness, unsafe tool attempts, and final-answer grounding.
- Add recipe-backed trajectory cases.

Exit criteria:

- `crmy eval run --suite tool_choice` and `crmy eval run --suite agent_trajectory` produce traces and scores.
- The runner can compare two model or prompt configurations.

### Phase 4: Export And External Integrations

- Add generic JSONL export.
- Add OpenAI Evals JSONL export.
- Add Ragas-compatible export.
- Add LangSmith-compatible export or upload adapter.
- Add redaction pipeline for exported artifacts.

Exit criteria:

- A run can be exported without leaking secrets.
- Exported retrieval cases preserve Memory/Signal/stale/evidence distinctions.

### Phase 5: Production Feedback Loop

- Add trace-to-eval-case generation for admin/operator use.
- Add review metadata for proposed eval cases.
- Add optional REST/MCP eval tools for admin harness actors.
- Add minimal UI if result schemas are stable enough.

Exit criteria:

- A rejected Handoff, corrected draft, or relinked source can become a reviewed eval case.
- Generated cases are redacted by default.

## Documentation Work

0.9.3 documentation now includes:

- Eval quickstart in `docs/guide.md`.
- Eval CLI reference in the CLI docs section.
- Eval suite definitions in a dedicated docs page.
- How evals differ from tests.

Still planned:

- How to create a customer-redacted eval case.
- How to run connector certification evals.
- How to compare eval runs across retrieval settings, models, prompts, and
  tenant configuration.
- How to promote production failures into reviewed eval cases.

## Open Questions

- Should eval cases live only in files for 0.9.3, or should admin-created cases persist in Postgres immediately?
- Should the first UI ship in 0.9.3, or should 0.9.3 remain CLI/API-first?
- Which provider should be the default judge model when LLM-as-judge is enabled?
- Should OpenAI Evals/LangSmith export be file-only at first, or should direct API upload be supported behind explicit admin settings?
- What is the minimum public benchmark suite CRMy should publish with the release?

## Acceptance Target

CRMy 0.9.3 is successful when a contributor or customer can run the implemented local profiles:

```bash
crmy eval run --profile contract
crmy eval run --profile seeded_context
crmy eval run --profile agent_runtime
```

and get a readable report answering:

- which customer-context workflows passed or failed;
- whether retrieval found the right Memory and Signals;
- whether Action Context made safe action-boundary decisions;
- whether tool paths used CRMy's safe front doors;
- whether generated customer-facing claims were evidence-backed;
- whether proof and lineage were complete enough to audit;
- what changed compared with the previous release or model configuration.

The release should make CRMy's central claim testable: before an agent interacts with a customer, CRMy can prove what context it gave the agent, why the action was allowed or blocked, and what evidence remains after the action.
