# CRMy 0.8-1.0 Roadmap: Enterprise Systems-Of-Record Overlay

CRMy's next major releases should move the product from a local-first customer context layer into the default context and execution platform between AI agents and enterprise revenue systems.

The goal is not to replace Salesforce, HubSpot, Databricks, Snowflake, or future systems of record. The goal is to give agents one governed layer for typed revenue objects, long-term memory, scoped tools, HITL approvals, retry-safe writes, and audit-safe execution across those systems.

## Strategic Direction

Chosen defaults for the 0.8-1.0 line:

- **0.8 supports CRM and warehouse systems of record.** Salesforce, HubSpot, Databricks SQL Warehouse / Delta-backed tables, and Snowflake are the first targets.
- **0.9 hardens the source-to-action loop.** The priority is not more surface area. The priority is proving that messy customer context reliably becomes Signals, trusted Memory, governed human decisions, and auditable action.
- **1.0 is resilience at scale.** The priority is making CRMy dependable on serverless Postgres with high-volume Raw Context, Signals, Memory, source sync, agent work, MCP traffic, and audit history.
- **Warehouses can be authoritative.** CRMy should not assume the CRM is always the primary system of record.
- **Warehouse writeback is governed.** Agents cannot run arbitrary SQL writes. Writes must use configured mappings and approved write modes.
- **Automations and Sequences reuse the existing event bus.** Connector and warehouse sync should emit normal CRMy events so existing triggers, HITL, audit, and context extraction keep working together.
- **CRMy remains the typed operational overlay.** External systems feed and receive governed state, but agents operate through CRMy's typed objects, policies, tools, and audit trail.
- **The README promise remains future-proof.** v0.9 should close the reliability gaps underneath that promise rather than weakening the positioning.

## What Prevents CRMy From Being The Default Today

### 1. System-of-record connectivity is not first-class yet

CRMy has plugins, webhooks, REST, MCP, imports, and a strong internal event model, but it does not yet have native connectors with:

- external system registration
- external record references
- object and field mappings
- sync runs and watermarks
- conflict detection and resolution
- source authority rules
- governed writeback requests
- connector health and replay

Without this layer, CRMy risks becoming another operational store instead of the trusted bridge between agents and enterprise systems.

### 2. Warehouses are not modeled as operational sources

Enterprise revenue state increasingly lives in warehouses and lakehouses, not only CRMs. CRMy needs a path for Databricks and Snowflake to provide account, contact, opportunity, activity, product usage, health, and renewal data.

The difficult part is not reading rows. The difficult part is mapping rows into typed agent-safe objects, tracking source authority, handling schema drift, emitting events, and governing writeback.

### 3. Automations need source-aware triggers

The existing workflow engine subscribes to event types such as `contact.created`, `account.updated`, `opportunity.stage_changed`, and `activity.created`. Connector sync should feed that same model, with additional metadata for origin, source system, sync run, external record, changed fields, confidence, and conflict state.

Without this, CRMy would create a parallel sync automation system that users have to learn separately.

### 4. Sequences need external-event awareness

Sequences already handle enrollment, AI-generated steps, branch/wait logic, HITL gates, reply detection, and goal events. External system updates should be able to enroll contacts, complete goals, branch journeys, or pause for review without bypassing the sequence engine.

### 5. External writes require stronger governance

CRMy already has scopes, HITL, idempotency, optimistic concurrency, and audit. External writes need the same safety plus:

- write previews
- source authority checks
- destination-specific policies
- loop prevention
- writeback receipts
- replay/recovery status
- redacted secrets and safe logs

## 0.8: Systems-Of-Record Bridge

Goal: connect CRMy to real enterprise systems while preserving typed objects, scoped tools, retry-safe writes, HITL, audit, and existing Automations/Sequences.

### Core Platform

Introduce a generic **System of Record** abstraction that supports CRM, warehouse, and future operational sources.

Add shared records for:

- external systems
- external record references
- field mappings
- sync runs
- sync conflicts
- writeback requests
- source authority rules

The abstraction should support these first-party system types:

- `salesforce`
- `hubspot`
- `databricks`
- `snowflake`

### CRM Connectors

Salesforce and HubSpot should support the initial read/write mapping for:

- accounts / companies
- contacts
- opportunities / deals
- activities
- notes
- owners
- selected custom fields

Writes should go through CRMy mutation semantics: idempotency, expected versions when available, audit events, and HITL when required by policy.

### Warehouse And Lakehouse Connectors

