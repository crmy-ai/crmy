# CRMy 0.8-1.0 Roadmap: Enterprise Systems-Of-Record Overlay

CRMy's next major releases should move the product from a local-first customer context layer into the default context and execution platform between AI agents and enterprise revenue systems.

The goal is not to replace Salesforce, HubSpot, Databricks, Snowflake, or future systems of record. The goal is to give agents one governed layer for typed revenue objects, long-term memory, scoped tools, HITL approvals, retry-safe writes, and audit-safe execution across those systems.

## Strategic Direction

Chosen defaults for the 0.8-1.0 line:

- **0.8 supports CRM and warehouse systems of record.** Salesforce, HubSpot, Databricks SQL Warehouse / Delta-backed tables, and Snowflake are the first targets.
- **Warehouses can be authoritative.** CRMy should not assume the CRM is always the primary system of record.
- **Warehouse writeback is governed.** Agents cannot run arbitrary SQL writes. Writes must use configured mappings and approved write modes.
- **Automations and Sequences reuse the existing event bus.** Connector and warehouse sync should emit normal CRMy events so existing triggers, HITL, audit, and context extraction keep working together.
- **CRMy remains the typed operational overlay.** External systems feed and receive governed state, but agents operate through CRMy's typed objects, policies, tools, and audit trail.

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

## 0.9: Durable Agent Execution And Governance

Goal: make CRMy the trusted execution runtime for revenue agents.

Key changes:

- Durable agent tasks with goal, subject, plan, steps, tool calls, status, approvals, retries, and final change summary.
- Write plans before risky changes across CRMy objects, CRM writebacks, warehouse writebacks, sequence sends, and automation-triggered writes.
- Context evidence panels that show records, warehouse rows, CRM records, context entries, activities, freshness, source, confidence, and contradictions.
- Memory review from agent conversations before saving new context.
- Policy controls for actors, tools, object types, fields, systems of record, write modes, and approval thresholds.
- HITL approvals native inside agent task execution, Automations, Sequences, and connector writeback.

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

- A non-trivial agent request produces a durable task with visible progress, tool transparency, approval checkpoints, and final changed-record summary.
- Risky writes are never silent. Users can preview, approve, reject, retry, or inspect them.
- Agent answers show what context was used and where it came from.

### 1.0

- CRMy can be deployed self-hosted by an enterprise team, connected to CRM and warehouse systems, governed by scoped actors/policies, and used by agents for read/write revenue workflows with audit-safe execution.
- Developers can build against stable SDKs and MCP tools without reverse-engineering app behavior.
- Admins can prove what happened, why it happened, who approved it, which systems changed, and what context the agent used.

## Test Plan

- **Connector tests:** initial sync, incremental sync, schema drift, deleted records, merged records, field mapping, conflict creation, conflict resolution, retry, and idempotent writeback.
- **Warehouse tests:** Databricks/Snowflake read mapping, watermark sync, changed-field detection, append-only writes, upserts, stored procedure writes, failed write recovery, and loop prevention.
- **Automation tests:** external sync emits expected CRMy events, filters match source metadata, workflows dedupe replayed events, and source-loop guards work.
- **Sequence tests:** external events enroll contacts, complete goal events, branch correctly, pause for approval, and avoid duplicate sends.
- **Agent tests:** write plans preview external changes, HITL gates risky actions, task summaries include source-system effects, and audit links resolve correctly.
- **Security tests:** no arbitrary SQL writes, scoped actors cannot access unmapped systems, field-level authority is enforced, and secrets are never exposed in logs or audit payloads.

## Implementation Notes

- Build the system-of-record abstraction before individual connector UI polish.
- Keep connectors behind explicit setup and scope checks.
- Treat sync as a producer of typed CRMy mutations plus event metadata.
- Avoid a separate automation engine for sync. Use the existing event bus and workflow run dedupe model.
- Keep external writes separate from local object writes until preview, approval, and receipt handling are complete.
