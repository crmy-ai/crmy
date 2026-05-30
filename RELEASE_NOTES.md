# CRMy v0.8.3

CRMy v0.8.3 tightens the product around its core promise: operational customer context for AI agents.

This release improves first-run clarity, scoped GTM workflows, Raw Context extraction, Signal review, Memory readiness, Handoffs, Workspace Agent behavior, Customer Email, Customer Activity, Systems of Record setup, and agent harness documentation.

## Highlights

- Refreshed README and guide language around Raw Context, Signals, Memory, Active Context, Handoffs, and governed writeback.
- Added agent harness examples for Claude Code, Claude Desktop, Codex, ChatGPT Developer Mode, Hermes Agent, and OpenClaw.
- Improved scoped role behavior for admins, managers, and reps.
- Hardened Raw Context ingestion, subject association, Signal readiness, and source-to-Memory lineage.
- Expanded Customer Email and Customer Activity as optional context feeds.
- Improved Workspace Agent readiness, scoped tool use, durable sessions, attachments, record drafting, and email drafting flows.
- Simplified Command Center, Handoffs, Context, Signals, Memory, login, and record drawer UX.
- Updated Systems of Record setup to better explain what CRMy reads, writes, and governs.
- Added CLI/MCP coverage checks and an agent smoke path for proving install-to-value quickly.

## Why It Matters

Before any agent acts on a customer, CRMy can tell it what is true, what is stale, what is inferred, what is approved, what system owns the record, what action is allowed, and what proof or audit trail will exist afterward.

v0.8.3 is primarily a hardening and clarity release: fewer rough edges, clearer mental models, stronger agent boundaries, and better docs for developers building GTM agents on CRMy.

## Quick Validation

```bash
npx -y @crmy/cli init --yes
npx -y @crmy/cli agent-smoke
```

Then connect an agent harness and ask:

```text
Use the CRMy MCP tools to resolve the account "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.
```

## Notes

Live connector certification remains environment-dependent. HubSpot is the primary certified path; Salesforce, Databricks, Snowflake, mailbox/calendar OAuth, and custom provider flows should be smoke-tested against real tenant credentials before a production claim.