Databricks and Snowflake should support table/view mappings into:

- accounts
- contacts
- opportunities
- activities
- context entries
- health signals
- product usage signals
- custom fields

Warehouse sync should support:

- configured SQL read queries or selected tables/views
- primary key and external ID mapping
- incremental watermark columns
- changed-field detection where possible
- schema drift warnings
- row-level error reporting
- source freshness indicators

### Governed Warehouse Writeback

Warehouse writeback is allowed in v0.8 only through configured write modes:

- **Append-only event table** - safest default for agent actions, activity logs, context observations, and write receipts.
- **Upsert into approved mapped table** - allowed only for fields explicitly mapped as writable.
- **Approved stored procedure call** - allowed only for named procedures with typed input schemas.

Arbitrary agent-generated SQL writes are out of scope for v0.8.

Every external write requires:

- preview
- source authority check
- actor scope check
- approval policy evaluation
- idempotency key
- audit event
- writeback receipt
- sync status

### Connector Health

Add operational visibility for:

- last successful sync
- failed syncs
- stale systems
- unmapped fields
- schema drift
- pending writebacks
- conflicts
- retryable errors
- replay status

## Automations And Sequences Integration

Goal: external updates feel native to CRMy.

### Event Metadata

All connector and warehouse sync changes should emit normal CRMy events with source metadata:

```json
{
  "origin": "warehouse_sync",
  "system_id": "uuid",
  "system_type": "databricks",
  "external_record_id": "customer_123",
  "sync_run_id": "uuid",
  "changed_fields": ["health_score", "renewal_date"],
  "confidence": 0.92,
  "conflict_state": "none"
}
```

Allowed `origin` values:

- `crmy`
- `crm_sync`
- `warehouse_sync`
- `agent`
- `workflow`
- `sequence`

### Workflow Triggers And Filters

Existing workflow trigger events continue to work:

- `contact.created`
- `contact.updated`
- `account.updated`
- `opportunity.stage_changed`
- `activity.created`
- `use_case.updated`

Add workflow filter support for:

- origin
- system ID
- system type
- external record ID
- sync run ID
- changed fields
- confidence
- conflict state

Add workflow actions for governed external operations:

- request external writeback
- run connector resync
- create sync conflict review
- create context entry from external change

### Loop Prevention

Connector-originated events must not create infinite loops.

Default rules:

- Sync-originated events cannot write back to the same source unless explicitly allowed.
- Workflow and sequence writebacks carry origin metadata and idempotency keys.
- Replayed sync events do not create duplicate workflow runs.
- Writeback receipts are emitted separately from user-facing object changes.

### Sequence Integration

External events can:

- enroll a resolved contact in a sequence
- complete a sequence goal event
- branch on source-system changes
- pause for HITL before externally visible sends or writes

If an external event cannot resolve to a contact, account, opportunity, or use case, CRMy should create a data-quality finding or assignment instead of silently skipping it.

## 0.9: Context And Action Engine Hardening

Goal: make the core CRMy promise operationally provable: before any agent acts on a customer, CRMy can tell it what is true, what is stale, what is inferred, what is approved, what system owns the record, what action is allowed, and what proof/audit trail will exist afterward.

0.9 should make CRMy feel like the default context and action engine for agents working with humans across sales, customer success, and other customer-facing workflows.

### Release Thesis

The 0.9 release should focus on reliability, proof, and agent readiness rather than broad new product surface area.

CRMy already has the right spine:

- Raw Context
- Signals
- Memory
- Handoffs
- Systems of Record
- Workspace Agent
- MCP / CLI / REST
- scoped human actors
- lineage and audit

The 0.9 work is to make that spine dependable enough for real users and external agents.

### 1. Extraction Reliability And Typed Memory Readiness

Raw Context ingestion is the heart of CRMy. In 0.9 it should be treated like critical infrastructure.

Key changes:

- Durable extraction jobs for app, REST, MCP, CLI, email, and meeting sources.
- One bounded extraction pass per source where possible, with account-scoped subject resolution before child record matching.
- Structured-output support for providers that support it, with strict JSON repair and clear failure receipts for providers that do not.
- Retry and catch-up behavior for timeouts, malformed JSON, unavailable models, missing embeddings, and partial provider failures.
- Golden GTM extraction corpus covering calls, emails, meeting notes, transcripts, renewals, handoffs, risk, buying process, success criteria, forecast signals, commitments, and next steps.
- High-recall Signal creation, but conservative Memory promotion when evidence, typed detail, confidence, source quality, or policy is insufficient.
- Richer receipts that explain matched account scope, examined child records, created Signals, proposed records, skipped internal/spam sources, review needs, and write failures.

