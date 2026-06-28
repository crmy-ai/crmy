# CRMy Context Engine

CRMy's core engine turns messy customer source material into operational Memory agents can safely use. It is what makes CRMy the **trust boundary between agents and customer systems** — the layer an agent calls before it reads, decides, or acts. It is the part of the platform most worth testing, extending, and hardening.

The engine works connector-free: transcripts, notes, and emails are enough to produce briefings, Action Context, and lineage. CRM and warehouse systems of record are an optional upgrade, not a prerequisite.

The engine is not just storage. It is a loop:

```text
Sources -> Subject Graph -> Signals -> Memory -> Briefing / Action Context -> Handoff / Writeback -> Proof
```

## What the engine does

### 1. Capture Sources

Sources are the source material before anything is confirmed: call transcripts, meeting notes, customer emails, calendar meetings, CRM changes, warehouse changes, support/product signals, uploaded files, REST calls, CLI inputs, and MCP tool calls.

Each source should produce a processing receipt that says what CRMy matched, extracted, skipped, retried, or failed. Receipts make extraction replayable and debuggable.

### 2. Resolve the customer record

CRMy uses an account-first Subject Graph resolver. The account is the customer scope. Contacts, opportunities, and use cases are resolved inside that account scope before CRMy falls back to broader matching.

This matters because GTM data is ambiguous:

- multiple contacts share a first name;
- multiple accounts can use similar opportunity names;
- subsidiaries and parent accounts can share domains or aliases;
- meeting transcripts often mention partial names;
- old CRM records may still exist but no longer represent active work.

The resolver should prefer the safest known parent record and keep ambiguity reviewable instead of over-linking precise child records.

### 3. Extract Signals

Signals are inferred claims from Sources. They carry evidence, confidence, source lineage, readiness, and review state. A Signal is not confirmed Memory yet.

Examples:

- a stakeholder role may have changed;
- procurement or legal may be blocking the buying process;
- a next step or commitment was made;
- a deal risk surfaced;
- success criteria or forecast confidence changed.

The engine should stay high-recall for useful customer context but conservative about promotion.

### 4. Confirm Memory

Memory is confirmed operational customer context agents can rely on across sessions and workflows. It is typed, scoped, searchable, current/stale-aware, and auditable.

Signals become Memory only when evidence, confidence, subject resolution, policy, and readiness allow it. Repeated ingestion of the same source must not masquerade as independent corroboration.

Confidence is self-reported by the extraction model, so it is never sufficient on its own for auto-promotion. CRMy applies a model-independent **source-grounding gate**: a Signal can only auto-promote to Memory when at least one of its evidence snippets is actually present in the source text it was extracted from. This means a weak or mis-calibrated model cannot silently mint Memory from a hallucinated claim — ungrounded claims stay reviewable Signals until a human confirms them. The check is intentionally lenient so its failures only add review, never lose context, and it can be disabled with `CRMY_REQUIRE_GROUNDED_AUTOPROMOTE=0`.

### 5. Retrieve Active Context

Agents do not use the whole Memory store directly. They call retrieval tools such as `briefing_get`, `context_search`, semantic search, Graph, or Lineage. CRMy selects relevant Memory, Signals, activity, Handoffs, stale warnings, and token-budget metadata for the model-visible working set.

That temporary working set is Active Context. It is not the same thing as persistent Memory.

`action_context_get` is the action-aware retrieval boundary. It assembles the same briefing context, adds readiness, policy, source-authority, scope, warnings, and expected-proof checks, and records a compact `action_context.retrieved` event. It can assess proposed actions such as outreach, assignment creation, Memory promotion, record update, or external writeback, but it does not perform those actions.

The same Action Context model applies whether the work starts in the UI, Workspace Agent, MCP/CLI, an automation workflow, or a sequence send. A sequence email, for example, can carry the same readiness summary and proof metadata as a manually drafted customer email, and it can route to Handoff when policy or risk requires review.

Action Context is first an intelligence packet, not an approval step. Most agent work should stay low-friction:

- `inform`: provide the right Memory, Signals, source ownership, and proof hints without blocking the agent;
- `warn`: allow the action, but make stale, inferred, conflicting, or low-confidence context visible;
- `require_review`: require human review before actions that affect customers, records, systems of record, external commitments, or trust boundaries.

### 6. Govern action

When an agent prepares action, CRMy should know:

- what Memory supports the action;
- which Signals are still inferred;
- what system owns the record;
- whether the actor can see or change the record;
- which fields are writable;
- whether approval is required;
- what proof will exist after the action.

Handoffs, writeback previews, policy checks, idempotency, execution receipts, audit events, and Lineage make this safe for humans and agents working together. The default posture should be exception-based review: brief, draft, search, summarize, add context, and prepare work quickly; require review only when risk, authority, or evidence quality makes it necessary.

## Current capabilities

The current engine includes:

- durable Source processing receipts;
- replayable source payload storage;
- retry metadata and stale-processing recovery;
- malformed JSON recovery for local-model extraction;
- account-scoped subject resolution;
- Signal grouping and source-quality/readiness checks;
- duplicate-source idempotency and duplicate-corroboration protection;
- proposed-record Handoffs when context implies a new contact, account, opportunity, or use case;
- typed Memory retrieval through `briefing_get`;
- Action Context retrieval through `action_context_get`;
- Action Context receipts on email drafts, record create/edit previews, assignments, workflow-triggered actions, sequence email and non-email actions, durable agent turns, and systems-of-record writeback requests;
- Context Lineage from source to Signal, Memory, Active Context retrieval, Handoff, writeback, and audit;
- optional pgvector-backed candidate retrieval when embeddings are configured;
- scoped REST, MCP, CLI, and Workspace Agent tool access.

## Where community testing helps most

The engine is strongest when tested against messy, real GTM data. The highest-value contributions are:

- anonymized extraction corpora with expected subjects, Signals, Memory, and non-extractions;
- account-resolution edge cases with aliases, subsidiaries, duplicate names, and stale records;
- provider tests for email/calendar/SOR sync under real pagination, filters, failures, and retry behavior;
- writeback tests proving allowed fields, approval, source authority, idempotency, execution receipts, and failure recovery;
- agent harness tests showing `customer_record_resolve -> briefing_get -> context_signal_group_list -> Handoff/writeback` works outside the web UI.

If CRMy gets this engine right, agents can act with far better boundaries: before any agent acts on a customer, CRMy can tell it what is confirmed, what is stale, what is inferred, what is approved, what system owns the record, what action is allowed, and what proof/audit trail will exist afterward.
