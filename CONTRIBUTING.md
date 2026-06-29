# Contributing to CRMy

Thanks for your interest in contributing to CRMy! This guide will help you get oriented and start making changes.

## What CRMy needs most from contributors

CRMy's differentiator is the governance and provenance layer between agents and customer systems: messy customer source material becomes Signals, source-grounded Memory, Action Context, governed Handoffs, writeback receipts, and audit/Lineage. The highest-value community contributions are the ones that prove this loop under real-world conditions.

The most useful contributions right now are:

1. **Real-world integration testing** against CRMs, warehouses, mailbox/calendar providers, support tools, and agent harnesses.
2. **Systems-of-record writeback testing** that proves previews, allowed fields, source authority, approvals, idempotency, execution receipts, and failure recovery behave correctly.
3. **Messy GTM context corpora**: anonymized calls, meeting notes, transcripts, customer emails, support escalations, product signals, and CRM updates with expected subject matches and expected Signals.
4. **Record-resolution edge cases**: subsidiaries, aliases, shared domains, duplicate contact first names, same opportunity names under different accounts, stale CRM records, and partial transcript references.
5. **Agent harness QA** for Claude Code, Claude Desktop, Codex, ChatGPT Developer Mode, Hermes, OpenClaw, and other MCP-capable environments.
6. **Operational recovery tests** for failed extraction, retryable Source processing, stuck agent turns, sync drift, writeback failures, and scoped-access denials.
7. **Eval cases and suites** for the local eval harness (`crmy eval run`): labeled extraction corpora, record-resolution edge cases, retrieval-quality and tool-choice cases, Action Context decisions, model-certification cases, and Tier-2 auto-promotion gates — so model and prompt changes are measurable, not anecdotal.

Feature ideas are welcome, but for the 0.9 line we prefer contributions that make the existing trust machinery more reliable, measurable, and boring in production.

### How to report real-world test results

When you test CRMy with a real integration or realistic fixture, please include:

- Provider/system tested, version/API mode, and whether it was sandbox or production-like.
- CRMy version and deployment shape: local, Docker, serverless Postgres, hosted Postgres, etc.
- The workflow tested: ingestion, resolution, extraction, briefing, Handoff, writeback preview, writeback execution, or recovery.
- What records were expected to match and what CRMy actually matched. Use names/domains instead of private IDs when possible.
- Any Signals/Memory expected, any false positives, any missed context, and whether evidence/Lineage was clear.
- For writeback tests: target object, allowed fields, approval behavior, idempotency behavior, receipt/result, and rollback or retry behavior.
- Sanitized logs, receipts, screenshots, or fixture snippets when safe to share.

Please do not include customer secrets, production access tokens, raw personal data, or confidential customer content in public issues. If a useful scenario requires private detail, open a minimal public issue first and note that you can provide a sanitized fixture or private reproduction path.

## Architecture overview

CRMy is a TypeScript monorepo with the following packages:

| Package | npm name | Description |
|---------|----------|-------------|
| `packages/shared` | `@crmy/shared` | TypeScript types, Zod schemas |
| `packages/server` | `@crmy/server` | Express + PostgreSQL + MCP Streamable HTTP server |
| `packages/cli` | `@crmy/cli` | Local CLI + stdio MCP server |
| `packages/web` | `@crmy/web` | React SPA served at `/app` |
| `packages/openclaw-plugin` | `@crmy/openclaw-plugin` | Plugin for OpenClaw integration |

## Engine guardrails

The engine should keep clear boundaries between source material, inferred claims, confirmed customer context, model-visible working context, governed action, and proof. When adding features or changing behavior, preserve these guardrails:

1. **Keep lifecycle states distinct.** Sources are captured source material before extraction. Signals are inferred claims with evidence and readiness. Memory is confirmed operational customer context. Active Context is temporary model-visible context assembled for an agent turn. Action Context is the preflight contract that tells the agent what is safe now, what is blocked, which policy applies, and what proof will be recorded. Handoffs, writebacks, receipts, and audit events record governed action.
2. **Validate at every external boundary.** REST payloads, MCP tool input, webhooks, provider responses, CRM/warehouse sync data, email/calendar data, file extraction output, and LLM output enter as runtime data. Parse and validate them at the edge before passing domain-shaped values deeper into the engine.
3. **Scope every operation.** Reads and writes must remain tenant-scoped and actor-scoped. UI visibility is not enough; REST handlers, MCP tools, services, repositories, background workers, and workflow actions must preserve `tenant_id`, actor role, owner visibility, and tool scopes.
4. **Keep API and tool contracts stable.** REST, CLI, MCP, and web UI surfaces can share behavior, but each boundary should expose explicit input/output contracts. Do not leak provider quirks, SQL rows, private IDs, or internal retry state into user-facing contracts unless the contract is specifically for operators.
5. **Put durability in Postgres.** TypeScript should model intent, but migrations and queries must enforce idempotency, uniqueness, current/stale state, row versions, replay safety, and transactional invariants.
6. **Keep provider details in adapters.** LLM providers, embedding providers, email providers, calendar providers, CRMs, warehouses, and OpenAI-compatible gateways should normalize into CRMy shapes before the core engine consumes them.
7. **Govern external writes.** System-of-record changes need preview, allowed-field checks, source-authority checks, approval when required, idempotency, execution receipts, and audit events. Workflow or agent convenience should not bypass this path.
8. **Preserve Lineage.** If a feature creates, changes, dismisses, supersedes, or writes customer context, keep enough source references, evidence, receipt data, and audit metadata for an operator to reconstruct what happened.
9. **Do not weaken Memory gates.** Automatic Memory requires grounding, trust-tier policy, readiness, and model certification. Unknown or uncertified models should degrade to review-only. Tier-2/high-impact claims must either go to human review or meet the corroborated policy: independent recent grounded sources and no readiness blockers.
10. **Avoid boundary collapse.** A function that validates loose input, checks auth, runs SQL, calls a provider, mutates external systems, and formats UI output is doing too much. Split edge parsing, domain decisions, persistence, provider adapters, and presentation into separate units.
11. **Use honest product language.** CRMy should be described as provenance-checked, decay-aware governance for customer context. Avoid user-facing claims that imply permanent truth, magic knowledge-graph reasoning, or sales performance improvements that are not backed by an outcome-learning loop.

### MCP tools

MCP tool definitions live in `packages/server/src/mcp/tools/`. Each tool file exports an array of `ToolDef` objects with the following shape:

- **`name`** — unique tool identifier
- **`description`** — human-readable description shown to the model (aim for 2–4 sentences covering: what the tool does, when to use it, what it returns)
- **`tier`** — `'core'` for standard tools; controls governor enforcement
- **`inputSchema`** — a Zod schema for input validation
- **`handler`** — receives parsed input + `ActorContext` and returns a result object

Tool files include focused domains such as `context-entries.ts`, `context-source-drops.ts`, `action-context.ts`, `guide.ts`, `knowledge.ts`, `record-drafts.ts`, `systems-of-record.ts`, `subject-graph.ts`, `actors.ts`, `activities.ts`, `assignments.ts`, `hitl.ts`, `contacts.ts`, `accounts.ts`, `opportunities.ts`, `analytics.ts`, `use-cases.ts`, `registries.ts`, `workflows.ts`, `webhooks.ts`, `email.ts`, `email-sequences.ts`, `calendar.ts`, `custom-fields.ts`, and `meta.ts`.

Tool ordering in the manifest (defined in `packages/server/src/mcp/server.ts`) matters — tools listed first are more likely to be selected by the LLM. Briefing, Action Context, guide, and context tools come first. Keep tool descriptions model-facing and test any new tool with `crmy tools describe <tool_name>`.

CRMy also has session toolsets/core profiles. Toolsets reduce the tool catalog for a job; they must never widen actor scope or bypass the governor. When adding tools, update the relevant toolset metadata and guide copy so agents can discover the right path without seeing the entire catalog.

### SQL migrations

Migrations live in `packages/server/migrations/` and are numbered sequentially. There is no ORM — all queries use the `pg` Pool directly with raw SQL.

Migration 022 (`022_pgvector.sql`) is conditional — only runs when `ENABLE_PGVECTOR=true`.

Key migrations to be aware of when developing:

| Range | Area |
|---|---|
| 001–020 | Core schema (contacts, accounts, opportunities, activities, actors, assignments, context) |
| 021–030 | Context and Memory v2 (pgvector, extraction pipeline, types registry, auto-extract flag) |
| 031–039 | Automation engine (workflows, sequences, HITL, email sequences) |
| 040–049 | Automation performance, idempotency, recovery, auth lifecycle, and Systems of Record |
| 050–059 | Signal groups, scoped actors, pgvector/Lineage, durable agent turns, and Customer Email |
| 060–068 | Email drafts, calendar meetings, source filters, Source recovery, scale indexes, extraction attempts, and replay payloads |
| 069–079 | Agent provider resilience, trust/source-quality settings, tenant guards, rate limits, and MCP session catalog |
| 080–089 | Email delivery, OAuth apps, account domains, context source drops, webhooks, product Knowledge, and source connections |
| 090–094 | Memory trust integrity, model certification, freshness indexes, Tier-2 auto-promotion policy, and type-level trust settings |

### Web UI pages