Acceptance target: messy customer inputs should usually produce useful Signals or an actionable reason why they did not.

### 2. Source Coverage Maturity

The product should be clear about which sources are first-class workflows and which are bring-your-own ingestion paths.

First-class 0.9 workflows:

- Add Context
- Customer Email
- Customer Activity / meetings / calls / notes
- Systems-of-record sync
- Workspace Agent attachments
- REST / MCP / CLI ingestion

Bring-your-own source paths:

- Slack
- support cases
- product usage
- docs
- research
- custom warehouse events
- internal data products

Key changes:

- Make every source path route through the same Raw Context ingestion and receipt model.
- Keep internal, spam, automated, excluded-domain, and low-value messages out of storage and extraction by default.
- Add source maturity labels in docs and admin setup copy: `First-class`, `Via REST/MCP/CLI`, `Planned connector`.
- Preserve optionality: mailbox and calendar connections are useful, but emails, transcripts, notes, and activity context can still enter through Add Context or MCP.

### 3. Unified Agent Action-Readiness Packet

Agents need one contract before taking meaningful customer action.

Add a shared action-readiness service, exposed through REST and MCP, that returns:

- subject record and visible related records
- confirmed Memory
- open Signals and unconfirmed claims
- stale, conflicting, or incomplete context
- system-of-record ownership and source authority
- allowed tools and blocked actions for the current actor
- required approvals or handoffs
- writeback policy and preview requirements
- evidence and lineage links
- expected audit receipts after action

Candidate interface:

- REST: `GET /api/v1/action-context`
- MCP: `action_context_get`
- internal service used by Workspace Agent, Handoffs, draft email generation, record create/edit previews, Automations, and writeback planning

This should not replace `briefing_get`; it should make `briefing_get` safer and more action-aware.

### 4. Signal Trust Calibration And Grouping Proof

Signals should be understandable and reliable enough for users to confirm, route to review, or ignore.

Key changes:

- Calibrated trust-score tests against the golden extraction corpus.
- Tenant-visible source trust settings with conservative defaults.
- Clear distinction between model confidence, source trust, evidence count, independent sources, conflicts, typed completeness, and promotion threshold.
- Semantic candidate retrieval for related account/contact/opportunity/use-case evidence when embeddings are ready, with deterministic fallback when they are not.
- Catch-up regrouping when delayed embeddings arrive.
- Explicit non-merge rules for distinct GTM claims such as stakeholder role, risk, next step, buying process, commitment, and success criteria.
- Regression tests for account-scoped grouping, contact/account cross-evidence, duplicate Memory avoidance, and conflict creation.

Acceptance target: a user can see why a Signal is not Memory yet and what action will make it usable by agents.

### 5. Proof-Grade Lineage And Audit

Lineage should become the proof trail for the source-to-action lifecycle.

Key changes:

- Source -> activity/email/meeting -> Signal -> Signal group -> Memory -> briefing retrieval -> agent action -> Handoff -> writeback -> audit.
- Persist retrieval events when Memory or Signals are loaded into Active Context for a high-impact agent action.
- Attach writeback receipts to the Memory, Handoff, system-of-record mapping, and audit event they came from.
- Show partial lineage honestly when older records or external actions do not have complete links.
- Add proof-trail completeness tests for every first-class workflow.

Acceptance target: admins and builders can answer what happened, why it happened, what evidence was used, who approved it, and which external system changed.

### 6. Durable Agent Work And Human Collaboration

The Workspace Agent should be a durable workbench, not just a chat surface.

Key changes:

- Durable agent tasks with goal, subject, plan, steps, tool calls, status, approvals, retries, and final change summary.
- Work can continue in the background and resume after browser navigation or server restart without duplicate writes.
- Write plans before risky changes across CRMy objects, CRM writebacks, warehouse writebacks, sequence sends, automation-triggered writes, and customer email sends.
- HITL approvals native inside agent task execution, Automations, Sequences, email drafts, record create/edit previews, and connector writeback.
- Handoffs support decision rationale, reassignment, comments, linked evidence, SLA, and task history.
- Agent conversations can propose Memory, but Memory still requires evidence, policy, and review gates.

Acceptance target: a user can delegate work, leave, return, inspect what happened, approve or reject actions, and trust that permissions were enforced.

### 7. Scoped Access Parity Across Every Surface

