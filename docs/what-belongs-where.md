# What Belongs Where

CRMy should stay lifecycle-first. New features should make it easier to understand how customer context becomes agent-safe action.

## Product Surfaces

| Surface | Belongs here | Does not belong here |
|---|---|---|
| **Overview** | Daily work queue, scoped book-of-business health, source issues, Signals needing confirmation, Handoffs needing decisions, fast actions. | Admin setup, raw configuration, audit exploration, broad reporting. |
| **Context** | Raw Context, Signals, Memory, Lineage, source processing receipts, context search. | Inbox-style email triage, calendar management, automation builders. |
| **Context → Sources** | How context enters CRMy: Add Context, MCP/API, Customer Email, Customer Activity. | Deep mailbox/calendar workflows, provider credentials, advanced sync settings. |
| **Customer Email** | Customer-facing email review, unmatched messages, draft replies, approvals, mailbox connection state. | General inbox replacement, internal mail archive, spam processing. |
| **Customer Activity** | Customer meetings, calls, notes, missing context, debriefs, calendar connection state. | Full calendar replacement, internal meeting management. |
| **Customer Records** | Account/contact/opportunity/use-case facts, Memory coverage, briefings, scoped actions, record-specific Add Context. | Global context review or system setup. |
| **Handoffs** | Human decisions for risky, uncertain, delegated, or externally impactful work: approve, reject, reassign, complete, and inspect decision packets. | General task management, or low-risk agent work that only needs context and warnings. |
| **Workspace Agent** | Scoped GTM workbench, Active Context, tool work, draft assistance, record-bound questions. | Admin configuration, unrestricted record access, silent writes. |
| **Settings** | Workspace configuration, profile, model setup, systems of record, registries, policies, source filters. | Daily seller/customer-success workflow. |
| **Settings → Automations** | Action rules, sequences, webhooks, and advanced automation utilities. | First-run onboarding or primary user navigation. |
| **Reliability / Audit Log** | Admin/operator evidence, recovery, data quality, immutable receipts. | Member-facing daily work. |

## Lifecycle Rules

- **Raw Context** is source material before extraction.
- **Signals** are inferred claims with evidence and readiness.
- **Memory** is confirmed operational customer context agents can rely on.
- **Lineage** explains how source material became Memory, Handoffs, writebacks, and audit receipts.
- **Active Context** is temporary model-visible context assembled during an agent turn.

When in doubt, ask: does this help a user understand or move the source-to-action lifecycle forward?

## Engine Guardrails

- Keep Raw Context, Signals, Memory, Active Context, Handoffs, writebacks, receipts, and audit events as separate lifecycle states.
- Validate runtime data at the edge: REST, MCP, webhooks, providers, syncs, emails, calendars, files, and LLM output.
- Scope every read and write by tenant, actor, role, owner visibility, and tool permissions.
- Keep provider-specific behavior in provider adapters; the core engine should consume CRMy-shaped data.
- Keep durable invariants in PostgreSQL: idempotency, uniqueness, current/stale state, row versions, replay safety, and transaction boundaries.
- Use Action Context to make agents more effective first: inform low-risk work, warn on stale or inferred context, and require review only when action risk, authority, or evidence quality demands it.
- Only auto-promote a Signal to Memory when its evidence is grounded in the source; model confidence alone must never mint Memory.
- Narrow the agent-visible tool catalog per session with toolsets, never per credential; toolset selection only narrows the actor's scoped tools and never widens access.
- Route external writes through preview, policy checks, allowed-field checks, approval when required, idempotency, execution receipts, and audit.
- Preserve Lineage whenever source material becomes Signals, Memory, Handoffs, writebacks, or operator-facing recovery state.
- Keep user-facing contracts stable across REST, CLI, MCP, and Web UI surfaces.
- Split edge parsing, domain decisions, persistence, provider adapters, and presentation when one unit starts crossing too many boundaries.

## Navigation Rules

- Keep primary navigation focused on the surfaces users visit daily.
- Prefer secondary links for expert tools such as Graph, Sources, Automations, Sequences, and Webhooks.
- Keep routes compatible even when a feature moves.
- Avoid adding a new primary nav item unless it is a daily destination for members, managers, and admins.

## Language Rules

- Say **Sources**, not "connectors" or "ingestion surfaces," when talking to users.
- Say **Confirm Signal**, not "promote schema object."
- Say **Memory**, not "knowledge" or generic "context store."
- Say **Action Rules** or **Advanced Automation** when the workflow builder is not part of the daily user path.
- Use IDs in developer/API examples only when a friendly reference cannot work.

## Contribution Checklist

Before adding or moving a UI feature:

1. Identify whether it is daily workflow, lifecycle review, source setup, admin configuration, or operator recovery.
2. Put it in the smallest surface that matches that purpose.
3. Link to it from adjacent workflows instead of adding primary navigation.
4. Keep role scope clear: member, manager, admin/owner.
5. Preserve existing routes and APIs when moving UI.
6. Add docs only where a new concept appears; do not expand first-run setup with advanced details.
