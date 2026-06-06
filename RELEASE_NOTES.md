# CRMy v0.8.7

CRMy v0.8.7 is a same-day launch-hardening patch for v0.8.6, not the 0.9 release.

This release keeps the v0.8.6 MCP/API/CLI and recipe improvements, then adds a major security and reliability hardening pass for auth, API keys, HITL policy routes, inbound email webhooks, migrations, and governed writeback execution.

Before any agent acts on a customer, CRMy can tell it what is true, what is stale, what is inferred, what is approved, what system owns the record, what action is allowed, and what proof or audit trail will exist afterward.

## Release Focus

v0.8.7 focuses on launch readiness:

- strengthen auth and scope enforcement before broader traffic;
- lock down API key management and scope grants;
- require explicit tenant identity and HMAC signatures for inbound email ingestion;
- prevent pending writebacks from executing before approval;
- make HITL/writeback review state changes transactional;
- keep MCP, REST, CLI, recipes, and examples aligned for external agent harnesses.

## Highlights

### Auth and scope hardening

- JWT users now resolve against current database user and actor state.
- Deactivated users and actors are rejected instead of remaining usable through stale tokens.
- Missing scopes no longer imply broad/full access.
- Admin-only scopes now cover API keys, HITL policies, inbound email config, and systems administration.
- API key management is restricted to owner/admin actors with `api_keys:admin`.
- Requested API key scopes must be known and cannot exceed the grantor's own authority.

### HITL, inbound email, and writeback safety

- `/hitl/rules` now routes before `/hitl/:id`, avoiding accidental route capture.
- HITL approval rules require owner/admin access plus `hitl:admin`.
- Inbound webhook secret configuration requires owner/admin access plus `email_provider:admin`.
- Inbound email ingestion now requires explicit tenant identity plus a valid HMAC signature.
- Pending writebacks can no longer execute before approval.
- HITL/writeback review state updates are now transactional.

### Migration reliability

- Migrations now use a connection-scoped PostgreSQL advisory lock.
- This reduces the risk of concurrent migration runners stepping on each other in local, CI, or deploy environments.

### MCP/API/CLI parity

- Added actor-scoped REST endpoints to list, describe, and call MCP tools.
- Added `crmy tools list`, `crmy tools describe <tool_name>`, and `crmy tools call <tool_name>`.
- Kept friendly CLI commands for common workflows while making the full visible MCP tool surface reachable from the CLI.
- Added coverage so CLI HTTP mode continues to map direct tool calls and falls back to the generic actor-scoped tool bridge safely.

### Recipes and examples

- Added a recipes index explaining recipes vs deterministic examples.
- Clarified seeded demo records around Northstar Labs.
- Updated runnable recipe CLI commands to use friendly record references instead of requiring UUIDs.
- Added `agent-smoke` and `tools describe` checks to Claude Code, Claude Desktop, Codex, ChatGPT Developer Mode, Hermes, and OpenClaw examples.
- Reworked the renewal-risk recipe to use Raw Context ingestion, Signal review, promotion, or Handoff instead of direct model-derived Memory writes.

### OpenClaw support

- Added `context.ingest_auto` to the OpenClaw plugin action surface.
- Updated the OpenClaw skill to use accounts terminology and Raw Context ingestion for messy notes, transcripts, emails, and research.
- Reframed `context.add` as an advanced direct write path for already-reviewed Memory or evidence-backed Signals.

### Docs and generated API reference

- Updated README, guide, generated OpenAPI, MCP docs, roadmap, examples, and release notes to describe the current auth, webhook, tool, and Action Context model.
- Clarified Action Context as a context-and-policy packet that informs, warns, or requires review based on risk rather than adding red tape to every action.
- Updated self-registration guidance so local setup and auth docs match the current actor/API-key model.

## Published Packages

Published to npm:

- `@crmy/core@0.8.7`
- `@crmy/shared@0.8.7`
- `@crmy/server@0.8.7`
- `@crmy/web@0.8.7`
- `@crmy/cli@0.8.7`
- `@crmy/openclaw-plugin@0.8.7`

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
4. The agent can explain the safest next action using evidence.

## Validation Run

Before publish, the hardening gate passed:

- `npm run build`
- `npm run lint`
- `npm test` - 109 passing
- `npm run test:cli-coverage` - 8 passing
- `npm --workspace @crmy/server run generate:openapi`

## Notes And Caveats

- pgvector remains optional. Semantic search improves retrieval when configured, but lexical and deterministic paths continue to work without it.
- Live connector certification remains environment-dependent. HubSpot is the primary certified path today; Salesforce, Databricks, Snowflake, mailbox/calendar OAuth, and custom provider flows should be smoke-tested against real tenant credentials before production claims.
- v0.8.7 improves tool-surface confidence, documentation alignment, and launch security posture. Full high-volume/serverless Postgres scale certification remains planned for the 1.0 resilience-at-scale line.

## Community Testing Wanted

The biggest thing CRMy needs from the community is real-world testing of the engine:

- messy customer transcripts and emails;
- account and opportunity ambiguity;
- Systems of Record sync and writeback;
- custom API/MCP integrations;
- Handoff approval and rejection flows;
- agent harness behavior outside the web UI;
- auth, API key, webhook, and scoped-access behavior under real deployments;
- recovery from provider failures, stale jobs, and partial writes.

If you are testing CRMy against real GTM systems, please share sanitized fixtures, expected matches, missed Signals, false positives, writeback receipts, auth/scope surprises, and recovery behavior. That feedback directly shapes the v0.9 hardening line.