Pages live in `packages/web/src/pages/`. CRM drawer components live in `packages/web/src/components/crm/`. The app uses React Router, TanStack Query for data fetching, Zustand for state, and Tailwind CSS + Framer Motion for styling/animation.

### CLI commands

All commands live in `packages/cli/src/commands/` and are registered in `packages/cli/src/index.ts`. The CLI uses Commander.js for command parsing and Inquirer.js for interactive prompts.

## Requirements

- **Node.js >= 20.0.0** (enforced at runtime — the CLI will refuse to start on older versions)
- **PostgreSQL >= 14** (16 recommended; pgvector/pgvector:pg16 for semantic search)
- **npm >= 9**

## Local development setup

### Recommended: use `crmy init`

```bash
git clone https://github.com/crmy-ai/crmy.git
cd crmy
npm install
npm run build

# Start just the database if you don't have local Postgres
docker compose -f docker/docker-compose.yml up db -d

# Run the setup wizard — handles DB creation, migrations, admin account, demo data
npx -y @crmy/cli init --demo

# Start the dev server
npx -y @crmy/cli server
```

### Alternative: manual setup

```bash
git clone https://github.com/crmy-ai/crmy.git
cd crmy
npm install
npm run build

# Start PostgreSQL via Docker
docker compose -f docker/docker-compose.yml up db -d

# Create the database (if it doesn't exist)
createdb -h localhost -U crmy crmy 2>/dev/null || true

# Run migrations
DATABASE_URL=postgresql://crmy:crmy@localhost:5432/crmy npx tsx scripts/migrate.ts

# Seed demo data
DATABASE_URL=postgresql://crmy:crmy@localhost:5432/crmy npx tsx scripts/seed-demo.ts

# Copy .env.example and configure
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET

# Start BOTH the API server and the web UI dev server
npm run dev
```

### How `npm run dev` works

`npm run dev` starts two processes in parallel:

| Process | Port | What it does |
|---------|------|-------------|
| API server (`dev:server`) | `:3000` | Express + MCP endpoint via `tsx watch` (hot reload on file changes) |
| Vite dev server (`dev:web`) | `:5173` | React app with hot module replacement, proxies `/api/*` and `/auth/*` to `:3000` |

The API server auto-loads `.env` from the repo root (or `packages/server/.env`). You can also pass env vars inline:
```bash
DATABASE_URL=postgresql://crmy:crmy@localhost:5432/crmy JWT_SECRET=dev-secret npm run dev
```

During development, open **http://localhost:5173/app** for the web UI (not `:3000/app`). Vite provides instant hot reload for frontend changes.

You can also run them individually:
```bash
npm run dev:server   # API only (port 3000)
npm run dev:web      # Web UI only (port 5173, needs API server running)
```

### Verify your setup

```bash
npx -y @crmy/cli doctor       # actionable diagnostic checks
npx -y @crmy/cli quickstart   # seeded end-to-end agent proof
npm run build                 # verify TypeScript compiles cleanly
npm run lint                  # strict type checks without emitting files
npm test                      # core Node test suite
```

If you choose a custom or local model, automatic Memory remains review-only until the model is certified. Run:

```bash
npx -y @crmy/cli certify --output ./eval-runs
```

This executes the live model certification suite and only turns on automatic Memory if the gate passes. Pre-certified recommended models restore their recorded certification during guided setup when the exact provider/base URL/model identity matches.

### Connect Claude Code to local dev server

```bash
claude mcp add crmy -- npx -y @crmy/cli mcp
```

## Key commands for development

| Command | What it does |
|---------|-------------|
| `npm run build` | Build all packages (shared → server → cli → web → plugin) |
| `npm run dev` | Start API server + web UI with hot reload (requires `DATABASE_URL` + `JWT_SECRET`) |
| `npm run dev:server` | Start API server only (port 3000) |
| `npm run dev:web` | Start Vite web UI only (port 5173, proxies to :3000) |
| `npm test` | Run the core Node test suite |
| `npm run test:cli-coverage` | Check CLI surface coverage metadata |
| `npm run lint` | TypeScript type checking (`tsc --noEmit`) |
| `npx -y @crmy/cli doctor` | Diagnose setup issues with guided next steps |
| `npx -y @crmy/cli quickstart` | Prove seeded demo data and the core agent path |
| `npx -y @crmy/cli seed-demo` | Seed demo data (idempotent) |
| `npx -y @crmy/cli seed-demo --reset` | Drop and re-seed demo data |
| `npx -y @crmy/cli migrate status` | Show applied vs pending migrations |
| `npx -y @crmy/cli models list` | Show provider/model catalog entries |
| `npx -y @crmy/cli certify --output ./eval-runs` | Certify the configured live model for automatic Memory |
| `npx -y @crmy/cli eval run --profile seeded_context` | Run the deterministic seeded eval gate |

