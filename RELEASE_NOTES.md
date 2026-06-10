# CRMy v0.9.0

CRMy v0.9.0 is the agent reliability and polish release — the hardening line that brings durable workspace agent execution, richer email and inbox surfaces, and a tighter admin and object UX into a coherent whole.

Before any agent acts on a customer record, CRMy can tell it what is true, what is stale, what is inferred, what is approved, what system owns the record, what action is allowed, and what proof or audit trail will exist afterward. v0.9.0 makes that guarantee hold under real agent workloads.

## Release Focus

v0.9.0 focuses on agent execution durability and surface polish:

- harden workspace agent tool execution, side-effect handling, and record-write permissions;
- add durable replay-oriented safeguards and test coverage around agent turns and side-effecting tools;
- deepen email and inbox surfaces with draft previews, message linking, and improved provider support;
- polish admin UX for Action Policy conditions, Messaging, Systems of Record, and Context Lineage;
- clean up object list and drawer UX across Accounts, Contacts, Opportunities, and Use Cases;
- extend the CLI with friendly error surfaces and improved server startup feedback.

## Highlights

### Durable Workspace Agent Execution

- Agent engine hardened against partial tool execution, replay-unsafe side effects, and stale turn state.
- Record-write tool exposure now requires explicit write permission scopes — agents cannot write records they are not authorized to modify.
- Turn runner adds guard rails around side-effecting tool calls to prevent double-execution on retry.
- New `test/durability.test.mjs` suite with 294+ lines of durability and replay coverage.
- `tool-ux.ts` added to centralize response formatting and error surface for MCP tool calls.

### Email and Inbox Surfaces

- Email drawer rebuilt with full message thread view, context add, and draft editing.
- Draft preview and save endpoints added to REST router; `email_draft_preview` and `email_draft_save` now exposed in MCP.
- Inbox adds message linking and ignore flows; message processing improved for inbound provider events.
- `email-messages` repo extended with richer query, link, and ignore primitives.
- Provider-level email and mailbox connection list endpoints added to REST API.

### Action Policy and HITL UX

- Action Policy condition editing redesigned with clearer write-permission language and structured condition builder.
- HITL rules settings expanded with guided setup, required field validation, and full-height layout.
- Pending writeback rules now surface inline in the HITL rules view.

### Context Lineage and Governance

- Context Lineage default view simplified to source → Signal → Memory; usage and audit details available on demand.
- Context Governance view updated for cleaner contradiction and staleness flows.
- Agent Markdown renderer extended with richer structured-output support for lineage and briefing responses.

### Object List and Drawer Polish

- Accounts, Contacts, Opportunities, and Use Cases all receive consistent hover-only briefing/agent action bars.
- Opportunity and Use Case drawers improved with field editing, lifecycle controls, and briefing navigation.
- Account and Contact drawers add inline activity and timeline access.
- Briefing panel navigation between related records improved.

### Settings and Systems of Record

- Messaging settings redesigned with tab layout, full-height guided setup, and subtler semantic retrieval status.
- Systems of Record settings cleaned up; connection state and sync status now surface in the tab header.
- Agent settings page updated for model and provider configuration clarity.

### CLI and Server Startup

- Server startup now distinguishes "migrations skipped" from "migrations run" in progress output.
- CLI client adds friendly error surfaces for common failure modes via `friendlyErrors.ts`.
- `agent-smoke` command registered and fully functional for quick end-to-end validation.
- Search indexer tenant handling fixed to prevent cross-tenant index bleed.

## Published Packages

Published to npm:

- `@crmy/core@0.9.0`
- `@crmy/shared@0.9.0`
- `@crmy/server@0.9.0`
- `@crmy/web@0.9.0`
- `@crmy/cli@0.9.0`
- `@crmy/openclaw-plugin@0.9.0`

## Quick Validation

For a fresh local demo:

```bash
npx -y @crmy/cli init --yes
npx -y @crmy/cli doctor
npx -y @crmy/cli agent-smoke
npx -y @crmy/cli tools describe briefing_get
```

Then connect an agent harness and ask:

```text
Use the CRMy MCP tools to resolve the account "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.
```

Expected path:

1. CRMy resolves the account.
2. `briefing_get` returns Memory, activity, and grouped Signals.
3. Signal review items are visible.
4. The agent explains the safest next action using evidence from lineage.

## Validation Run

Before publish:

- `npm run build`
- `npm run lint`
- `npm test` — durability suite passing
- `npm run test:cli-coverage`
- `npm --workspace @crmy/server run generate:openapi`

## Notes and Caveats

- pgvector remains optional. Semantic search improves retrieval when configured, but lexical and deterministic paths continue to work without it.
- Live connector certification remains environment-dependent. HubSpot is the primary certified path; Salesforce, Databricks, Snowflake, mailbox/calendar OAuth, and custom provider flows should be smoke-tested against real tenant credentials before production claims.
- v0.9.0 improves agent execution durability and surface consistency. Full high-volume/serverless Postgres scale certification remains planned for the 1.0 resilience-at-scale line.

## Community Testing Wanted

The biggest thing CRMy needs from the community is real-world testing under agent workloads:

- agent turns that involve multiple side-effecting tool calls;
- email and inbox flows with real provider data;
- Action Policy condition editing under varied rule shapes;
- Systems of Record sync and writeback under concurrent writes;
- Handoff approval and rejection flows from external agent harnesses;
- auth, API key, and scoped-access behavior under real deployments;
- recovery from provider failures, stale jobs, and partial writes.

If you are testing CRMy against real GTM systems, please share sanitized fixtures, expected matches, missed Signals, false positives, writeback receipts, and recovery behavior. That feedback directly shapes the v1.0 resilience line.
