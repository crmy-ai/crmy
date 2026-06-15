# Raw Context Reliability Plan

This plan hardens the core CRMy loop without widening the product surface:

`Raw Context -> Signals -> Memory -> Briefing -> Handoff / governed action`

The goal is simple: extraction should become boring. Messy GTM input can be unpredictable, but CRMy’s processing should be durable, replayable, scoped, observable, and conservative about confirmation.

## Principles

- Raw Context is high recall. Useful customer context should become reviewable Signals, not ingestion failures.
- Memory is conservative. Duplicate, stale, speculative, unresolved, or weakly evidenced Signals should not auto-promote.
- Time matters. Repeated copies of the same event must not count as independent corroboration, while later customer events may refresh or contradict prior context.
- Recovery must preserve permissions. Background retry runs as the original human or agent actor, not as an admin shortcut.
- Operators need receipts. Every failure should have a code, an attempt record, and a safe next action.

## Phase 1: Durable Receipts And Replay

Status: implemented in the first hardening slice.

- Store the full replayable source payload for `context_ingest_auto`.
- Track extraction attempts with parse/repair/model telemetry, failure codes, output excerpts, and latency.
- Add `source_occurred_at` so event time is distinct from ingestion time.
- Deduplicate exact same document + subject + actor + event time before re-extraction.
- Reprocess from activity first, retained payload second, excerpt only as a last resort.
- Surface stale/failed extraction receipts in Operations and support safe requeue.

## Phase 2: Durable Worker Path

Status: implemented in the first hardening slice.

- Keep the first extraction attempt synchronous when fast so the UI remains responsive.
- Ensure every Raw Context receipt can be recovered by the background worker.
- Claim pending Raw Context receipts with database locking and retry metadata.
- Re-run the shared reprocess path using the original actor’s visibility and scopes.
- Mark non-recoverable receipts with friendly failure codes instead of leaving them stuck.

## Phase 3: Golden GTM Extraction Corpus

Status: implemented for default and custom registries, with selected fixtures replayed through the full write/group/receipt pipeline without a live model.

Add a focused corpus that proves extraction quality over realistic customer-facing scenarios:

- champion / evaluator / economic-buyer mentions;
- procurement, legal, security, and approval path blockers;
- success criteria and rollout outcomes;
- new opportunity / use-case hints under a matched account;
- first-name disambiguation inside an account scope;
- duplicate transcripts or repeated pasted notes;
- no customer-specific context;
- malformed JSON and repairable model output;
- internal-only or unsupported source content;
- conflicting evidence across two real events.

Each fixture asserts expected Signals, proposed records, readiness status, and promotion behavior. The corpus includes golden model-output samples so parsing, proposal behavior, typed Memory readiness, and conservative auto-promotion expectations are executable without a live model. Selected fixtures also replay through `extractContextFromActivity`, so tests cover context writes, Signal grouping, Raw Context receipt updates, extraction attempts, and no-context outcomes.

The custom-registry corpus proves tenant-admin changes remain compatible with the engine:

- custom extractable Memory types;
- disabled default extractable types;
- stricter required fields;
- incomplete custom Signals remaining reviewable instead of becoming Memory.

## Phase 4: Source Independence And Readiness Calibration

Status: implemented for duplicate event protection and event-time-aware readiness/source-quality scoring.

- Treat repeated copies of the same source event as one evidence unit.
- Treat same claim from a later event as a refresh, not blind corroboration.
- Increase readiness only when evidence is meaningfully independent: different event, source channel, participant, or system.
- Normalize raw event labels such as call transcripts, meeting notes, manual Add Context, and MCP Raw Context so wording differences do not create fake source independence.
- Keep source weights visible and testable.
- Add regression tests that prove duplicate uploads cannot manufacture Memory.

## Phase 5: Scope Parity

Status: implemented for Raw Context receipt list/get/reprocess, MCP context tools, durable worker retry, and data-quality repair paths covered in the hardening suite; continue adding parity tests as new tools are introduced.

Audit and test every path that accepts Raw Context, Context Entry, Signal, Memory, Email, Activity, Graph, Lineage, or Briefing IDs:

- REST;
- MCP;
- CLI HTTP mode;
- Workspace Agent tools;
- background retry and data-quality repair.

Member users must not read, reprocess, brief, search, graph, or mutate peer-owned records. Managers see their team. Admins/owners see the tenant. No-subject Raw Context receipts are listable only to admins/owners or the actor that created them.

## Phase 6: Operations UX

Status: implemented for safe data-quality repair/requeue actions and Raw Context reliability guidance.

Make Raw Context failure handling obvious:

- `Retry extraction` through repairable data-quality findings;
- `View attempt` through sampled failed-attempt records;
- `Open Raw Context` from Raw Context views;
- `Link record` through source review flows;
- `Add missing context` from record and activity flows;
- `Check model settings` when extraction/model readiness fails.

Operators should not need database IDs or manual SQL to recover normal extraction failures.

## Release Bar

Current status: met for the 0.9 Raw Context reliability hardening pass.

This capability is ready for v0.9 confidence when:

- the golden corpus passes in CI;
- retry/reprocess is idempotent and permission-safe;
- duplicate source events cannot inflate readiness;
- Operations can recover common failures without DB access;
- agent, CLI, REST, and UI ingestion all produce equivalent receipts;
- extraction failure modes are visible, coded, and actionable.

The remaining polish is not a blocker: Operations can currently preview and run safe repairs from data-quality findings, while a deeper per-attempt drilldown can be added later if operators need more forensic detail.

## Validation Setup

Use the fast durability suite for day-to-day Raw Context reliability checks:

```bash
npm run test:durability --workspace=packages/server
```

Use the migrated Postgres integration suite when validating database behavior, migrations, locks, and idempotency:

```bash
npm run test:integration --workspace=packages/server
```

That command runs only when `CRMY_INTEGRATION_DATABASE_URL` or `TEST_DATABASE_URL` is set. For local development, CRMy also provides an explicit app-database validation command:

```bash
npm run test:integration:local --workspace=packages/server
```

The local command loads `.env`, uses `DATABASE_URL`, creates a temporary schema, runs migrations inside that schema, executes the integration checks, and drops the schema afterward. It should not be used against production databases.