Scoped actors are a product differentiator and a security boundary.

Key changes:

- Shared parity tests for REST, MCP, CLI, Workspace Agent, Automations, Sequences, Handoffs, search, graph, lineage, email, activity, and systems-of-record endpoints.
- Every tool that reads, resolves, writes, drafts, searches, or links records must enforce the current human actor's effective visibility.
- Members see their book of business, managers see team scope, admins/owners see tenant scope.
- Agent sessions and background tasks re-check access when run, not only when created.
- Permission-denied tool calls return friendly messages without leaking hidden record names or IDs.

Acceptance target: the Workspace Agent and external MCP clients cannot become an admin bypass.

### 8. Model And Retrieval Readiness

Local model setup should be clear enough for builders and safe enough for users.

Key changes:

- Accurate readiness checks for chat, tool calling, JSON output, extraction, and optional reasoning.
- Known-good provider guidance without stale model pickers.
- Friendly messaging when semantic retrieval requires pgvector, an embedding provider, or catch-up jobs.
- Background embedding repair and visibility for missing, failed, stale, or provider-unavailable embeddings.
- Retrieval quality tests for lexical fallback, pgvector retrieval, account-scoped candidates, and briefing enrichment.

Acceptance target: users know whether the Workspace Agent is ready, what is degraded, and what an admin can do about it.

### 9. Demo And Developer Experience

The demo should prove the product in minutes.

Key changes:

- Seed one complete source-to-action story:
  - customer email or meeting transcript
  - matched account/contact/opportunity
  - extracted Signals
  - one confirmed Memory
  - one review-needed Signal
  - one Handoff
  - one governed writeback preview or receipt
  - one Workspace Agent briefing/action using that Memory
- Include a failure/review path so users see why CRMy is safe, not just magical.
- CLI and MCP examples should prefer names and natural identifiers over raw IDs where supported.
- Docs should separate:
  - first-class workflows
  - API/MCP ingestion paths
  - planned connectors
  - admin-only setup
  - user-facing daily workflows

Acceptance target: a new builder can run CRMy, understand the model, ingest context, see Signals/Memory, ask the agent for help, approve an action, and inspect the proof trail.

### 0.9 Non-Goals

- Do not weaken the README positioning.
- Do not turn CRMy into a CRM replacement.
- Do not hard-code one sales methodology.
- Do not require pgvector for the core product to work.
- Do not require mailbox/calendar connections for emails, transcripts, or notes to feed Memory.
- Do not let agents write directly to systems of record without policy, preview, idempotency, approval where required, and audit.

## 1.0: Resilience At Scale

Goal: make CRMy reliable as the default context and action engine when a tenant has hundreds of thousands of Raw Context sources and Signals, tens of thousands of Memory entries, active mailbox/calendar/system-of-record sync, multiple Workspace Agent users, and external MCP clients.

Assumed production shape:

- Serverless Postgres such as Neon, Supabase, or Lakebase.
- Horizontally scaled app instances and separate worker instances.
- Optional pooled database URLs or PgBouncer-style connection pooling.
- Long-running work handled by durable jobs, not by request lifetimes.
- Multiple human roles and agent clients operating under the same scoped access model.

### What Breaks First Without 1.0 Hardening

- **Database connections exhaust.** App instances currently create normal Postgres pools. In serverless deployments, per-instance pools can exceed provider connection limits quickly.
- **Background work starves or stalls.** A single in-process worker loop and global advisory lock can let one slow task block extraction, embeddings, source sync, outbox retries, and agent-turn recovery.
- **Lists and dashboards get expensive.** Large pages that request counts, broad totals, or client-filtered batches become slow and costly as tenants reach hundreds of thousands of rows.
- **Search becomes uneven.** Global search, Context Browser, Signals, Memory, Graph, and Lineage need consistent server-side filtering, stable cursors, and search indexes instead of loading recent records and filtering locally.
- **Raw Context processing becomes request-bound.** LLM extraction, JSON repair, subject resolution, and signal grouping must survive timeouts, cold starts, provider failures, and retries without duplicate Signals or stuck sources.
- **Source sync becomes too chunky.** Mailbox, calendar, CRM, and warehouse sync need page-level checkpoints and backoff. A provider page failure should not replay or lose an entire sync run.
- **Agent and MCP sessions become fragile.** In-memory session registries and long SSE streams do not survive multi-instance routing, serverless freezes, or deploys without resumable persisted events.
- **Lineage and audit become heavy.** Source-to-action proof trails and audit logs grow quickly and need indexed edges, retention/export, and precomputed summaries.
- **Scoped access checks get expensive.** Visibility filters that rely on per-row joins or `EXISTS` checks will degrade unless ownership/scope metadata is materialized on high-volume context tables.

