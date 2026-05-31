# CRMy v0.8.5

CRMy v0.8.5 is the most important hardening checkpoint on the path to 0.9: the release where the Raw Context, record-resolution, MCP/CLI, and app surfaces become much more dependable without expanding the product surface.

## Highlights

- Hardened Raw Context around durable receipts, replayable payloads, retry metadata, stale-processing recovery, and consistent UI/REST/MCP/CLI semantics.
- Added golden extraction and record-resolution coverage for messy GTM cases, including account-scoped children, duplicate names, ambiguous references, malformed JSON, and no-context inputs.
- Prevented duplicate ingests from artificially corroborating a Signal or promoting Memory.
- Standardized the Subject Graph resolver across Raw Context, reprocess, file ingestion, customer email, customer activity, MCP, CLI, and agent guidance.
- Cleaned the product surface: Context now focuses on Raw Context, Signals, Memory, Lineage, and Context Sources; Email and Activity are supporting sources; Automations live under Settings.
- Improved MCP/CLI setup confidence with `agent-smoke`, a stronger `doctor`, current examples, and an OpenAPI refresh.
- Reduced the web app’s initial JavaScript bundle by lazy-loading major routes, drawers, and editors.
- Fixed lingering UX drift around Signal actions so users see `Confirm Signal` and `Dismiss Signal` instead of older Memory-centric labels.

## Why It Matters

Before any agent acts on a customer, CRMy can tell it what is true, what is stale, what is inferred, what is approved, what system owns the record, what action is allowed, and what proof or audit trail will exist afterward.

v0.8.5 makes that promise more credible by tightening the core loop: messy customer context becomes reviewable Signals, trusted Memory, scoped briefings, governed handoffs/writeback, and auditable proof.

## Quick Validation

```bash
npx -y @crmy/cli init --yes
npx -y @crmy/cli doctor
npx -y @crmy/cli agent-smoke
```

Then connect an agent harness and ask:

```text
Use the CRMy MCP tools to resolve the account "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.
```

## Notes

Live connector certification remains environment-dependent. HubSpot is the primary certified path; Salesforce, Databricks, Snowflake, mailbox/calendar OAuth, and custom provider flows should be smoke-tested against real tenant credentials before a production claim.

If `crmy doctor` reports that `CRMY_API_KEY` does not match the database, regenerate setup with `crmy init` or update the key before using MCP from an agent harness.
