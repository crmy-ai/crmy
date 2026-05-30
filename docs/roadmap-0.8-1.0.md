# CRMy 0.8-1.0 Roadmap: Enterprise Systems-Of-Record Overlay

CRMy's next major releases should move the product from a local-first customer context layer into the default context and execution platform between AI agents and enterprise revenue systems.

The goal is not to replace Salesforce, HubSpot, Databricks, Snowflake, or future systems of record. The goal is to give agents one governed layer for typed revenue objects, long-term memory, scoped tools, HITL approvals, retry-safe writes, and audit-safe execution across those systems.

## Strategic Direction

Chosen defaults for the 0.8-1.0 line:

- **0.8 supports CRM and warehouse systems of record.** Salesforce, HubSpot, Databricks SQL Warehouse / Delta-backed tables, and Snowflake are the first targets.
- **0.9 hardens the source-to-action loop.** The priority is not more surface area. The priority is proving that messy customer context reliably becomes Signals, trusted Memory, governed human decisions, and auditable action.
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

## 1.0: Trusted Default Engine

Goal: make CRMy production-ready as the default context and execution platform for revenue agents.

Key changes:

- Stable MCP tools, REST API, OpenAPI schema, connector SDK, plugin hooks, and TypeScript/Python SDKs.
- Connector certification tests for Salesforce, HubSpot, Databricks, Snowflake, and custom systems.
- Enterprise identity and lifecycle support: SSO/OIDC or SAML, SCIM-ready provisioning, role templates, API key rotation, and audit export.
- Production operations: backup/restore, sync replay, retention policies, queue health, connector health, upgrade checks, and disaster recovery docs.
- Expanded customer success coverage: renewals, subscriptions, contracts, support cases, product usage, success plans, QBRs, and health history.
- Evaluation suites for context retrieval, sync correctness, write safety, automation behavior, sequence outcomes, and agent task completion.

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

## Implementation Notes

- Build the system-of-record abstraction before individual connector UI polish.
- Keep connectors behind explicit setup and scope checks.
- Treat sync as a producer of typed CRMy mutations plus event metadata.
- Avoid a separate automation engine for sync. Use the existing event bus and workflow run dedupe model.
- Keep external writes separate from local object writes until preview, approval, and receipt handling are complete.
