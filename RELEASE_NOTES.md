# CRMy v0.8.5

CRMy v0.8.5 is the most important hardening checkpoint on the path to 0.9.

This release tightens the core context-and-action loop without expanding the product surface: messy Raw Context becomes evidence-backed Signals, trusted Memory, scoped briefings, governed Handoffs/writeback, and auditable proof.

Before any agent acts on a customer, CRMy can tell it what is true, what is stale, what is inferred, what is approved, what system owns the record, what action is allowed, and what proof or audit trail will exist afterward.

## Release Focus

v0.8.5 focuses on reliability, resolution, and install-to-value:

- make Raw Context processing more durable, replayable, and recoverable;
- make customer-record resolution safer in ambiguous GTM scenarios;
- prove the agent-facing MCP path quickly through CLI smoke tests;
- simplify the product surface around the core Context engine;
- prepare the project for deeper v0.9 real-world integration testing.

## Highlights

### Raw Context reliability

- Added durable receipt semantics for Raw Context processing.
- Preserved replayable source payloads for recovery and debugging.
- Added retry metadata, stale-processing recovery, and data-quality repair paths.
- Improved malformed JSON recovery for extraction responses.
- Standardized app, REST, MCP, CLI, file, email, activity, and reprocess flows around the same Raw Context behavior.

### Safer record resolution

- Standardized the account-first Subject Graph resolver across Raw Context, reprocess, file ingestion, Customer Email, Customer Activity, MCP, CLI, and agent guidance.
- Improved account-scoped matching for contacts, opportunities, and use cases.
- Added ambiguity safety for duplicate names, partial transcript references, and uncertain child-record matches.
- Kept uncertain child records reviewable instead of over-linking them.

### Signal and Memory trust

- Added golden extraction and record-resolution coverage for messy GTM scenarios.
- Prevented duplicate ingestion of the same source from artificially corroborating a Signal.
- Kept incomplete, unresolved, or policy-sensitive Signals reviewable instead of promoting them too early.
- Preserved the Signal -> Memory boundary as the trust boundary agents rely on.

### MCP and CLI confidence

- Added and verified the one-minute agent smoke path:
  `customer_record_resolve -> briefing_get -> context_signal_group_list`.
- Improved `crmy doctor` so stale or mismatched `CRMY_API_KEY` values are caught before agent harness setup fails.
- Refreshed agent harness examples and MCP guidance.
- Regenerated OpenAPI docs.

### Product surface cleanup

- Reframed Context around Raw Context, Signals, Memory, Lineage, and Context Sources.
- Moved Customer Email and Customer Activity into the supporting Context Sources mental model.
- Demoted Automations and Sequences into admin/settings surfaces while keeping compatible routes.
- Added a deeper Context Engine doc and stronger contribution guidance around real-world integration testing.

### Web performance and UX

- Lazy-loaded major routes, drawers, and editors.
- Reduced the initial web bundle below Vite's warning threshold.
- Fixed lingering Signal action wording: users now see `Confirm Signal` and `Dismiss Signal`.

## Published Packages

Published to npm:

- `@crmy/core@0.8.5`
- `@crmy/shared@0.8.5`
- `@crmy/server@0.8.5`
- `@crmy/web@0.8.5`
- `@crmy/cli@0.8.5`
- `@crmy/openclaw-plugin@0.8.5`

## Quick Validation

For a fresh local demo:

```bash
npx -y @crmy/cli init --yes
npx -y @crmy/cli doctor
npx -y @crmy/cli agent-smoke
```

Then connect an agent harness and ask:

```text
Use the CRMy MCP tools to resolve the account "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.
```

Expected path:

1. CRMy resolves the account.
2. `briefing_get` returns Memory, activity, and grouped Signals.
3. Signal review items are visible.
4. The agent can explain the safest next action using evidence.

## Validation Run

Before publish, the release gate passed:

- `npm run lint`
- `npm run build --workspace=packages/web`
- `npm run build --workspace=packages/server`
- `npm run build --workspace=packages/cli`
- `npm test`
- `npm run test:cli-coverage`
- `crmy agent-smoke`
- npm pack dry-runs for all published packages
- npm registry verification for all published packages

## Notes And Caveats

- pgvector remains optional. Semantic search improves retrieval when configured, but lexical and deterministic paths continue to work without it.
- Live connector certification remains environment-dependent. HubSpot is the primary certified path today; Salesforce, Databricks, Snowflake, mailbox/calendar OAuth, and custom provider flows should be smoke-tested against real tenant credentials before production claims.
- If `crmy doctor` reports that `CRMY_API_KEY` does not match the database, regenerate setup with `crmy init`, update the key, or remove the stale local key so direct local MCP mode can resolve the local actor.
- v0.8.5 verifies correctness, drift, packaging, and local install-to-value. Full high-volume/serverless Postgres scale certification is planned for the 1.0 resilience-at-scale line.

## Community Testing Wanted

The biggest thing CRMy needs from the community is real-world testing of the engine:

- messy customer transcripts and emails;
- account and opportunity ambiguity;
- Systems of Record sync and writeback;
- custom API/MCP integrations;
- Handoff approval and rejection flows;
- agent harness behavior outside the web UI;
- recovery from provider failures, stale jobs, and partial writes.

If you are testing CRMy against real GTM systems, please share sanitized fixtures, expected matches, missed Signals, false positives, writeback receipts, and recovery behavior. That feedback directly shapes the v0.9 hardening line.