Current code signals behind these findings:

- `packages/server/src/db/pool.ts` uses a normal per-process Postgres pool; production needs explicit serverless connection budgeting.
- `packages/server/src/index.ts` starts migrations and an in-process background worker from the app runtime; production needs separated migration and worker execution.
- `packages/server/src/db/repos/context-outbox.ts` should gain the same stale-lock and retry scheduling guarantees as newer durable queues.
- `packages/server/src/db/repos/search.ts` and high-volume list repos should converge on indexed, scoped, server-side search rather than broad unions or client-filtered recent batches.
- `packages/server/src/services/customer-email.ts` and `packages/server/src/services/customer-activity.ts` need page-level sync checkpoints and pre-storage filtering before large mailbox/calendar deployments.
- The MCP session registry in `packages/server/src/index.ts` is in-memory today; production multi-instance deployments need persisted or explicitly sticky sessions.

### 1. Serverless Postgres Runtime

Make database usage explicit and safe for Neon, Supabase, Lakebase, and self-hosted Postgres.

Key changes:

- Add production database profile settings for pool max, idle timeout, connection timeout, statement timeout, and application name.
- Document pooled vs direct database URLs, including when migrations should use direct connections and runtime should use pooled connections.
- Move migrations out of normal app startup for production deployments, or guard them with an explicit one-shot migration command and advisory lock.
- Add connection budget telemetry: active pool clients, idle clients, waiting requests, slow queries, timed-out statements, and connection errors.
- Keep health checks cheap. Separate shallow process health from deeper database readiness so load balancers do not create query noise.
- Add query timeout defaults for request handlers, background jobs, and agent tools.

Acceptance target: CRMy can scale app instances without accidentally multiplying database connections past provider limits.

### 2. Durable Queue And Worker Architecture

Make every long-running or retryable path lease-based, observable, and recoverable.

Key changes:

- Split the single background loop into named job processors with independent leases, batch sizes, and timeouts.
- Use `FOR UPDATE SKIP LOCKED`, `locked_at`, `next_retry_at`, retry counts, dead-letter states, and stale-processing recovery for every durable queue.
- Bring context outbox up to the same resilience bar as embedding jobs and agent turns.
- Make extraction, embeddings, source sync, context outbox, agent turns, workflow runs, sequence steps, and writebacks resumable in small chunks.
- Add queue health metrics: pending, running, failed, dead-lettered, oldest pending age, oldest locked age, retry rate, and last successful processor heartbeat.
- Add safe admin recovery actions: retry, reprocess, unlock stale job, dead-letter, replay sync page, and inspect failure payload.

Acceptance target: killing a worker mid-job cannot permanently strand Raw Context, embeddings, outbox events, source sync, or agent work.

### 3. Query, List, And Search Scale

Make high-volume pages search-first and cursor-first instead of count-first and recent-first.

Key changes:

- Replace default total-count requirements with `limit + 1` paging, approximate counts, cached rollups, or async totals where exact counts are not user-critical.
- Use stable compound cursors such as `(updated_at, id)` or `(created_at, id)` instead of timestamp-only cursors.
- Add server-side filters for every large collection before records reach the UI: Raw Context, Signals, Memory, Handoffs, Email Messages, Calendar Events, Activities, Audit, Lineage, Graph, and Search.
- Add tenant-scoped and owner-scope indexes that match the actual filters: tenant, owner/customer scope, status, type, source, subject, updated/created time, and search vector.
- Introduce a unified search index or materialized search table for global search, command palette record lookup, MCP entity resolution, and agent retrieval.
- Virtualize large table/card views and avoid client-side filtering over capped result sets.
- Materialize high-volume access scope where needed, especially for context entries, raw context sources, signal groups, email messages, calendar events, and audit events.

Acceptance target: a tenant with 500k Raw Context sources, 500k Signals, and 50k Memory entries still has fast scoped search, filter, and drawer open flows without requiring pagination controls.

### 4. Raw Context Extraction Throughput

Make extraction high-recall, conservative, idempotent, and resilient under load.

Key changes:

- Route app, REST, MCP, CLI, Email, Activities, attachments, and reprocess flows through one durable Raw Context processing service.
- Keep a short synchronous attempt for good UX, then continue through a durable job when processing exceeds the request budget.
- Make `source_ref` idempotency include tenant, source type, actor/user, source label, selected subjects, provider IDs, and document hash.
- Persist extraction attempt metadata: model/provider, prompt version, packet hash, attempt count, status, failure code, and repaired JSON status.
- Bound extraction packets with account-scoped related-record directories, compact field hints, capped Memory/Signal candidates, and explicit truncation metadata.
- Add per-tenant/provider backpressure so extraction does not overwhelm local models, remote APIs, or database write throughput.
- Add a golden extraction corpus plus replay tooling so prompt/model changes can be evaluated before release.

Acceptance target: malformed JSON, model timeouts, duplicate source ingestion, provider outages, and subject ambiguity become recoverable receipts, not user dead ends.

### 5. Source Sync At Scale

Make mailbox, calendar, CRM, warehouse, and custom API/MCP sync incremental and cheap.

Key changes:

- Filter internal, spam, trash, automated, excluded-domain, and excluded-folder sources before storage whenever provider APIs allow it.
- Persist provider page checkpoints and cursors after each successful page, not only at the end of a whole sync run.
- Use Gmail history IDs, Microsoft Graph delta links, calendar sync tokens, CRM watermarks, and warehouse watermark columns with replay-safe dedupe.
- Store aggregate skipped-source stats without storing full low-value messages or meetings.
- Stage large sync batches before upsert where useful, with row-level errors, partial success, and retryable failures.
- Keep ambiguous customer meetings/emails in review instead of creating weakly linked records or wasting extraction.
- Add connector health that distinguishes auth failure, provider throttling, mapping failure, extraction failure, and writeback failure.

Acceptance target: a large mailbox/calendar/SOR sync can pause, resume, retry, and explain skipped work without losing customer-facing context or consuming extraction on low-value sources.

### 6. Pgvector, Embeddings, And Retrieval Scale

Keep semantic retrieval useful without making pgvector a hard dependency or runaway cost center.

Key changes:

- Keep lexical/deterministic fallback paths for every retrieval flow.
- Track embedding coverage by entity type and tenant: Raw Context, Context Entries, Signal Groups, Memory, and source artifacts.
- Add embedding backpressure, model/dimension compatibility checks, stale embedding detection, and re-embedding migration plans.
- Document pgvector/HNSW index strategy for serverless Postgres, including index build timing and operational caveats.
- Avoid embedding low-value filtered sources and duplicate raw payloads.
- Add retrieval evaluation sets for account-scoped candidate discovery, Signal grouping, briefing enrichment, and MCP `entity_resolve`.

Acceptance target: semantic retrieval improves grouping and briefing quality when enabled, but CRMy remains correct and usable when embeddings lag, fail, or are disabled.

### 7. Workspace Agent And MCP Durability

Make agent work reliable across browser navigation, deploys, provider errors, and multi-instance routing.

Key changes:

- Keep durable agent turns as the source of truth for messages, events, tool calls, reasoning summaries, and final outputs.
- Add polling fallback for every streamed turn so clients can recover when SSE is interrupted.
- Move MCP session state out of process memory or make session affinity/expiry explicit for production deployments.
- Add persisted tool-call idempotency keys for write tools so retries cannot duplicate creates, updates, sends, handoffs, or writebacks.
- Budget every tool call: default limits, explicit filters, timeouts, and clear “too broad” responses.
- Add MCP doctor and agent smoke tests that prove `entity_resolve -> briefing_get -> signal list -> handoff/action` against demo data in under one minute.
- Keep every tool scoped to the current human actor, including background continuation and delayed tool execution.

Acceptance target: a user or external agent can leave, reconnect, retry, or switch clients without losing work, duplicating writes, or bypassing permissions.

### 8. Systems Of Record And Writeback Resilience

Make external reads and writes provable, replayable, and policy-safe.

Key changes:

- Add sync-run partitions or chunk tables for object/page checkpoints, row-level errors, conflict states, and replay.
- Use writeback idempotency keys tied to tenant, actor, subject, target system, mapped object, mapped field set, and request source.
- Add writeback state transitions for previewed, pending approval, approved, executing, succeeded, failed, retrying, cancelled, and superseded.
- Attach writeback receipts to Handoffs, Memory, Lineage, external record references, and audit events.
- Enforce source authority and loop-prevention rules before every external write.
- Add bulk-safe conflict detection for warehouse and CRM sync instead of per-row interactive checks only.

Acceptance target: admins can prove what CRMy read, what it wrote, why it was allowed, who approved it, and how to replay or recover failures.