## Spec-driven development model

CRMy is built iteratively via versioned spec files passed to Claude Code (Opus). If you want to contribute a significant feature, please open a **Discussion** with a design proposal first so we can align on the approach before you invest time writing code.

## Good first contributions

1. **Add or improve an MCP tool description** (`packages/server/src/mcp/tools/`)
2. **Add a realistic fixture** to the Source extraction or record-resolution corpus
3. **Report a `briefing_get` bug** with a specific customer scenario and expected context
4. **Add a `crmy doctor` check** for something that catches new contributors off guard
5. **Improve CLI or MCP error messages** for setup, auth, extraction, certification, review-only mode, or scoped-access failures
6. **Add a connector/writeback smoke test** for HubSpot, Salesforce, a warehouse, or a custom API/MCP integration
7. **Add or improve a recipe** in `docs/recipes/` or an agent harness example in `examples/`
8. **Add a `context_type`, activity type, or meeting classification** to the registry seed data when it reflects methodology-neutral GTM Memory
9. **Add a test** for a service or repo function in `packages/server/src/`

## Integration and writeback test contributions

Please prioritize integration tests that answer these questions:

- Can CRMy read from the source without storing internal/spam/noise that should be filtered?
- Does Subject Graph resolution choose the right account and only attach child contacts, opportunities, and use cases when the account scope supports it?
- Does Source extraction create useful Signals without false-positive Memory promotion?
- Does `briefing_get` give an agent enough context to act safely?
- Does Handoff review include the evidence, proposed action, policy reason, and linked customer record?
- Does writeback preview block fields that are not explicitly writable?
- Does approval execute exactly once, with an audit receipt and idempotency protection?
- Does failure produce a recoverable state instead of a silent partial write?

Useful targets include:

- HubSpot and Salesforce sync/writeback with real custom fields and stale CRM records.
- Databricks, Snowflake, Supabase, Neon, Lakebase, or another Postgres-backed warehouse-like source.
- Gmail/Outlook customer email association and filtering.
- Google/Microsoft calendar meeting capture and transcript/debrief matching.
- Custom API/MCP integrations that simulate proprietary GTM systems.
- Agent harnesses that call `customer_record_resolve -> briefing_get -> context_signal_group_list -> Handoff/writeback`.

## Code conventions

- **Apache 2.0 SPDX headers on every file:**
  ```ts
  // Copyright 2026 CRMy Contributors
  // SPDX-License-Identifier: Apache-2.0
  ```
- **Raw SQL (no ORM)** — all queries use `pg` Pool directly
- **TypeScript strict mode**
- **Zod** for all input validation
- **Consistent tool definition pattern** in MCP tools (see the `ToolDef` shape above)
- **Stable UUIDs for demo data** — pattern `d0000000-0000-4000-XXXX-NNNNNNNNNNNN` where the 4th group encodes entity type (`a`=actors, `b`=accounts, `c`=contacts, `d`=opportunities)
- **Idempotent seeds** — always use `INSERT ... ON CONFLICT (id) DO NOTHING`

## Project structure

```
crmy/
├── packages/
│   ├── shared/          TypeScript types + Zod schemas
│   ├── server/
│   │   ├── src/
│   │   │   ├── mcp/tools/     MCP tool definitions grouped by domain
│   │   │   ├── rest/          REST API router (all endpoints)
│   │   │   ├── db/            Pool, migrations, repositories
│   │   │   │   └── repos/     One repo per entity (context-entries, activities, etc.)
│   │   │   ├── auth/          JWT + API key auth
│   │   │   ├── agent/         AI extraction pipeline (extraction.ts, providers/llm.ts)
│   │   │   ├── services/      Briefing, Action Context, Memory trust, Knowledge, HITL, evals
│   │   │   ├── workflows/     Event-driven automation engine
│   │   │   ├── lib/           Shared utilities (file-extract, workflow-templates, etc.)
│   │   │   └── index.ts       Server entry point + createApp()
│   │   └── migrations/        Numbered SQL migration files
│   ├── cli/
│   │   └── src/commands/      CLI commands (init, server, doctor, certify, eval, etc.)
│   └── web/
│       └── src/
│           ├── pages/         App page components
│           ├── components/crm/ Shared CRM, context, Knowledge, and governance UI
│           └── api/hooks.ts   TanStack Query hooks
├── docker/                    Dockerfile + docker-compose.yml
├── docs/recipes/              Agent workflow recipes
├── scripts/                   Seed + migration scripts
├── railway.toml               Railway deploy template
├── render.yaml                Render.com deploy blueprint
├── .env.example               Environment variable reference
└── CONTRIBUTING.md            This file
```

---
*Licensed under Apache 2.0. Copyright 2026 CRMy.ai*
