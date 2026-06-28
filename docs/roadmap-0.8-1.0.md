# CRMy 0.8-1.0 Roadmap: Governed Action & Provenance Control Plane

CRMy's next major releases should move the product from a local-first customer context layer into the **governed action & provenance control plane for customer-facing agents**: the layer an agent calls before it acts on a customer or a system of record, that tells it what is trustworthy, what is allowed, and what proof will exist afterward — and that stays neutral across CRMs.

The goal is not to replace Salesforce, HubSpot, Databricks, Snowflake, or future systems of record. The goal is to give agents one governed layer for typed revenue objects, long-term memory, scoped tools, HITL approvals, retry-safe writes, and audit-safe execution across those systems.

---

> ## ⚠ READ THIS FIRST — Authoritative direction (0.9.3 → 1.0)
>
> The **Strategic Refocus** section immediately below is the authoritative plan for the road to 1.0. **Where any later section of this document conflicts with it, the Strategic Refocus wins.**
>
> Two things changed and a downstream agent must not miss them:
>
> 1. **Repositioning.** The product is **trustworthy action**, not "memory." Memory is the substrate; the headline is `action_context_get` + grounded promotion + proof/lineage. Anything justified mainly by "smaller prompts / token reduction" is deprioritized.
> 2. **Sequences and the Automations/Workflow *builder* are experimental, demoted surfaces.** They can support controlled validation of governed automation patterns, but they must not become the product thesis or first-run path. See [Scope Decisions](#scope-decisions-build-freeze-kill) and [Experimental Surface Plan](#experimental-surface-plan-sequences--automations).
>    - **Do NOT remove the internal event bus.** The event bus (`events`, emitters, `workflow_runs` dedupe primitives, context outbox) is **load-bearing infrastructure** for ingestion, source sync, HITL, lineage, and webhooks. Keep user-facing automation/sequence surfaces admin-only, clearly experimental, and outside default positioning.
>
> Sections of this doc that are now **superseded / downgraded** by the refocus: any acceptance/test items that assert Sequences/Automations as supported first-class surfaces. They remain available only as experimental admin surfaces.

## Strategic Refocus: The Governed Action & Provenance Control Plane

> Added in the 0.9.3 cycle after an architecture + thesis review. This section is self-contained so another agent can execute it without external context.

### North star (one sentence)

CRMy is the **governed, cross-CRM action-and-proof control plane for customer-facing agents.** Memory is the durable substrate that makes action trustworthy; it is not the product. The product is the **preflight contract + proof** an agent uses before it acts.

### Thesis verdict (why we are refocusing)

The original thesis — "context alone is insufficient; agents need a durable *truth* layer" — is only half right, and the right half is not the half we led with. What the codebase actually proves is **provenance + action-gating + audit**, not "truth." Three consequences:

- "Confirmed Memory" is **provenance-checked, corroborated inference**, not verified truth. Our language must stop overselling the epistemics.
- The most defensible, least-copyable code is `action_context_get` (operational state) and grounded promotion (provenance) — **not** the memory store.
- Long context windows and model-native memory will commoditize retrieval/compression. They will **not** commoditize provenance, policy gating, approval, writeback governance, or audit. Invest in the durable layers.

### What is differentiated — invest here

1. **Grounded promotion** — trust decoupled from model confidence. `packages/server/src/agent/extraction-grounding.ts`. A Signal auto-promotes to Memory only if its evidence snippet is present in the source.
2. **Action Context** — the `inform` / `warn` / `require_review` preflight contract, `use_as_truth` / `do_not_use_as_truth` partition, and `source_posture`. `packages/server/src/services/action-context.ts`.
3. **Lineage + receipts** — durable, exclusion-aware proof of what evidence an agent used and why context was excluded.
4. **Cross-CRM neutrality** — the one structural advantage CRM-native agents (Salesforce Agentforce, HubSpot Breeze) cannot match.

### What is NOT differentiated — do not make primary

- Retrieval & token-compression cleverness (dies to long context + model-native memory). Demote token-budget packing to a silent utility; drop token-reduction messaging.
- **Sequences** (competes with Outreach/Apollo when positioned broadly) - **experimental only**.
- **Automations / workflow *builder*** as a product surface (competes with Zapier when positioned broadly) - **experimental only, keep the event bus**.
- Webhooks / messaging channels — maintain as plumbing only; no investment; out of positioning.
- Knowledge-graph reasoning — we never had it (FK joins + a provenance DAG); stop implying it.
- Generic "agent memory store" framing — keep memory GTM-typed and specific or it commoditizes.

### Durable decisions (answers to the strategic open questions)

These are committed decisions, not options. Each lists the **change** an implementer must make.

| # | Decision | Concrete change |
|---|---|---|
| **D1** | **Product = action governance, not memory.** | Make `action_context_get` the canonical first tool in docs/demo/default toolset. Keep "Memory" as a UI noun; reposition all marketing around governed action + proof. |
| **D2** | **SoR wins on field values; CRMy wins on the reasoning/evidence/decision layer.** | Invariant: **on conflict over a mapped SoR field, CRMy flags and defers — never overwrites.** Document CRMy as the audited decision layer *on top of* the SoR, never a parallel field store. Enforced via `source_authority` mappings in `action-context.ts`. |
| **D3** | **Stop auto-promoting high-impact claims on lexical grounding alone.** Introduce claim-class promotion tiers. | Extend the `sensitive`/`requires_approval` logic in `packages/server/src/services/signal-readiness.ts` into the tier matrix below. Add `grounding_method: lexical \| corroborated \| human_reviewed` to every Memory row so "confirmed" carries an honest provenance qualifier. |
| **D4** | **Model capability gates auto-promotion (not Signal creation).** | Run the 0.9.3 eval suite per tenant-model. A model below threshold may **create Signals** but **may not auto-promote** — everything routes to review. Reuse the `CRMY_REQUIRE_GROUNDED_AUTOPROMOTE` pattern, now keyed to a certification score. Local-first stays usable; weak models just produce more review. |
| **D5** | **Procedural/reflective memory: substrate now, learning loop later.** | For 1.0, only **instrument outcomes** (reply / meeting-booked / stage-advanced / won-lost) linked to the actions and the Memory/Signals that informed them, via existing receipts/audit. The feedback-into-thresholds + next-best-action loop is the **v1.1 headline**, explicitly out of 1.0. |
| **D6** | **Retrieval/compression value is sunset; invest in durable layers.** | Forcing function: anything justified mainly by "smaller prompts" is deprioritized for 1.0. Token-budget packing (`briefing.ts`) becomes a quiet utility, not a marketed feature. |
| **D7** | **Cross-CRM neutrality is the moat and a 1.0 release gate.** | Require **two-SoR + connector-free parity**: the canonical flow must pass identically against Salesforce, HubSpot, and the no-connector path in the eval suite and the demo. All SoR specifics stay in adapters. |
| **D8** | **Ship the Core Profile as the default product.** | Default install = the 5-tool spine (below), connector-free, ~20-tool default toolset. Everything else is opt-in. |

**D3 claim-class promotion tiers:**

| Tier | Examples | Auto-promote rule |
|---|---|---|
| **0 — Informational** | preference, relationship note | Grounded snippet → auto-promote |
| **1 — Operational** | next_step, pain_point, objection | Grounded **and** (independent corroboration **or** a `valid_until` decay date) |
| **2 — High-impact** | forecast_signal, commitment, economic-buyer/champion change, deal_risk affecting forecast | **Never auto-promote** — human review **or** ≥2 independent sources + recency |

### Fix the decay gap (makes a headline claim actually true)

Today, customer Memory only goes stale if the extraction model emitted a `valid_until` (`extraction.ts` prompt) or a human set a TTL — there is **no automatic, type-based freshness window for customer Memory.** Ironically the optional Trusted Fact layer already has deterministic category windows. **Action:** give customer Memory the same treatment, using `packages/server/src/services/knowledge-freshness.ts` (`freshnessWindowDays`, `computeStaleClaimIds`) as the template, driven by `context_type`. Un-dated Memory must auto-stale by type so `staleness.ts` sweeps and briefing `staleness_warnings` actually fire.

### The Core Profile — the smallest valuable product

The spine everything hangs off. Ships as the **default install**: connector-free, no sequences, no workflow builder, ~20-tool default toolset.

```text
context_ingest_auto  ->  grounded promotion  ->  briefing_get  ->  action_context_get  ->  context_lineage_get
```

Everything beyond this loop (SoR connectors, email/calendar sources, Trusted Facts, HITL beyond review queue) is an **opt-in module**, not a prerequisite.

### Scope Decisions: build, freeze, kill

| Surface | Decision | Rationale |
|---|---|---|
| Sources -> Signals -> Memory lifecycle | **Core** | The substrate; differentiated via grounded promotion. |
| Action Context (`inform`/`warn`/`require_review`) | **Core — lead with it** | Most defensible code; the product. |
| Lineage + receipts + audit | **Core — the trust brand** | Hard to replicate; survives model-native memory. |
| Grounded promotion + claim-class tiers (D3) + model gating (D4) + decay windows | **Core — must make true for 1.0** | Closes epistemic-overreach + weak-model + decay risks. |
| SoR overlay (Salesforce, HubSpot, warehouse, connector-free) | **Core — as the neutrality moat (D7)** | Two-CRM parity is the gate, not breadth. |
| Customer Email / Activity / Calendar | **Keep — framed as ingestion sources only** | Feed the loop; not inbox/calendar apps. |
| HITL / Handoffs | **Keep** | The human-review half of governance. |
| Internal event bus, context outbox, `workflow_runs` dedupe primitives | **Keep — load-bearing infra (NOT the builder)** | Ingestion, sync, HITL, lineage, webhooks depend on it. |
| **Sequences** (`email-sequences`, migrations 037-041) | **Experimental - demote from default path** | Useful for controlled governed-orchestration validation; do not position as sales engagement. |
| **Automations / Workflow builder** (`workflows.ts`, migration 011, builder UI) | **Experimental - admin-only** | Useful for validating event routing; do not position as generic workflow automation. Keep the event bus underneath. |
| Webhooks / Messaging channels | **Freeze — plumbing only, out of positioning** | Not differentiation. |
| Token-budget profiles as a *feature* | **Demote to silent utility (D6)** | Dies to long context. |
| Semantic-search tuning as a headline | **Deprioritize** | Retrieval cleverness is not the moat. |
| Procedural/reflective learning loop | **Out of 1.0 — substrate only (D5)** | Biggest gap, riskiest scope; v1.1 headline. |

### Experimental Surface Plan: Sequences & Automations

**Principle:** preserve the surfaces for controlled validation, but make their altitude unmistakable: admin-only, experimental, absent from first-run positioning, and secondary to the governed-context loop. No destructive migrations in this cycle.

**Sequences - experimental:**
1. Keep `sequence_*` MCP tools outside default toolsets unless an operator explicitly enables the experimental/full catalog.
2. Keep Sequences out of primary nav and the demo/quickstart path. Place UI behind **Settings -> Automation Experiments**.
3. Strip sales-engagement positioning from README, guide, recipes, and examples.
4. Freeze broad feature expansion. Keep durable execution and regression tests for existing functionality.
5. Remove sequence-specific acceptance criteria from the 1.0 core gate unless tied to Action Context proof.

**Automations / Workflow builder - experimental surface, keep the bus:**
1. Keep `workflow_*` builder tools and the Automations builder UI out of default toolsets, primary nav, demo, and positioning.
2. **Keep** the internal event bus (`events`, emitters), context outbox, and `workflow_runs` dedupe/replay primitives — these power ingestion, source sync, HITL routing, lineage, and webhooks and must not be removed.
3. Re-scope internal event→action needs (e.g. "create review assignment when a Signal is stale") as **fixed, governed internal handlers**, not user-authored workflows. Reuse `staleness.ts` / `knowledge-governance.ts` patterns.
4. Strip "automation engine," "workflow builder," and sales-engagement framing from positioning; use "experimental automation" only when the surface is visible.
5. Keep the 0.8 "Automations And Sequences Integration" section as historical context for the event-bus design only.

**Migration/runbook note for implementers:** announce the experimental status in `CHANGELOG`/`RELEASE_NOTES`, keep these surfaces out of the default path, and preserve existing data. Do not remove tables or tools during this cycle.

### Focused Road to 1.0 (phased)

Current release: 0.9.4. Each phase maps to a differentiated mechanism and has a hard acceptance gate.

| Phase | Theme | Deliverables (grounded in existing code) | Acceptance gate |
|---|---|---|---|
| **0.9.4** | **Trust integrity** (make the headline claims true) | D3 claim-class tiers atop `signal-readiness.ts`; `grounding_method` on every Memory row; **customer-Memory decay windows** via `knowledge-freshness.ts` template; D4 model-certification gate for auto-promote via the eval harness | A weak/uncertified model can never mint Tier-2 Memory; un-dated Memory auto-stales by type; eval suite proves both |
| **0.9.5** | **Core Profile + portable contract** | Default Core Profile install (connector-free, ~20-tool default toolset); **version & freeze the Action Context packet schema** (D1/D6); reposition docs/demo around `action_context_get`; **keep Sequences + Automations experimental and outside default paths** | New builder runs the 5-tool loop with zero connectors; Action Context contract is versioned + documented; Sequences/Automations stay out of default surfaces |
| **0.9.6** | **Neutrality + proof** (lock the moat) | D7 two-SoR + connector-free parity in eval + demo; universal proof-receipt envelope across retrieval/draft/HITL/writeback/turn; D2 "SoR-defers-on-conflict" invariant | Canonical flow passes identically on Salesforce, HubSpot, and no-connector; one receipt format audits all action types |
| **1.0-RC** | **Resilience at scale (core loop only)** | Apply the existing [1.0: Resilience At Scale](#10-resilience-at-scale) workstreams **scoped to the ingest→promotion→briefing→action→lineage path**, not the full surface | High-volume soak on the core loop meets latency/correctness budgets |
| **1.0 GA** | **Honest, focused launch** | Repositioned messaging; certified runtime matrix for the 5-tool loop; D5 outcome-instrumentation substrate (data capture only) | The "what dies / what survives model-native memory" story holds; no overclaimed epistemics in docs |

### Explicitly NOT doing before 1.0

- New connector types beyond the two-CRM + warehouse + connector-free set.
- Broad Sequences or Automations/workflow-builder feature expansion beyond controlled experiments.
- The procedural/reflective learning loop (substrate only — D5).
- Token-reduction / "smaller prompt" messaging or features (D6).
- Knowledge-graph reasoning.
- Shipping the full 321-tool catalog as the default toolset.

### Persona value guardrails (narrowing must not strand a core user)

| Persona | Keeps / gains after narrowing | Loses | Net |
|---|---|---|---|
| **Agent builder** | Small, versioned, portable Action Context contract; ~20-tool default; proof receipts; cross-runtime + cross-CRM | The 321-tool firehose (a liability anyway) | **Gain** |
| **GTM Ops / RevOps** | Honest decay, claim-class gating, model certification, audit, writeback safety, SoR-defers-on-conflict | Zapier/Outreach-style builders (they own better ones) | **Gain** |
| **Seller / CS** | Briefings with *working* stale warnings, grounded drafting, Action Context guardrails | Nothing in the daily path | **Neutral→gain** |
| **Admin / Security** | Scoped actors, PII/retention on the core loop, certified models, lineage; smaller surface to certify | Surface area to review | **Gain** |

### The moat (restate for any reviewer)

Not storage, not the contract (copyable). It is: (a) the **grounded-promotion + claim-class + proof discipline** as a trust brand; (b) per-tenant accumulated Memory + lineage (switching cost / data gravity); (c) **cross-CRM neutrality** no SoR vendor can match. The plan above invests only in these three and freezes/kills everything else.

### Handoff notes for implementers (file pointers)

- Promotion/grounding: `packages/server/src/agent/extraction-grounding.ts`, extraction prompt in `packages/server/src/agent/extraction.ts`.
- Readiness/tiers (D3): `packages/server/src/services/signal-readiness.ts`.
- Decay template (apply to customer Memory): `packages/server/src/services/knowledge-freshness.ts`; sweep in `packages/server/src/services/staleness.ts`; storage in migrations `012`/`013` (`context_entries.valid_until`).
- Action Context contract (D1/D6) + SoR authority (D2): `packages/server/src/services/action-context.ts`.
- Briefing/packing (demote per D6): `packages/server/src/services/briefing.ts`.
- Toolsets / default catalog (Core Profile, D8): MCP tool registration under `packages/server/src/mcp/tools/` and toolset selection.
- Eval harness (D4/D7 gates): see [Eval Harness Plan](eval-harness-0.9.3-plan.md).
- Experimental surfaces: `packages/server/src/mcp/tools/email-sequences.ts`, `packages/server/src/mcp/tools/workflows.ts`; **do not touch** the event emitter / `events` / context-outbox infra.

## Strategic Direction

Status labels in this roadmap:

- **Landed** means implemented in the current codebase.
- **In progress** means partially implemented but still needs adoption, polish, certification, or scale work.
- **Planned** means not yet first-class in the current codebase.

Chosen defaults for the 0.8-1.0 line:

- **0.8 supports CRM and warehouse systems of record.** Salesforce, HubSpot, Databricks SQL Warehouse / Delta-backed tables, and Snowflake are the first targets.
- **0.9 hardens the source-to-action loop.** The priority is not more surface area. The priority is proving that messy customer context reliably becomes Signals, confirmed Memory, governed human decisions, and auditable action.
- **1.0 is resilience at scale.** The priority is making CRMy dependable on serverless Postgres with high-volume Sources, Signals, Memory, source sync, agent work, MCP traffic, and audit history.
- **Warehouses can be authoritative.** CRMy should not assume the CRM is always the primary system of record.
- **Warehouse writeback is governed.** Agents cannot run arbitrary SQL writes. Writes must use configured mappings and approved write modes.
- **Automations and Sequences reuse the existing event bus.** Connector and warehouse sync should emit normal CRMy events so existing triggers, HITL, audit, and context extraction keep working together.
- **CRMy remains the typed operational overlay.** External systems feed and receive governed state, but agents operate through CRMy's typed objects, policies, tools, and audit trail.
- **The README promise remains future-proof.** v0.9 should close the reliability gaps underneath that promise rather than weakening the positioning.

Related 1.0 runtime plan:

- [CRMy 1.0 Multi-Instance Runtime Plan](multi-instance-runtime-plan.md)

## Recently Landed (post-0.9.2)

- **Local eval harness + production-path extraction quality eval** ([#29](https://github.com/crmy-ai/crmy/pull/29)) — makes extraction quality measurable, the foundation for capability-gated promotion.
- **Per-session MCP toolsets** ([#30](https://github.com/crmy-ai/crmy/pull/30)) — narrow the registered tool catalog per session/job (not per key) so agents pick from a focused working set; scope enforcement unchanged.
- **Source-grounding gate for auto-promotion** ([#31](https://github.com/crmy-ai/crmy/pull/31)) — a Signal only auto-promotes to Memory when its evidence is present in the source, so a weak model cannot silently mint Memory.
- **Connector-free `crmy quickstart`** ([#32](https://github.com/crmy-ai/crmy/pull/32)) — one command shows the connector-free golden path (resolve → briefing → Action Context → lineage), reframing connectors as an optional upgrade.

Next: per-tenant model **certification** (gate/raise the auto-promote bar using eval scores) and a `tool_choice` eval suite to prove toolset curation.

## What Prevents CRMy From Being The Default Today

### 1. System-of-record connectivity still needs live certification

Status: **In progress.** HubSpot, Salesforce, Databricks, and Snowflake connector paths now exist with mappings, source authority, sync, conflicts, governed writeback, Action Context receipts, and operations visibility. Remaining 0.9 work is live-environment certification, adapter maturity, provider-specific runbooks, and broader workflow adoption.

CRMy has plugins, webhooks, REST, MCP, imports, and a strong internal event model. The native connector foundation now includes:

- external system registration
- external record references
- object and field mappings
- sync runs and watermarks
- conflict detection and resolution
- source authority rules
- governed writeback requests
- connector health and replay

Without live certification and clear provider runbooks, CRMy could still feel like an internal overlay instead of the governed bridge between agents and enterprise systems.

### 2. Warehouses are not modeled as operational sources

Status: **In progress.** Databricks and Snowflake are supported connector types. Remaining work includes production certification, source-specific mapping presets, scale testing, and richer product-usage/health/renewal source patterns.

Enterprise revenue state increasingly lives in warehouses and lakehouses, not only CRMs. CRMy needs a path for Databricks and Snowflake to provide account, contact, opportunity, activity, product usage, health, and renewal data.

The difficult part is not reading rows. The difficult part is mapping rows into typed agent-safe objects, tracking source authority, handling schema drift, emitting events, and governing writeback.

### 3. Automations need source-aware triggers

Status: **In progress.** Workflow filters can match source metadata and systems-of-record sync emits CRMy events. Remaining work is workflow polish, source-specific templates, and stronger replay/dedupe certification.

The existing workflow engine subscribes to event types such as `contact.created`, `account.updated`, `opportunity.stage_changed`, and `activity.created`. Connector sync should feed that same model, with additional metadata for origin, source system, sync run, external record, changed fields, confidence, and conflict state.

Without this, CRMy would create a parallel sync automation system that users have to learn separately.

### 4. Sequences need external-event awareness

Status: **In progress.** Sequences exist, email sends and non-email sequence actions can carry Action Context proof, and sequence execution has durable/idempotency coverage. Deeper source-driven enrollment, branching, and live external-event certification remain roadmap work.

Sequences already handle enrollment, AI-generated steps, branch/wait logic, HITL gates, reply detection, and goal events. External system updates should be able to enroll contacts, complete goals, branch journeys, or pause for review without bypassing the sequence engine.

### 5. External writes require stronger governance

Status: **In progress.** Governed writeback preview/request/review/execute paths exist, first-class customer outreach/writeback paths carry Action Context receipts, and external side-effect paths have receipt-first/idempotency hardening. Remaining work is provider certification, live-environment proof polish, and broader workflow adoption.

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

> **Superseded by the 0.9.4 refocus.** Sequences and the user-facing Automations/Workflow builder are **experimental** and must stay outside the default path. The **event bus and `workflow_runs` dedupe primitives described below remain load-bearing infrastructure** for ingestion, source sync, HITL, lineage, and webhooks and must be preserved. Read the rest of this section as historical context for the event-bus design only; do not invest in broad sequence or user-authored workflow expansion.

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
- Workflow-triggered writebacks and sequence sends carry origin metadata, proof receipts, and idempotency where the action can be retried.
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

- Source
- Signals
- Memory
- Handoffs
- Systems of Record
- Workspace Agent
- MCP / CLI / REST
- scoped human actors
- lineage and audit

The 0.9 work is to make that spine dependable enough for real users and external agents.

### Current 0.8.x Hardening Checkpoint

The 0.8.x hardening line closes the riskiest early gaps on the way to 0.9: Source reliability, customer-record resolution, Action Context, surface cleanup, durable agent work, MCP/CLI setup, and scoped safety. The current codebase is close to a 0.9-ready self-hosted/local release; the remaining work is mostly launch proof, live-provider certification, and hosted-production hardening.

Completed in the 0.8.x hardening line:

- **Source reliability foundation:** app, REST, MCP, CLI, file/reprocess, Email, and Activity paths now share durable Source receipt semantics, retry metadata, stale-processing repair, replayable payload storage, and data-quality recovery actions.
- **Golden extraction coverage:** the durability suite includes a GTM extraction corpus, custom registry corpus, no-context replay, duplicate-source idempotency, proposed-record handoff dedupe, malformed JSON recovery, typed Memory readiness, and conservative auto-promotion checks.
- **Duplicate corroboration protection:** repeated ingestion of the same source no longer creates extra Signals or artificial independent evidence for promotion.
- **Subject Graph resolver:** `customer_record_resolve` is the primary account-first resolver for agents and CLI/REST/MCP. Source extraction, reprocess, file ingestion, email association, calendar/activity association, and agent guidance now share the same resolver semantics.
- **Ambiguity safety:** same-name contacts, opportunities, and use cases are not over-linked without account scope; ambiguous child records become receipts/review states instead of guessed links.
- **Customer Email and Activity association:** deterministic anchors such as known contact email, reply chain, attendee email, and account domain are still used, then Subject Graph enriches account-scoped contact/opportunity/use-case links when source content supports them.
- **MCP/CLI setup path:** the agent smoke path exercises `customer_record_resolve -> briefing_get -> context_signal_group_list`; examples for Hermes, Claude Desktop, Claude Code, Codex, ChatGPT Developer Mode, and OpenClaw are aligned to the current tool model.
- **Scoped safety checks:** hardening tests cover Source no-subject receipt visibility, MCP resource subject access, explicit tool scope mappings, and Workspace Agent write-object policy defaults.
- **Source and navigation cleanup:** primary navigation is focused on the core loop; Customer Email and Customer Activity are framed as Context Sources; Automations/Sequences are moved into admin settings surfaces while compatible routes remain available.
- **Docs alignment:** README, guide, MCP tool reference, examples, recipes, Source reliability plan, record-resolution plan, and contributor “what belongs where” guidance now describe the same Observe -> Signals -> Memory -> Briefing/Active Context -> Handoff/Writeback -> Proof model.
- **Action Context v1:** `POST /api/v1/action-context` and MCP `action_context_get` assemble action-aware context, readiness, policy/source-authority checks, and compact retrieval proof without mutating CRM records or executing writebacks. Email drafts, record create/edit previews, record updates, assignment creation, workflow-triggered email/writeback actions, sequence email and non-email actions, durable agent turns, and systems-of-record writeback previews/requests now carry verified Action Context receipts where they can affect customer work.
- **Signal Readiness v1:** Signal group responses include deterministic readiness and resolution metadata. The web workflow can repair missing typed Signal details inline through `context_signal_group_complete_details`.
- **Actor-scoped aggregate safety:** search and stats surfaces now respect member/manager/admin visibility so external agents cannot use aggregate tools as a tenant-wide data leak.
- **Durable Workspace Agent turns:** agent turns are persisted with ordered events, worker leases, heartbeats, expired-lease recovery, active-turn blocking, automatic operation keys for idempotent tools, receipt-first external side-effect attempts, persisted successful-tool-result replay, side-effecting tool coverage tests, and final changed-record/action summaries so users can navigate away and workers can recover long-running turns without starting duplicate session work or duplicating supported writes.

Remaining before calling 0.9 launch-ready:

- Run a clean first-run proof from an empty database: `init -> seed demo -> agent-smoke -> briefing/action-context proof -> lineage`.
- Certify first-party SOR connectors and provider-specific mailbox/calendar OAuth behavior against live or sandbox HubSpot, Salesforce, Google, Microsoft, Databricks, and Snowflake environments.
- Update release/runbook docs with the supported hosted envelope: local and single-instance self-hosted remain simple; hosted/multi-instance app tiers require stable `CRMY_INSTANCE_ID`, `CRMY_MCP_SESSION_MODE=sticky`, and routing by `mcp-session-id`; the remaining 1.0 work is the split worker runbook and optional internal MCP forwarding decision.
- Keep expanding real-world extraction/resolution fixtures as users contribute messy transcripts, customer emails, calendar artifacts, and source-system edge cases.
- Run broader synthetic large-tenant soak tests. Current gates verify correctness, drift, security boundaries, and durability; 1.0 still owns high-volume latency budgets on serverless Postgres.
- Harden browser session handling before hosted enterprise GA. The current bearer-token flow is fine for local/self-hosted 0.9, but hosted browser sessions should move toward short-lived/session-managed auth with revocation and CSRF-safe mutation behavior.
- Certify the hosted SaaS OAuth model for Context Connectors against production Google/Microsoft app registrations. The application now supports CRMy-managed Google/Microsoft OAuth apps by default, tenant-owned OAuth app overrides for enterprise tenants, and environment-managed credentials for local/self-hosted installs; 1.0 still needs live-provider verification, consent-screen review, and hosted operational runbooks.

### 0.8.6 Release Checkpoint

0.8.6 is a follow-up 0.8.x hardening release, not the 0.9 release. It focuses on making the agent-facing surface easier to prove and operate from outside the web app.

Completed in this checkpoint:

- **MCP/API/CLI parity:** the CLI can list, describe, and call the actor-scoped MCP tool surface through REST, reducing drift between external agents, API clients, and terminal workflows.
- **Agent harness validation:** recipes and examples now point users toward `agent-smoke` and `tools describe` before debugging Claude, Codex, ChatGPT Developer Mode, Hermes, or OpenClaw setup.
- **Recipe cleanup:** runnable recipe commands prefer friendly record references such as `account:Northstar Labs` instead of requiring users to know UUIDs.
- **Source guidance:** recipes now prefer `context_ingest_auto` for messy transcripts, emails, notes, research, and debriefs, with direct `context_add` reserved for advanced reviewed writes.
- **OpenClaw support:** the OpenClaw plugin exposes Source ingestion and aligns its skill guidance with the current account, Signal, Memory, and Handoff model.

### 0.8.7 Release Checkpoint

0.8.7 is a same-day launch-hardening patch for 0.8.6, not the 0.9 release.

Completed in this checkpoint:

- **Auth/scope hardening:** JWT users resolve against current database user/actor state; deactivated users and actors are rejected; missing scopes no longer imply broad access; admin-only scopes cover API keys, HITL policies, inbound email config, and systems administration.
- **API key governance:** API key management is owner/admin-only with `api_keys:admin`, and requested scopes must be known and within the grantor's own authority.
- **Webhook safety:** inbound email ingestion requires explicit tenant identity plus a valid HMAC signature; webhook secret configuration requires owner/admin plus `email_provider:admin`.
- **HITL/writeback safety:** HITL policy routes are ordered correctly, HITL rules require `hitl:admin`, pending writebacks cannot execute before approval, and HITL/writeback review state transitions are transactional.
- **Migration reliability:** migrations use a connection-scoped PostgreSQL advisory lock to reduce concurrent runner risk.
- **Self-registration guidance:** setup documentation now reflects the current local actor/API-key model.

### 1. Extraction Reliability And Typed Memory Readiness

Status: **Landed for v0.9 self-hosted readiness; expanding through live corpus.** Source receipts, durable replay, golden fixtures, custom registry fixtures, event-time-aware duplicate protection, typed readiness, permission-safe retry, and conservative auto-promotion checks are landed. Broader live-source corpus coverage and calibration continue as real users contribute messy inputs.

Source ingestion is the heart of CRMy. In 0.9 it should be treated like critical infrastructure.

Key changes:

- Durable extraction jobs for app, REST, MCP, CLI, email, and meeting sources.
- One bounded extraction pass per source where possible, with account-scoped subject resolution before child record matching.
- Structured-output support for providers that support it, with strict JSON repair and clear failure receipts for providers that do not.
- Retry and catch-up behavior for timeouts, malformed JSON, unavailable models, missing embeddings, and partial provider failures.
- Golden GTM extraction corpus covering calls, emails, meeting notes, transcripts, renewals, handoffs, risk, buying process, success criteria, forecast signals, commitments, and next steps.
- High-recall Signal creation, but conservative Memory promotion when evidence, typed detail, confidence, source quality, or policy is insufficient.
- Richer receipts that explain matched account scope, examined child records, created Signals, proposed records, skipped internal/spam sources, review needs, and write failures.

Acceptance target: messy customer inputs should usually produce useful Signals or an actionable reason why they did not. This target is met in the durability suite; the next step is live-provider and real-world corpus certification.

### 2. Source Coverage Maturity

Status: **In progress.** Customer Email, Customer Activity/calendar, REST, MCP, CLI, Add Context, and systems-of-record sync are first-class. Inbound Slack, support desk, product telemetry, and document repository adapters remain planned.

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

- Make every source path route through the same Source ingestion and receipt model.
- Keep internal, spam, automated, excluded-domain, and low-value messages out of storage and extraction by default.
- Add source maturity labels in docs and admin setup copy: `First-class`, `Via REST/MCP/CLI`, `Planned connector`.
- Preserve optionality: mailbox and calendar connections are useful, but emails, transcripts, notes, and activity context can still enter through Add Context or MCP.

### 3. Unified Agent Action Context Packet

Status: **Landed for v1; expanding through live proof.** `POST /api/v1/action-context` and MCP `action_context_get` exist. Email drafts, record create/edit previews, assignments, durable agent turns, workflow-triggered outreach/writeback, sequence email and non-email actions, and systems-of-record writeback requests carry Action Context receipts. Remaining work is live proof polish, UX consistency, and continued adoption as new side-effecting workflows are added.

Agents need one packet that helps them act intelligently on customer work. This is not meant to gate every step. It should make low-risk work faster by giving the agent the right Memory, Signals, source ownership, policy, and proof context up front, while reserving review for actions that can affect customers, records, systems of record, or trust boundaries.

The shared Action Context service, exposed through REST and MCP, returns:

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

Action Context should resolve into one of three operating modes:

| Mode | Behavior | Examples |
|---|---|---|
| `inform` | Provide context and proof hints without slowing the agent down. | Brief an account, summarize current risks, draft internal notes, prepare a follow-up, search Memory, add Source. |
| `warn` | Allow the action, but surface stale, inferred, conflicting, or low-confidence context clearly. | Draft a customer email using unconfirmed Signals, recommend next steps with stale Memory, prepare a record update preview. |
| `require_review` | Require human review before execution. | Send customer email automatically, change forecast/stage/amount/owner, write back to CRM/warehouse, make external commitments, use unconfirmed Signals as fact, act on out-of-scope records. |

Current interface:

- REST: `POST /api/v1/action-context`
- MCP: `action_context_get`
- internal service available for Workspace Agent, Handoffs, draft email generation, record create/edit previews, Automations, Sequences, and writeback planning

This should not replace `briefing_get`. Use `briefing_get` for customer understanding and `action_context_get` when an agent is preparing a specific action and needs policy, source authority, warnings, proof, or review requirements.

### 4. Signal Readiness Calibration And Grouping Proof

Status: **Landed for v1; expanding through calibration.** Signal groups expose readiness and resolution metadata, inline missing-detail repair, source-quality handling, and duplicate-event protections. Remaining work is deeper calibration against larger real-world corpora and continued tuning of tenant-visible source-quality defaults.

Signals should be understandable and reliable enough for users to confirm, route to review, or ignore.

Key changes:

- Calibrated readiness-score tests against the golden extraction corpus.
- Tenant-visible source quality settings with conservative defaults.
- Clear distinction between model confidence, source quality, evidence count, independent sources, conflicts, typed completeness, and promotion threshold.
- Semantic candidate retrieval for related account/contact/opportunity/use-case evidence when embeddings are ready, with deterministic fallback when they are not.
- Catch-up regrouping when delayed embeddings arrive.
- Explicit non-merge rules for distinct GTM claims such as stakeholder role, risk, next step, buying process, commitment, and success criteria.
- Regression tests for account-scoped grouping, contact/account cross-evidence, duplicate Memory avoidance, and conflict creation.

Acceptance target: a user can see why a Signal is not Memory yet and what action will make it usable by agents.

### 5. Proof-Grade Lineage And Audit

Status: **Landed for first-class workflows; 1.0 owns scale polish.** Lineage includes Sources, Signals, Memory, Active Context retrievals, Handoffs, writebacks, workflow/sequence actions, and audit events. Remaining work is scale, retention, export, and precomputed edge performance.

Lineage should become the proof trail for the source-to-action lifecycle.

Key changes:

- Sources -> activity/email/meeting -> Signal -> Signal group -> Memory -> briefing retrieval -> agent action -> Handoff -> writeback -> audit.
- Persist retrieval events when Memory or Signals are loaded into Active Context for a high-impact agent action.
- Attach writeback receipts to the Memory, Handoff, system-of-record mapping, and audit event they came from.
- Show partial lineage honestly when older records or external actions do not have complete links.
- Add proof-trail completeness tests for every first-class workflow.

Acceptance target: admins and builders can answer what happened, why it happened, what evidence was used, who approved it, and which external system changed.

### 6. Durable Agent Work And Human Collaboration

Status: **Landed for v0.9 single-instance/self-hosted readiness; 1.0 owns hosted multi-instance orchestration.** Workspace Agent, Handoffs, assignments, HITL, and tool transparency exist. Durable turn continuity now has persisted events, worker leases, heartbeats, expired-lease recovery, active-turn blocking, stable operation keys for tools that expose `idempotency_key`, receipt-first external side-effect attempts, replay of already-persisted successful tool results, coverage tests for side-effecting MCP tools, and final changed-record/action summaries. Remaining work is richer multi-step task orchestration and the hosted multi-instance runtime described in the 1.0 plan.

The Workspace Agent should be a durable workbench, not just a chat surface.

Key changes:

- Durable agent tasks with goal, subject, plan, steps, tool calls, status, approvals, retries, and final change summary.
- Work can continue in the background and resume after browser navigation or server restart; worker leases prevent two instances from intentionally running the same turn at once, stable agent operation keys prevent duplicate writes for idempotency-aware tools, persisted tool results are reused on recovered turns, and final responses can summarize successful changed records/actions.
- Write plans before risky changes across CRMy objects, CRM writebacks, warehouse writebacks, sequence sends, automation-triggered writes, and customer email sends.
- HITL approvals native inside agent task execution, Automations, Sequences, email drafts, record create/edit previews, and connector writeback.
- Handoffs support decision rationale, reassignment, comments, linked evidence, SLA, and task history.
- Agent conversations can propose Memory, but Memory still requires evidence, policy, and review gates.

Acceptance target: a user can delegate work, leave, return, inspect what happened, approve or reject actions, and verify that permissions were enforced.

### 7. Scoped Access Parity Across Every Surface

Status: **Landed for core 0.9 surfaces; continuously expanding.** Core REST/MCP/worker parity tests exist across Source, MCP resources, action tools, aggregate safety, workers, and agent paths. Continue adding coverage as new tools and UI flows land.

Scoped actors are a product differentiator and a security boundary.

Key changes:

- Shared parity tests for REST, MCP, CLI, Workspace Agent, Automations, Sequences, Handoffs, search, graph, lineage, email, activity, and systems-of-record endpoints.
- Every tool that reads, resolves, writes, drafts, searches, or links records must enforce the current human actor's effective visibility.
- Members see their book of business, managers see team scope, admins/owners see tenant scope.
- Agent sessions and background tasks re-check access when run, not only when created.
- Permission-denied tool calls return friendly messages without leaking hidden record names or IDs.
- Pre-1.0 hosted auth hardening: move browser auth away from long-lived localStorage bearer tokens, or pair short-lived browser tokens with refresh/session controls, logout/session revocation, and CSRF-safe mutation behavior while preserving the current smooth local setup path.

Acceptance target: the Workspace Agent and external MCP clients cannot become an admin bypass.

### 8. Model And Retrieval Readiness

Status: **In progress.** Model Settings, provider readiness, embeddings configuration, and pgvector fallback paths exist. Remaining work is stronger setup diagnostics and retrieval scale.

Local model setup should be clear enough for builders and safe enough for users.

Key changes:

- Accurate readiness checks for chat, tool calling, JSON output, extraction, and optional reasoning.
- Known-good provider guidance without stale model pickers.
- Friendly messaging when semantic retrieval requires pgvector, an embedding provider, or catch-up jobs.
- Background embedding repair and visibility for missing, failed, stale, or provider-unavailable embeddings.
- Retrieval quality tests for lexical fallback, pgvector retrieval, account-scoped candidates, and briefing enrichment.

Acceptance target: users know whether the Workspace Agent is ready, what is degraded, and what an admin can do about it.

### 9. Demo And Developer Experience

Status: **Landed for v0.9 demo proof; keep aligned.** Demo data, examples, MCP setup, recipes, and smoke paths exist. Remaining work is manually verifying the clean first-run loop before each release and keeping demos aligned with the current Action Context and Signal Readiness model.

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

### 10. Product Surface Cleanup And Feature Altitude

Status: **In progress.** Primary navigation and Context surfaces are simplified. Remaining work is continuing workflow polish without hiding power-user paths.

0.9 should make CRMy simpler without making it smaller. The goal is not to delete useful capabilities. The goal is to put each capability where it belongs so the product reads as the context-and-action engine first.

The first-time user should understand:

> CRMy observes customer context, turns it into Signals and Memory, briefs agents, routes risky action through Handoffs, and writes back safely.

Guiding rules:

- Keep the source-to-action loop visually central: Sources -> Signals -> Memory -> Briefing / Active Context -> Handoff / Writeback -> Audit.
- Hide or demote features that compete with that loop until they are needed.
- Move admin/operator features out of daily user paths.
- Rename features by outcome, not implementation.
- Prefer progressive disclosure over deletion.

Recommended feature altitude:

| Feature | 0.9 visibility | Rationale |
|---|---|---|
| Sources | Core | Intake layer for messy customer material. |
| Signals | Core | Reasoning layer for inferred claims. |
| Memory | Core | Confirmed operational context agents can rely on. |
| Handoffs | Core | Human review and safety layer. |
| Workspace Agent | Core | Primary user-facing action surface. |
| Briefings / Active Context | Core | The agent intelligence packet. |
| Lineage | Core/supporting | Proof trail for source-to-action lifecycle. |
| Customer Email | Supporting source | Feeds context; should not feel like an inbox replacement. |
| Customer Activity | Supporting source | Meetings, calls, notes, and transcripts feed context; should not feel like a calendar/activity app. |
| Systems of Record | Admin | Source authority, mapping, sync, and governed writeback setup. |
| Policies / Registries | Admin | Governance and typed Memory configuration. |
| Operations / Audit | Admin | Reliability, recovery, proof, and compliance. |
| Context Graph | Supporting/advanced | Record exploration, not the main proof engine. |
| Automations | Advanced | Event/action routing; avoid generic workflow-builder positioning. |
| Sequences | Experimental/advanced | Governed outbound orchestration; avoid sales-engagement positioning. |
| Manual writeback test bench | Advanced | Admin/operator testing only. |
| Direct manual Memory creation | Advanced | Normal users should add context, review Signals, and confirm Memory. |

> **Updated 0.9.4 direction.** The **Automations** and **Sequences** rows above are experimental, not default product surfaces. The internal event bus stays. See [Strategic Refocus -> Scope Decisions](#scope-decisions-build-freeze-kill) and [Experimental Surface Plan](#experimental-surface-plan-sequences--automations).

Key cleanup changes:

- Keep primary member/manager navigation focused on Overview, customer records, Context, Handoffs, and Workspace Agent.
- Move Customer Email and Customer Activity into a Context `Sources` surface or clearly frame them as source feeds.
- Move Automations, Sequences, Webhooks, and manual writeback testing into Settings -> Automation Experiments or other admin-only settings surfaces.
- Keep Context tabs centered on Sources, Signals, Memory, and Lineage. Keep Graph secondary.
- Make record drawers the main customer action hub: Ask Agent, Update with Agent, Generate Brief, Add Context, Draft Email, Log Activity, Review Signals, and View Lineage.
- Reorganize Settings around Workspace, Agent, Sources, Systems, Governance, Operations, and Advanced.
- Keep routes backward compatible even when nav placement changes.

Language cleanup:

- Use `Signal`, not `Signal Group`, in the user-facing app.
- Use `Confirm Signal`, not `Promote to Memory`, for normal users.
- Use `Customer Email` as a context source, not inbox management.
- Use `Customer Activity` as meeting/call/note context capture, not generic activity logging.
- Use `Action Rules` or `Event Rules` when Automations are visible.
- Avoid positioning CRMy as a CRM replacement, sales engagement platform, generic workflow builder, or chatbot memory store.

Implementation order:

1. **Navigation cleanup:** move Email and Activities out of primary nav; move Automations and Sequences to Settings -> Automation Experiments; keep routes compatible.
2. **Context simplification:** add a Sources surface, demote Graph, and keep Sources / Signals / Memory / Lineage as the main Context path.
3. **Settings consolidation:** group admin setup by outcome and hide admin-only areas from non-admins.
4. **Workflow polish:** make Overview and record drawers surface source issues, Signals, Handoffs, stale Memory, and missing context as work to do.
5. **Docs alignment:** organize docs around Observe -> Signals -> Memory -> Briefing -> Handoff / Writeback -> Proof, with advanced features moved out of the first-run path.

Acceptance target: a new user sees one product story, not a collection of adjacent apps. The power remains available, but the default path explains CRMy as the confirmed context and governed action layer for agents.

### 0.9 Non-Goals

- Do not weaken the README positioning.
- Do not turn CRMy into a CRM replacement.
- Do not hard-code one sales methodology.
- Do not require pgvector for the core product to work.
- Do not require mailbox/calendar connections for emails, transcripts, or notes to feed Memory.
- Do not let agents write directly to systems of record without policy, preview, idempotency, approval where required, and audit.

## 0.9.3: Eval Harness, Trusted Facts, And Agent Quality Gates

Status: **Foundation landed for 0.9.3; expanding toward 1.0 proof.** See
[CRMy 0.9.3 Eval Harness Plan](eval-harness-0.9.3-plan.md) and
[Governed Knowledge Retrieval Plan](governed-product-knowledge-retrieval.md).

0.9.3 makes CRMy's customer-context promise measurable in layers. The default
`contract` profile proves parser, promotion, readiness, and record-resolution
plumbing against deterministic corpora. The `seeded_context` profile calls
production briefing and Action Context services against a fixture DB and scores
retrieval recall, scope leaks, stale warnings, readiness decisions, unsafe
writeback allowance, and source attribution safety. The `live_model` profile
measures extraction quality from messy source text by seeding an eval activity
DB and calling production `extractContextFromActivity` without
`modelOutputOverride` when eval model credentials are configured. The
`agent_runtime` profile reports tool-choice and trajectory smoke scores.

The remaining 1.0 proof work is breadth and portability: more redacted
customer-derived cases, embedding/semantic retrieval comparisons, live connector
certification, model-backed cross-runtime agent trajectories, and public
benchmark artifacts.

0.9.3 should also add optional governed company, product, solution, pricing,
implementation, security, compliance, roadmap, and competitive Trusted Fact
retrieval. Customer Memory remains the core product. Knowledge should be a
sibling retrieval layer that helps agents connect customer context to safe
customer-facing Trusted Facts without turning CRMy into a CMS or making
knowledge required for briefings, Action Context, writeback, or local agent
workflows.

Implemented 0.9.3 foundation:

- Stable eval case, suite, result, profile, threshold, model metadata, and
  artifact schemas.
- Local-first CLI profiles: `contract`, `live_model`, `seeded_context`, and
  `agent_runtime`.
- Source, custom registry, and record-resolution contract suites.
- Live extraction quality suite that does not consume `golden_model_output` as
  model input, uses the production extraction/write/group/receipt path, and
  skips cleanly unless live config is required.
- Seeded retrieval, Action Context, and source-attribution gates.
- Tool-choice and agent-trajectory smoke suites.
- Native JSON and JSONL artifact output for Ragas/LangSmith-style offline
  analysis.

Recommended next direction:

- Emit richer trace spans for subject resolution, retrieval, policy evaluation,
  Action Context assembly, tool calls, handoffs, writeback previews, and final
  output scoring.
- Export eval runs to OpenAI Evals-style datasets, Ragas-compatible retrieval
  rows, and LangSmith-compatible traces or datasets where configured.
- Support redacted customer-derived eval cases so production failures can become
  offline regression tests without leaking unnecessary customer data.
- Keep extending the shared `KnowledgeRetrievalService` now exposed through MCP,
  REST, CLI, Workspace Agent, briefing, Action Context, and UI surfaces.
- Keep external systems authoritative for product docs, battlecards,
  changelogs, pricing, roadmap, security, and compliance material.
- Store Trusted Facts, freshness, approval, visibility,
  citations, and retrieval receipts separately from customer Memory.
- Prevent stale, unapproved, internal-only, deprecated, unsupported, or
  conflicting Trusted Facts from reaching customer-facing draft packets.

Acceptance target: a contributor or customer can run `crmy eval run --profile
contract`, `crmy eval run --profile seeded_context`, and `crmy eval run
--profile agent_runtime` and receive reports showing whether CRMy retrieved the right
Memory and Signals, chose safe tool paths, made correct Action Context
decisions, preserved source attribution, avoided unsupported customer-facing
claims, and left enough proof to audit the workflow. When Trusted Facts are
configured, agents can retrieve company, product, and competitive context in
a cited, policy-aware, freshness-aware, and auditable way; when it is not
configured, the core 0.9 customer Memory and Action Context product behaves as
it does today.

## 0.9.3: Optional Governed Knowledge Retrieval

Status: **Phases 1-7 of the Trusted Fact path landed in 0.9.3; source-adapter automation remains roadmap.** See
[Governed Knowledge Retrieval Plan](governed-product-knowledge-retrieval.md).

After 0.9 hardens customer Memory, Action Context, source reliability, proof,
and surface consistency, 0.9.3 adds optional governed retrieval for company,
product, service, solution, and competitive Trusted Facts. The implementation includes fact
envelopes, policy filtering, retrieval receipts, MCP, REST, CLI, briefing/Action
Context enrichment, email draft grounding, freshness, conflicts, and admin
governance. It returns `not_configured` until Trusted Facts exist.

This should not become a required dependency for core CRMy behavior. Customer
briefings, Action Context, Workspace Agent flows, email drafts, and writeback
safety must continue to work when no Knowledge Sources are configured.
Actors may still compile knowledge at the edge. CRMy should provide
additional value when actors choose to retrieve this knowledge through CRMy:
freshness checks, approval filtering, external-use visibility, evidence,
citations, warnings, and retrieval proof.

Recommended direction:

- Add source-adapter automation so product docs, battlecards, changelogs,
  security/compliance material, and support/KB systems can produce Trusted
  Facts without manual upsert.
- Add embedding-backed retrieval and richer knowledge eval suites where
  they improve precision beyond the current FTS/ranking foundation.
- Keep external systems authoritative for product docs, battlecards, changelogs,
  pricing, roadmap, security, and compliance material.
- Store source metadata, source-derived facts, freshness, approval,
  visibility, citations, and retrieval receipts in CRMy.
- Add Trusted Facts to briefings and Action Context only when explicitly
  requested or configured.
- Treat edge-provided knowledge as allowed but not CRMy-verified unless
  it passes through the governed retrieval path.

Non-goals for this post-0.9 work:

- Do not require users to maintain knowledge manually in CRMy.
- Do not turn CRMy into a generic knowledge base, CMS, battlecard platform,
  roadmap system, or CPQ source of truth.
- Do not merge Trusted Facts into customer Memory without a separate
  namespace.
- Do not let stale, unapproved, internal-only, deprecated, or conflicting facts
  reach customer-facing draft packets.
- Do not require pgvector, embeddings, mailbox/calendar, or local MCP setup for
  the core product to function.

Acceptance target: when configured, agents can retrieve product and competitive
context through CRMy in a way that is more specific, safer, cited, policy-aware,
and auditable than edge-only retrieval. When not configured, CRMy behaves like
the 0.9 customer Memory and Action Context product.

## 0.9.x-1.0: Neutral Customer-Context Control Plane

Goal: make CRMy the runtime-neutral trust boundary for customer-facing agents.
Every supported agent runtime should be able to ingest customer context,
retrieve Active Context, request Action Context, route human decisions, preview
governed writes, execute approved writeback, and inspect proof through the same
contracts.

This work reinforces the core positioning:

```text
Source ingestion -> Signal review -> Memory -> Action Context -> HITL -> Governed writeback -> Proof
```

The 0.9.3 eval and Trusted Fact workstreams are complementary:
evals prove whether the control-plane contracts work, while Trusted Facts
extend the same governance model from customer Memory to customer-facing
facts. The remaining items below should land across 0.9.x and 1.0 based on
risk, runtime dependencies, and production scale requirements.

### 1. Agent Runtime Certification Matrix

Certify CRMy workflows across the agent runtimes and clients customers actually
use.

Target runtimes and clients:

- CRMy Workspace Agent;
- Codex and other CLI/workbench agents;
- Claude Desktop / Claude Code MCP clients;
- OpenAI Agents SDK;
- LangGraph;
- custom MCP clients;
- REST-only agents and workflow runners.

Canonical certification flow:

```text
customer_record_resolve
  -> briefing_get
  -> action_context_get
  -> draft/preview
  -> HITL or writeback
  -> context_lineage_get
```

0.9.3 complement:

- Seed certification cases through the eval harness.
- Publish a small runtime compatibility report for the demo workflow.

1.0 target:

- Every certified runtime has a repeatable harness report covering read,
  draft, human-unblock, writeback-preview, and lineage flows.

### 2. Portable Action Context Contract

Treat Action Context as the stable preflight contract agents use before
meaningful customer-facing or system-changing work.

The contract should remain versioned and portable across MCP, REST, CLI,
Workspace Agent, workflows, sequences, and future SDKs.

Required packet areas:

- `operating_mode`;
- `readiness`;
- `policy`;
- `source_posture`;
- `allowed_actions`;
- `human_unblock`;
- `proof`;
- `next_tools`;
- `context_packing`.

0.9.3 complement:

- Add eval cases that assert contract shape, mode accuracy, and false-allow
  behavior.
- Document the Action Context contract as the agent preflight boundary.

1.0 target:

- Supported runtimes can consume the same Action Context packet without
  CRMy-UI-specific assumptions.

### 3. Universal Proof Receipt Format

Standardize proof receipts across retrieval, email drafts, HITL, assignments,
record drafts, workflows, sequences, writebacks, and agent turns.

Every meaningful agent action should be able to answer:

- what context was retrieved;
- what evidence supported the action;
- which Signals were unresolved;
- what policy decision applied;
- who approved or blocked it;
- what external side effect happened;
- where Lineage can be inspected.

0.9.3 complement:

- Include proof-completeness scoring in eval results.
- Preserve Trusted Fact retrieval receipts separately from customer Memory
  receipts.

1.0 target:

- Retrieval, action, Handoff, writeback, and audit receipts share a consistent
  envelope with stable references and export support.

### 4. Source Connector Certification Program

Make provider readiness measurable instead of anecdotal.

Certified source classes:

- Customer Email;
- Customer Activity and calendars;
- transcript and notes drops;
- Salesforce;
- HubSpot;
- Databricks;
- Snowflake;
- future support, product-usage, document, and custom API sources.

Certification dimensions:

- sync correctness;
- source authority;
- field mapping;
- retry and replay;
- redaction and secret safety;
- writeback preview and receipts;
- lineage and proof;
- skipped-source accounting;
- scoped-access behavior.

0.9.3 complement:

- Add connector certification as an eval suite category.

1.0 target:

- Every first-class connector has a portable certification report before it is
  positioned as production-ready.

### 5. Context Source Registry And Health Model

Represent every source as a governed source with ownership, freshness,
authority, health, and failure state.

Admins should be able to inspect:

- source freshness and last successful sync;
- failed extraction or sync attempts;
- stale credentials;
- unmapped fields;
- duplicate-source risk;
- source-authority posture;
- skipped-source volume;
- recovery actions.

1.0 target:

- Source health is visible to humans and available to agents through briefings,
  Action Context, Lineage, Operations, and connector certification reports.

### 6. Memory Governance Lifecycle

Deepen Memory lifecycle controls beyond creation and retrieval.

Lifecycle states and controls should include:

- freshness policies;
- confidence decay by context type;
- revalidation queues;
- contradiction review;
- source revocation;
- retention and redaction;
- confidence recalibration;
- supersession rules;
- sensitive-claim approval rules.

0.9.3 complement:

- Add eval cases for stale, contradictory, unsupported, and source-revoked
  claims.

1.0 target:

- CRMy can explain why a Memory item is current, stale, superseded, disputed,
  sensitive, rejected, redacted, or unsafe to use.

### 7. Agent Identity And Delegation Model

Strengthen actor identity for agents across runtimes.

Required identity boundaries:

- agent registration;
- runtime/client identity;
- delegated human actor;
- scope grants;
- approval authority;
- impersonation prevention;
- actor/session fingerprints;
- audit identity references.

1.0 target:

- Every agent action can answer which agent acted, on behalf of whom, with which
  scopes, from which runtime, and under which approval authority.

### 8. Control-Plane Event Stream

Expose a durable event stream for agent runtimes, integrations, and operators.

Event families:

- Source received, processed, failed, or reprocessed;
- Signal created, grouped, ready, confirmed, rejected, or blocked;
- Memory confirmed, stale, superseded, redacted, or revoked;
- Action Context retrieved;
- Handoff submitted, assigned, approved, rejected, or expired;
- writeback previewed, requested, approved, executed, failed, or retried;
- proof receipt created;
- source health changed.

1.0 target:

- External agents and operator systems can subscribe to customer-context control
  events without polling every CRMy surface.

### 9. Policy Engine V2

Make action policies more expressive, explainable, and portable.

Policy inputs should include:

- action type;
- actor and delegated actor;
- runtime/client identity;
- subject type and record state;
- field sensitivity;
- source authority;
- evidence strength;
- customer-facing risk;
- Trusted Fact approval;
- tenant-specific rules.

Policy outputs should remain simple:

- `allow`;
- `inform`;
- `warn`;
- `draft_only`;
- `approval_required`;
- `blocked`.

0.9.3 complement:

- Add eval cases for false allow, false review, field authority, Trusted Fact
  approval, and customer-facing unsupported claims.

1.0 target:

- Policy decisions are explainable, auditable, portable across runtime surfaces,
  and consistently attached to Action Context and proof receipts.

### 10. Runtime-Neutral Handoff Protocol

Make HITL and Handoff packets portable across CRMy UI, email/Slack-style
notification channels, MCP clients, and external workflow systems.

Required Handoff packet areas:

- subject and action summary;
- proposed action payload;
- Action Context packet;
- evidence and source posture;
- policy decision;
- human question;
- allowed decisions;
- deadline/SLA;
- resulting proof receipt.

1.0 target:

- A human can approve, reject, clarify, reassign, or take over with the same
  evidence packet regardless of where the request originated.

### 11. Governed Knowledge Integration

Use the 0.9.3 governed knowledge layer to extend the control plane from
customer Memory to customer-facing Trusted Facts.

Control-plane requirements:

- Trusted Facts stay separate from customer Memory;
- retrieval returns citations, freshness, approval, visibility, and warnings;
- customer-facing drafts cannot use stale, unapproved, internal-only, deprecated,
  or unsupported Trusted Facts;
- Action Context can include Trusted Fact proof when an action depends on it;
- Lineage can show which Trusted Fact receipts influenced a draft or
  action.

0.9.3 target:

- Ship the optional retrieval contract, proof receipts, and basic Action Context
  or draft integration.

1.0 target:

- Knowledge retrieval participates in policy, proof, evals, and
  customer-facing action governance without becoming required infrastructure.

### 12. Eval And Benchmark Suite For Control-Plane Claims

Use the 0.9.3 eval harness as the proof mechanism for the control-plane
roadmap.

Benchmark areas:

- source ingestion quality;
- Signal review quality;
- Memory retrieval quality;
- Action Context safety;
- HITL routing;
- governed writeback;
- source attribution;
- proof completeness;
- runtime portability;
- Trusted Fact safety.

0.9.3 target:

- Run local contract, seeded-context, live-model, and agent-runtime smoke suites
  and produce portable JSON/JSONL reports.

1.0 target:

- Publish a public benchmark suite showing that CRMy can act as the neutral
  customer-context control plane across agent runtimes and source systems.

## 1.0: Resilience At Scale

Goal: make CRMy reliable as the default context and action engine when a tenant has hundreds of thousands of Sources and Signals, tens of thousands of Memory entries, active mailbox/calendar/system-of-record sync, multiple Workspace Agent users, and external MCP clients.

Assumed production shape:

- Serverless Postgres such as Neon, Supabase, or Lakebase.
- Horizontally scaled app instances and separate worker instances.
- Optional pooled database URLs or PgBouncer-style connection pooling.
- Long-running work handled by durable jobs, not by request lifetimes.
- Multiple human roles and agent clients operating under the same scoped access model.

### What Breaks First Without 1.0 Hardening

- **Database connections exhaust.** App instances currently create normal Postgres pools. In serverless deployments, per-instance pools can exceed provider connection limits quickly.
- **Background work starves or stalls.** A single in-process worker loop and global advisory lock can let one slow task block extraction, embeddings, source sync, outbox retries, and agent-turn recovery. The 1.0 target is documented in the [Multi-Instance Runtime Plan](multi-instance-runtime-plan.md).
- **Lists and dashboards get expensive.** Large pages that request counts, broad totals, or client-filtered batches become slow and costly as tenants reach hundreds of thousands of rows.
- **Search becomes uneven.** Global search, Context Browser, Signals, Memory, Graph, and Lineage need consistent server-side filtering, stable cursors, and search indexes instead of loading recent records and filtering locally.
- **Source processing becomes request-bound.** LLM extraction, JSON repair, subject resolution, and signal grouping must survive timeouts, cold starts, provider failures, and retries without duplicate Signals or stuck sources.
- **Source sync becomes too chunky.** Mailbox, calendar, CRM, and warehouse sync need page-level checkpoints and backoff. A provider page failure should not replay or lose an entire sync run.
- **Agent and MCP sessions become fragile without the hosted runtime envelope.** Live MCP transports and long SSE streams are still process-local. The durable MCP session catalog now records identity, scope, ownership, TTL, and expiry, but hosted deployments still need sticky routing, clear reinitialization behavior, and resumable persisted events around those live transports.
- **Lineage and audit become heavy.** Source-to-action proof trails and audit logs grow quickly and need indexed edges, retention/export, and precomputed summaries.
- **Scoped access checks get expensive.** Visibility filters that rely on per-row joins or `EXISTS` checks will degrade unless ownership/scope metadata is materialized on high-volume context tables.

Current code signals behind these findings:

- `packages/server/src/db/pool.ts` uses a normal per-process Postgres pool; production needs explicit serverless connection budgeting.
- `packages/server/src/index.ts` starts migrations and an in-process background worker from the app runtime; production needs separated migration and worker execution.
- `packages/server/src/db/repos/context-outbox.ts` should gain the same stale-lock and retry scheduling guarantees as newer durable queues.
- `packages/server/src/db/repos/search.ts` and high-volume list repos should converge on indexed, scoped, server-side search rather than broad unions or client-filtered recent batches.
- `packages/server/src/services/customer-email.ts` and `packages/server/src/services/customer-activity.ts` need page-level sync checkpoints and pre-storage filtering before large mailbox/calendar deployments.
- `packages/server/src/mcp/session-registry.ts` keeps live MCP transports in memory by design, while `packages/server/migrations/079_mcp_session_catalog.sql` and `packages/server/src/db/repos/mcp-sessions.ts` provide durable ownership, scope validation, TTL, and stale-instance expiry. Production hosted deployments still need the sticky-routing runbook, split worker deployment, and release gates described in the [Multi-Instance Runtime Plan](multi-instance-runtime-plan.md).

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
- Run app/API instances, worker instances, and migration jobs as separate production roles. Local development can keep the current in-app worker path.
- Use the [Multi-Instance Runtime Plan](multi-instance-runtime-plan.md) as the 1.0 implementation contract for processor names, queue contracts, worker behavior, deployment modes, observability, and crash-recovery tests.

Acceptance target: killing a worker mid-job cannot permanently strand Source, embeddings, outbox events, source sync, or agent work.

### 3. Query, List, And Search Scale

Make high-volume pages search-first and cursor-first instead of count-first and recent-first.

Key changes:

- Replace default total-count requirements with `limit + 1` paging, approximate counts, cached rollups, or async totals where exact counts are not user-critical.
- Use stable compound cursors such as `(updated_at, id)` or `(created_at, id)` instead of timestamp-only cursors.
- Add server-side filters for every large collection before records reach the UI: Sources, Signals, Memory, Handoffs, Email Messages, Calendar Events, Activities, Audit, Lineage, Graph, and Search.
- Add tenant-scoped and owner-scope indexes that match the actual filters: tenant, owner/customer scope, status, type, source, subject, updated/created time, and search vector.
- Introduce a unified search index or materialized search table for global search, command palette record lookup, MCP entity resolution, and agent retrieval.
- Virtualize large table/card views and avoid client-side filtering over capped result sets.
- Materialize high-volume access scope where needed, especially for context entries, Sources, signal groups, email messages, calendar events, and audit events.

Acceptance target: a tenant with 500k Sources, 500k Signals, and 50k Memory entries still has fast scoped search, filter, and drawer open flows without requiring pagination controls.

### 4. Source Extraction Throughput

Make extraction high-recall, conservative, idempotent, and resilient under load.

Key changes:

- Route app, REST, MCP, CLI, Email, Activities, attachments, and reprocess flows through one durable Source processing service.
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
- Track embedding coverage by entity type and tenant: Source, Context Entries, Signal Groups, Memory, and source artifacts.
- Add embedding backpressure, model/dimension compatibility checks, stale embedding detection, and re-embedding migration plans.
- Document pgvector/HNSW index strategy for serverless Postgres, including index build timing and operational caveats.
- Avoid embedding low-value filtered sources and duplicate raw payloads.
- Add retrieval evaluation sets for account-scoped candidate discovery, Signal grouping, briefing enrichment, MCP `customer_record_resolve`, and simple account/contact `entity_resolve`.

Acceptance target: semantic retrieval improves grouping and briefing quality when enabled, but CRMy remains correct and usable when embeddings lag, fail, or are disabled.

### 7. Workspace Agent And MCP Durability

Make agent work reliable across browser navigation, deploys, provider errors, and multi-instance routing.

Key changes:

- Keep durable agent turns as the source of truth for messages, events, tool calls, reasoning summaries, changed-record summaries, and final outputs. **Landed foundation:** persisted turn rows, ordered events, worker leases, heartbeats, expired-lease recovery, active-turn blocking, stable operation keys for idempotency-aware tools, replay of prior successful tool results, and final action-summary hints.
- Add polling fallback for every streamed turn so clients can recover when SSE is interrupted. **Landed foundation:** the app can reload session state and active-turn metadata while streamed events remain persisted.
- Move MCP session identity, actor/scope validation, ownership, TTL, and expiry out of process memory. Live SDK transports may remain process-local, but hosted production must use durable session catalog state plus sticky routing, internal forwarding, or explicit session-expired/reinitialize behavior.
- Keep MCP resource notifications recoverable across instances. **Landed foundation:** CRMy domain events now publish best-effort PostgreSQL notifications for live MCP sessions; clients still need durable resource reads and clear reconnect behavior as the correctness fallback.
- Add persisted tool-call idempotency keys for write tools so retries cannot duplicate creates, updates, sends, handoffs, or writebacks. **Landed foundation:** Workspace Agent injects deterministic keys for tools whose schemas expose `idempotency_key`, and tests now fail when side-effecting MCP tool names omit idempotency support without an explicit read-only exception.
- Budget every tool call: default limits, explicit filters, timeouts, and clear “too broad” responses.
- Add MCP doctor and agent smoke tests that prove `customer_record_resolve -> briefing_get -> signal list -> handoff/action` against demo data in under one minute.
- Keep every tool scoped to the current human actor, including background continuation and delayed tool execution.
- Treat [CRMy 1.0 Multi-Instance Runtime Plan](multi-instance-runtime-plan.md) as the release gate for MCP session routing, stale-session behavior, cross-instance notifications, and multi-instance crash tests.

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
- Archive semantics now exist for accounts, contacts, opportunities, and use cases: user-facing delete commands hide records from active workflows while preserving evidence, lineage, Handoffs, and writeback anchors. Remaining lifecycle work is activity archive semantics, retention/export policy, restore UX, and archived audit search.
- Add tenant-level retention controls for raw payloads, email/message bodies, meeting artifacts, extracted snippets, and generated drafts.
- Add data minimization defaults so low-value raw source material is not stored indefinitely.
- Add event replay and dedupe controls for workflow, sequence, webhook, plugin/custom API, context outbox, and writeback events.

Acceptance target: CRMy keeps enough proof for compliance and review while controlling storage, query cost, and sensitive-data exposure.

### 10. Observability, Limits, And Scale Gates

Make scale visible before users feel it.

Key changes:

- Add first-class metrics for request latency, query latency, queue lag, extraction throughput, model latency, provider sync latency, writeback latency, and agent tool latency.
- Add tenant quotas and soft limits for Source ingestion, extraction jobs, mailbox/calendar sync volume, embedding jobs, agent turns, and MCP traffic.
- Add global REST, MCP, and Workspace Agent rate limiting after 0.9: tenant, actor/API-key, IP, and cost-aware request budgets backed by a shared store for multi-instance deployments.
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

- Source from app, REST, MCP, CLI, email, activity, and agent attachments flows through one durable ingestion path with consistent receipts.
- A non-trivial customer source creates useful Signals or an actionable failure reason, without brittle JSON/provider failures becoming dead ends.
- Signal readiness and promotion behavior are calibrated, explainable, and tested against a realistic GTM corpus.
- Agents can request one Action Context packet that explains Memory, Signals, stale context, policy, system ownership, allowed actions, warnings, required review when risk demands it, and proof trail.
- A non-trivial agent request produces durable work with visible progress, tool transparency, approval checkpoints, permission enforcement, and final changed-record summary.
- Risky writes are never silent. Users can preview, approve, reject, retry, or inspect them.
- Proof-grade lineage connects source, Signal, Memory, retrieval, Handoff, writeback, and audit for first-class workflows.
- Member, manager, admin, REST, MCP, CLI, and Workspace Agent access boundaries are covered by parity tests.
- Product navigation and docs make the core loop obvious: Sources -> Signals -> Memory -> Briefing / Active Context -> Handoffs / Writeback -> Audit.
- Email, Activity, Automations, Sequences, Graph, direct Memory creation, and manual writeback testing are placed at the right feature altitude without breaking existing routes.

### 1.0

- CRMy can be deployed against serverless Postgres without connection exhaustion, startup migration races, or health-check query storms.
- High-volume Context pages remain search-first and responsive against synthetic tenants with hundreds of thousands of Sources and Signals.
- Durable jobs recover after worker crashes, cold starts, provider timeouts, and deploys without duplicate Signals, duplicate writes, or permanently stuck processing states.
- Mailbox, calendar, CRM, warehouse, and custom API/MCP source sync can resume from page-level checkpoints and explain skipped/internal/low-value sources.
- Workspace Agent and MCP work can resume through persisted turn events and safe polling when streams disconnect or instances restart.
- Hosted multi-instance deployments satisfy the [Multi-Instance Runtime Plan](multi-instance-runtime-plan.md): separate app/worker/migration roles, durable queue leases, durable MCP session catalog, explicit session routing or expiry behavior, and cross-instance recovery tests.
- Lineage, audit, retrieval, and writeback proof trails remain queryable through indexed edges, retention/export, and precomputed summaries.
- CRMy can be deployed self-hosted by an enterprise team, connected to CRM and warehouse systems, governed by scoped actors/policies, and used by agents for read/write revenue workflows with audit-safe execution.
- Hosted Context Connectors default to CRMy-managed Google/Microsoft OAuth apps so ordinary SaaS tenants can connect mailbox and calendar without deployment-level secrets; enterprise tenants can bring tenant-owned OAuth apps when they need custom consent, security review, publisher identity, or domain app restrictions.
- Hosted browser deployments use session storage patterns appropriate for production SaaS, not long-lived bearer tokens in `localStorage`, while local/dev/self-hosted setup remains fast and understandable.
- Developers can build against stable SDKs and MCP tools without reverse-engineering app behavior.
- Admins can prove what happened, why it happened, who approved it, which systems changed, and what context the agent used.
- Certified agent runtimes can complete the canonical control-plane flow: resolve customer, retrieve briefing, request Action Context, route human review or writeback preview, and inspect Lineage.
- Action Context, proof receipts, Handoffs, source health, and policy decisions are stable contracts across MCP, REST, CLI, Workspace Agent, workflows, and sequences.
- Knowledge retrieval, when configured, participates in policy, citation, freshness, eval, and proof flows without merging Trusted Facts into customer Memory.

## Test Plan

- **Connector tests:** initial sync, incremental sync, schema drift, deleted records, merged records, field mapping, conflict creation, conflict resolution, retry, and idempotent writeback.
- **Warehouse tests:** Databricks/Snowflake read mapping, watermark sync, changed-field detection, append-only writes, upserts, stored procedure writes, failed write recovery, and loop prevention.
- **Automation tests:** external sync emits expected CRMy events, filters match source metadata, workflows dedupe replayed events, and source-loop guards work.
- **Sequence tests:** external events enroll contacts, complete goal events, branch correctly, pause for approval, and avoid duplicate sends.
- **Extraction tests:** golden GTM corpus covers transcripts, emails, call notes, activity debriefs, buying process, success criteria, forecast signals, stakeholders, commitments, risks, next steps, and proposed records.
- **Signal tests:** calibrated readiness scoring, account-scoped grouping, duplicate Memory avoidance, conflict creation, source weighting, typed completeness, and manual confirmation behavior.
- **Agent tests:** Action Context packets include Memory, Signals, stale context, policy, SOR ownership, proof links, operating mode, and review requirements when risk demands them; write plans preview external changes; HITL gates risky actions; task summaries include source-system effects; and audit links resolve correctly.
- **Lineage tests:** source-to-action proof trails connect Source, activity/email/meeting, Signal, Memory, briefing retrieval, Handoff, writeback, and audit for first-class workflows.
- **Scope parity tests:** REST, MCP, CLI, Workspace Agent, search, graph, lineage, Handoffs, email, activity, systems-of-record, Automations, and Sequences enforce the same member/manager/admin visibility model.
- **Retrieval tests:** lexical fallback and pgvector retrieval both find account-scoped candidates without leaking inaccessible records.
- **Security tests:** no arbitrary SQL writes, scoped actors cannot access unmapped systems, field-level authority is enforced, and secrets are never exposed in logs or audit payloads.
- **Hosted browser auth tests:** production browser auth uses httpOnly/session-backed or equivalent short-lived token handling, rejects CSRF-risky mutations, supports logout/session revocation, and still allows the documented local setup path to work without extra manual security setup.
- **Product-surface tests:** member, manager, and admin navigation show the correct core/supporting/admin/advanced surfaces; legacy routes still resolve; user-facing labels avoid `Signal Group`, generic workflow-builder framing, inbox replacement framing, and CRM replacement framing.
- **First-run smoke tests:** start from an empty database, migrate, run `init --demo`, prove the seeded Sources -> Signals -> Memory -> briefing/action-context path through CLI/API/MCP, and load the UI against that workspace.
- **Serverless Postgres tests:** pooled connection budget, statement timeouts, startup without runtime migrations, shallow/deep health behavior, and provider-specific migration guidance.
- **Scale fixtures:** synthetic tenants with 500k Sources, 500k Signals, 50k Memory entries, large audit history, and active mailbox/calendar/SOR sync history.
- **Query-plan tests:** `EXPLAIN` gates for high-volume list/search/detail endpoints, including Context Browser, Signals, Memory, Handoffs, Email Messages, Calendar Events, Audit, Search, Graph, and Lineage.
- **Queue recovery tests:** worker crash/restart, stale lock recovery, retry/backoff, dead-letter handling, context outbox recovery, raw extraction retry, embedding catch-up, and agent-turn continuation.
- **Source-sync scale tests:** provider pagination, cursor replay, partial-page failure, skipped-source aggregate stats, dedupe, row-level errors, and checkpoint resume for mailbox, calendar, CRM, and warehouse sync.
- **Agent/MCP resilience tests:** interrupted SSE stream, polling recovery, multi-instance routing, stale MCP session behavior, tool-call idempotency, broad-query limits, and scoped denied access.
- **Runtime certification tests:** canonical control-plane flows pass across Workspace Agent, MCP clients, REST-only agents, and supported external agent runtimes without runtime-specific trust shortcuts.
- **Control-plane contract tests:** Action Context, proof receipts, Handoff packets, source health, and policy decisions keep stable schemas and consistent behavior across MCP, REST, CLI, UI, workflows, and sequences.
- **Knowledge governance tests:** Trusted Facts remain separate from customer Memory, customer-facing drafts exclude stale/unapproved/internal-only/unsupported facts, and retrieval receipts link citations back to approved sources.

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