### 9. Events, Lineage, Audit, And Data Lifecycle

Make proof trails useful without letting event volume overwhelm operational tables.

Key changes:

- Persist retrieval events for high-impact agent actions so Active Context use appears in Lineage.
- Precompute or cache lineage edges for common source-to-action paths instead of rebuilding everything from raw joins at read time.
- Add audit retention/export policies, optional partitions, and archived audit search.
- Add tenant-level retention controls for raw payloads, email/message bodies, meeting artifacts, extracted snippets, and generated drafts.
- Add data minimization defaults so low-value raw source material is not stored indefinitely.
- Add event replay and dedupe controls for workflow, sequence, webhook, plugin/custom API, context outbox, and writeback events.

Acceptance target: CRMy keeps enough proof for trust and compliance while controlling storage, query cost, and sensitive-data exposure.

### 10. Observability, Limits, And Scale Gates

Make scale visible before users feel it.

Key changes:

- Add first-class metrics for request latency, query latency, queue lag, extraction throughput, model latency, provider sync latency, writeback latency, and agent tool latency.
- Add tenant quotas and soft limits for Raw Context ingestion, extraction jobs, mailbox/calendar sync volume, embedding jobs, agent turns, and MCP traffic.
- Add graceful degradation states: retrieval degraded, extraction queued, sync throttled, model unavailable, embeddings catching up, and writeback delayed.
- Add load tests and synthetic large-tenant fixtures to CI or release gates.
- Add `EXPLAIN`/index review fixtures for high-volume queries that must stay bounded.
- Add operational runbooks for slow queries, connection exhaustion, stuck queues, provider throttling, model outages, and disaster recovery.

Acceptance target: 1.0 ships with measurable scale budgets, release gates, and recovery procedures rather than best-effort performance.

### 1.0 Non-Goals

- Do not make pgvector mandatory.
- Do not turn every UI into a reporting table.
- Do not store internal/spam/automated sources just because a connector can fetch them.
- Do not let external agents bypass scoped access, approval, or writeback policy for performance.
- Do not require one specific serverless Postgres provider; document provider-specific caveats while keeping the architecture portable.
- Do not weaken the README promise. 1.0 should make the promise resilient under real production volume.

## Acceptance Criteria

### 0.8

- A user can connect Salesforce or HubSpot, sync a real account/contact/opportunity, ask CRMy for a briefing, add context, and approve a writeback.
- A user can connect Databricks or Snowflake, map warehouse rows into typed CRMy objects/context, and trigger existing Automations from synced changes.
- Agents can resolve whether a customer record came from CRMy, CRM, warehouse, or multiple sources.
- External writeback produces preview, approval policy result, idempotency key, audit event, and sync status.
- Existing Automations and Sequences work with connector-originated events through the standard event bus.

### 0.9

- Raw Context from app, REST, MCP, CLI, email, activity, and agent attachments flows through one durable ingestion path with consistent receipts.
- A non-trivial customer source creates useful Signals or an actionable failure reason, without brittle JSON/provider failures becoming dead ends.
- Signal trust and promotion readiness are calibrated, explainable, and tested against a realistic GTM corpus.
- Agents can request one action-readiness packet that explains Memory, Signals, stale context, policy, system ownership, allowed actions, required approvals, and proof trail.
- A non-trivial agent request produces durable work with visible progress, tool transparency, approval checkpoints, permission enforcement, and final changed-record summary.
- Risky writes are never silent. Users can preview, approve, reject, retry, or inspect them.
- Proof-grade lineage connects source, Signal, Memory, retrieval, Handoff, writeback, and audit for first-class workflows.
- Member, manager, admin, REST, MCP, CLI, and Workspace Agent access boundaries are covered by parity tests.

### 1.0

- CRMy can be deployed against serverless Postgres without connection exhaustion, startup migration races, or health-check query storms.
- High-volume Context pages remain search-first and responsive against synthetic tenants with hundreds of thousands of Raw Context sources and Signals.
- Durable jobs recover after worker crashes, cold starts, provider timeouts, and deploys without duplicate Signals, duplicate writes, or permanently stuck processing states.
- Mailbox, calendar, CRM, warehouse, and custom API/MCP source sync can resume from page-level checkpoints and explain skipped/internal/low-value sources.
- Workspace Agent and MCP work can resume through persisted turn events and safe polling when streams disconnect or instances restart.
- Lineage, audit, retrieval, and writeback proof trails remain queryable through indexed edges, retention/export, and precomputed summaries.
- CRMy can be deployed self-hosted by an enterprise team, connected to CRM and warehouse systems, governed by scoped actors/policies, and used by agents for read/write revenue workflows with audit-safe execution.
- Developers can build against stable SDKs and MCP tools without reverse-engineering app behavior.
- Admins can prove what happened, why it happened, who approved it, which systems changed, and what context the agent used.

