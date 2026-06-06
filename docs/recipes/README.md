# CRMy Agent Recipes

Recipes are workflow patterns for agents that use CRMy as the customer context and action engine. They are broader than the copy-paste examples in `examples/`.

Use `examples/` when you want a deterministic one-minute harness check against seeded demo data. Use these recipes when you want to design a production agent workflow.

## Recipe Conventions

- Start by resolving records by name with `customer_record_resolve`. Do not require users to know UUIDs.
- Use `briefing_get` before analysis or action so confirmed Memory and relevant Signals are loaded into Active Context.
- Use `context_ingest_auto` for messy source material: transcripts, notes, emails, research packets, support updates, and meeting debriefs.
- Treat Signals as inferred until they are confirmed, dismissed, or routed to Handoff.
- Use `action_context_get` before meaningful customer-facing action, forecast/action changes, or external writeback planning.
- Use `context_add` only for advanced direct writes when the claim is already reviewed, typed, evidence-backed, and appropriate for the actor's scope.
- Use idempotency keys for scheduled or retryable writes.
- Prefer CLI subject references such as `account:Northstar Labs` or `opportunity:Northstar Agent Context Rollout`; the CLI resolves these to IDs when needed.
- Use `crmy tools describe <tool_name>` when you need the exact input shape for a tool.

## Seeded Demo vs Illustrative Data

The current seeded demo centers on:

- `account:Northstar Labs`
- `contact:Maya Patel`
- `opportunity:Northstar Agent Context Rollout`
- `use_case:Agent Briefing Memory`

Some recipes include illustrative customer names or response excerpts to explain a workflow. Treat those as examples of shape and behavior, not guaranteed seeded records. Replace them with records from your workspace or run the harness examples for a deterministic path.

## Recipes

- [GTM agent demo](gtm-agent-demo.md)
- [Post-meeting agent](post-meeting-agent.md)
- [Public signal research agent](public-signal-research-agent.md)
- [Outreach agent](outreach-agent.md)
- [Renewal risk agent](renewal-risk-agent.md)
- [Pipeline review agent](pipeline-review-agent.md)
- [Context governance agent](context-governance-agent.md)
