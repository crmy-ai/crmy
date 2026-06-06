# CRMy v0.8.6

CRMy v0.8.6 is a follow-up 0.8.x hardening release, not the 0.9 release.

This release makes CRMy easier to prove and operate from external agent harnesses. It tightens MCP/API/CLI parity, refreshes recipes and examples, and aligns OpenClaw support with the current Raw Context -> Signals -> Memory workflow.

Before any agent acts on a customer, CRMy can tell it what is true, what is stale, what is inferred, what is approved, what system owns the record, what action is allowed, and what proof or audit trail will exist afterward.

## Release Focus

v0.8.6 focuses on tool-surface confidence and install-to-value:

- expose the actor-scoped MCP tool surface through REST and CLI;
- let users inspect exact tool input shapes with `crmy tools describe`;
- keep agent harness examples aligned with the current demo path;
- clarify when to use Raw Context ingestion instead of direct context writes;
- keep `0.8.x` documentation aligned while the broader `0.9` roadmap remains in progress.

## Highlights

### MCP/API/CLI parity

- Added REST endpoints to list, describe, and call actor-scoped MCP tools.
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

### Action Context and docs

- Updated README, guide, MCP docs, OpenAPI, and roadmap language around MCP/API/CLI parity.
- Clarified Action Context as a context-and-policy packet that informs, warns, or requires review based on risk rather than adding red tape to every action.
- Added a `0.8.6` roadmap checkpoint while preserving `0.8.5` as the prior hardening checkpoint.

## Published Packages

Published to npm:

- `@crmy/core@0.8.6`
- `@crmy/shared@0.8.6`
- `@crmy/server@0.8.6`
- `@crmy/web@0.8.6`
- `@crmy/cli@0.8.6`
- `@crmy/openclaw-plugin@0.8.6`

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

Before publish, the release gate passed:

- `npm run lint`
- `npm run build --workspace=packages/cli`
- `npm run build --workspace=packages/server`
- `npm run build --workspace=packages/web`
- `npm run build --workspace=packages/openclaw-plugin`
- `npm run test:cli-coverage`
- `npm run test:durability --workspace=packages/server`

## Notes And Caveats

- pgvector remains optional. Semantic search improves retrieval when configured, but lexical and deterministic paths continue to work without it.
- Live connector certification remains environment-dependent. HubSpot is the primary certified path today; Salesforce, Databricks, Snowflake, mailbox/calendar OAuth, and custom provider flows should be smoke-tested against real tenant credentials before production claims.
- v0.8.6 improves tool-surface confidence and documentation alignment. Full high-volume/serverless Postgres scale certification remains planned for the 1.0 resilience-at-scale line.

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