## Test Plan

- **Connector tests:** initial sync, incremental sync, schema drift, deleted records, merged records, field mapping, conflict creation, conflict resolution, retry, and idempotent writeback.
- **Warehouse tests:** Databricks/Snowflake read mapping, watermark sync, changed-field detection, append-only writes, upserts, stored procedure writes, failed write recovery, and loop prevention.
- **Automation tests:** external sync emits expected CRMy events, filters match source metadata, workflows dedupe replayed events, and source-loop guards work.
- **Sequence tests:** external events enroll contacts, complete goal events, branch correctly, pause for approval, and avoid duplicate sends.
- **Extraction tests:** golden GTM corpus covers transcripts, emails, call notes, activity debriefs, buying process, success criteria, forecast signals, stakeholders, commitments, risks, next steps, and proposed records.
- **Signal tests:** calibrated trust scoring, account-scoped grouping, duplicate Memory avoidance, conflict creation, source weighting, typed completeness, and manual confirmation behavior.
- **Agent tests:** action-readiness packets include Memory, Signals, stale context, policy, SOR ownership, proof links, and approval requirements; write plans preview external changes; HITL gates risky actions; task summaries include source-system effects; and audit links resolve correctly.
- **Lineage tests:** source-to-action proof trails connect Raw Context, activity/email/meeting, Signal, Memory, briefing retrieval, Handoff, writeback, and audit for first-class workflows.
- **Scope parity tests:** REST, MCP, CLI, Workspace Agent, search, graph, lineage, Handoffs, email, activity, systems-of-record, Automations, and Sequences enforce the same member/manager/admin visibility model.
- **Retrieval tests:** lexical fallback and pgvector retrieval both find account-scoped candidates without leaking inaccessible records.
- **Security tests:** no arbitrary SQL writes, scoped actors cannot access unmapped systems, field-level authority is enforced, and secrets are never exposed in logs or audit payloads.
- **Serverless Postgres tests:** pooled connection budget, statement timeouts, startup without runtime migrations, shallow/deep health behavior, and provider-specific migration guidance.
- **Scale fixtures:** synthetic tenants with 500k Raw Context sources, 500k Signals, 50k Memory entries, large audit history, and active mailbox/calendar/SOR sync history.
- **Query-plan tests:** `EXPLAIN` gates for high-volume list/search/detail endpoints, including Context Browser, Signals, Memory, Handoffs, Email Messages, Calendar Events, Audit, Search, Graph, and Lineage.
- **Queue recovery tests:** worker crash/restart, stale lock recovery, retry/backoff, dead-letter handling, context outbox recovery, raw extraction retry, embedding catch-up, and agent-turn continuation.
- **Source-sync scale tests:** provider pagination, cursor replay, partial-page failure, skipped-source aggregate stats, dedupe, row-level errors, and checkpoint resume for mailbox, calendar, CRM, and warehouse sync.
- **Agent/MCP resilience tests:** interrupted SSE stream, polling recovery, multi-instance routing, stale MCP session behavior, tool-call idempotency, broad-query limits, and scoped denied access.

## Implementation Notes

- Build the system-of-record abstraction before individual connector UI polish.
- Keep connectors behind explicit setup and scope checks.
- Treat sync as a producer of typed CRMy mutations plus event metadata.
- Avoid a separate automation engine for sync. Use the existing event bus and workflow run dedupe model.
- Keep external writes separate from local object writes until preview, approval, and receipt handling are complete.
- For production serverless Postgres, runtime app instances should use pooled connections and explicit pool limits; migration jobs should use a controlled direct connection path.
- Do not run expensive exact counts by default on high-volume user paths. Prefer `limit + 1`, cached rollups, approximate counts, or async totals.
- Every durable queue should have `locked_at`, `next_retry_at`, retry counts, dead-letter state, and stale-processing recovery.
- Every high-volume cursor should be stable and compound, not timestamp-only.
- Every large search/filter path should enforce tenant and actor scope in the database query before returning rows.
- Any in-memory session or event registry must be documented as local-development-only or replaced with persisted state before 1.0 production guidance.
