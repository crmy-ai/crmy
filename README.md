# CRMy

The context backend for sales agents. Deploy CRMy alongside your AI agent to give it typed, versioned memory about every contact, account, and deal — and a single `briefing_get` call that assembles everything it needs before each action.

MCP-native. PostgreSQL-backed. Open source.

---

## The problem

Your agent takes an action — sends an email, advances a deal, books a follow-up call. Before it acts, it needs to know:

- Who is this contact? What's their lifecycle stage?
- What happened last week? Last quarter?
- What did prior agent turns learn about this account?
- Are there open assignments on this contact right now?
- What context is stale and might be wrong?

Assembling that from raw queries is 5–10 API calls, schema knowledge, and brittle glue code. CRMy's `briefing_get` returns it in one shot — via MCP, CLI, or REST.

---

## Quickstart

Choose your deploy path:

### Path A — Try it in 60 seconds (Railway)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/crmy)

One click. No local setup. Demo data loads automatically.

### Path B — Docker (local, recommended for dev)

```bash
# Clone and start PostgreSQL + server together
git clone https://github.com/crmy-ai/crmy.git && cd crmy

# Set your JWT secret (required)
export JWT_SECRET=$(openssl rand -hex 32)

# Optional: auto-create admin and seed demo data
export CRMY_ADMIN_EMAIL=you@example.com
export CRMY_ADMIN_PASSWORD=your-secure-password-here

CRMY_SEED_DEMO=true docker compose -f docker/docker-compose.yml up -d
```

### Path C — npm (bring your own Postgres)

```bash
npx @crmy/cli init          # connect to PostgreSQL, run migrations, create admin
npx @crmy/cli server        # starts on :3000
```

The `init` wizard will:
1. Connect to your PostgreSQL (retries up to 5 times)
2. Create the database if it doesn't exist (local installs)
3. Run all migrations
4. Optionally enable semantic search (pgvector)
5. Create your admin account
6. Seed demo data

Use `crmy init --yes` for fully non-interactive setup (requires `CRMY_ADMIN_EMAIL` + `CRMY_ADMIN_PASSWORD` env vars).

### Verify your setup

```bash
crmy doctor                  # 8-point diagnostic check
```

`crmy doctor` verifies: Node.js version, config file, PostgreSQL connectivity, migration status, admin user, pgvector availability, port availability, and JWT secret strength.

### Try it

With demo data loaded, try these to see CRMy in action:

```bash
crmy briefing contact:d0000000-0000-4000-c000-000000000001   # Sarah Chen at Acme Corp
crmy briefing account:d0000000-0000-4000-b000-000000000001   # Acme Corp — full account context
crmy assignments list --mine                                   # Open assignments queue
```

### Connect via MCP

Add CRMy as an MCP server so any agent or IDE can call it directly:

#### Claude Code

```bash
claude mcp add crmy -- npx @crmy/cli mcp
```

#### Claude Desktop

```json
{
  "mcpServers": {
    "crmy": {
      "command": "npx",
      "args": ["@crmy/cli", "mcp"]
    }
  }
}
```

#### Cursor / Windsurf

Add to `.cursor/mcp.json` or equivalent:

```json
{
  "mcpServers": {
    "crmy": {
      "command": "npx",
      "args": ["@crmy/cli", "mcp"]
    }
  }
}
```

Once connected, your agent has access to 175+ MCP tools. No API calls, no auth wiring — just tool calls.

---

## Get a briefing before every action

Via MCP (natural language):

> Get me a full briefing on contact `<id>` before I reach out.

Via CLI:

```bash
crmy briefing contact:<id>
```

Response:

```json
{
  "record": { "first_name": "Sarah", "lifecycle_stage": "prospect", ... },
  "related": { "account": { "name": "Acme Corp", "health_score": 72, ... } },
  "activities": [ ... ],
  "open_assignments": [ ... ],
  "context": {
    "objection": [{ "body": "Concerned about procurement timeline", "confidence": 0.9, ... }],
    "competitive_intel": [ ... ]
  },
  "stale_warnings": [{ "context_type": "research", "valid_until": "2026-01-15", ... }]
}
```

Works on contacts, accounts, opportunities, and use cases.

---

## Agent workflow example

```
1. agent: "Get me a full briefing on contact abc."
   ← record + recent activities + open assignments + typed context + stale warnings

2. agent: "Log a discovery call with abc — champion identified, pricing concern raised."
   → activity logged; extraction pipeline creates context entries automatically

3. agent: "Add an objection for abc: budget approval needed from CFO. Confidence 0.9."
   → stored, tagged, searchable; visible in future briefings

4. agent: "Create an assignment for rep Sarah to send the proposal."
   → appears in the rep's assignment queue

5. human: "Get me a briefing on contact abc."
   ← same context the agent built, plus the open assignment

6. human: "Mark assignment 123 complete — proposal sent."
   → logged to audit trail; context entry written
```

---

## Context Engine

Four primitives that form the agent's shared workspace:

| Primitive | What it does |
|-----------|-------------|
| **Actors** | First-class identity for humans and AI agents. Every action is attributed to an actor. Agents self-register — no admin setup. Query `actor_expertise` to route reviews to the person who knows most about an account. |
| **Activities** | Everything that happened — calls, emails, meetings. Structured `detail` payloads, polymorphic subjects, retroactive `occurred_at` timestamps, and auto-extraction into context entries. Bulk-ingest raw documents with `context_ingest`. |
| **Assignments** | Structured handoffs. Agents create assignments for humans; humans create assignments for agents. Stateful lifecycle: `pending → accepted → in_progress → completed`. Stale context entries automatically generate review assignments. |
| **Context Entries** | The memory layer. Typed, tagged, versioned knowledge attached to any CRM object. Priority weights and confidence half-life decay ensure the most important, fresh context surfaces first. `context_radius` expands briefings to adjacent entities. Token-budget-aware packing fits context into any LLM context window. |

### Semantic search (optional, v0.6+)

Enable pgvector for natural-language search across all context entries:

```bash
# During crmy init — the wizard asks "Enable semantic search?"
# Or manually:
ENABLE_PGVECTOR=true crmy migrate run
```

Requires PostgreSQL with pgvector (Supabase, Neon, RDS with pgvector, or `pgvector/pgvector:pg16` Docker image). Configure an embedding provider (OpenAI, or any OpenAI-compatible API):

```env
EMBEDDING_PROVIDER=openai
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
```

Then backfill existing entries:

```bash
# Via MCP
context_embed_backfill

# Search semantically
context_semantic_search query="deals at risk due to competitor pressure"
```

---

## MCP Tools (175+)

| Category | Tools |
|---|---|
| **Briefing** | `briefing_get` — with `context_radius` (direct/adjacent/account_wide), `token_budget`, and `dropped_entries` in response |
| **Context** | `context_add`, `context_get`, `context_list`, `context_supersede`, `context_search`, `context_semantic_search`, `context_review`, `context_review_batch` ★, `context_stale`, `context_bulk_mark_stale` ★, `context_diff`, `context_ingest`, `context_ingest_auto`, `context_extract`, `context_stale_assign`, `context_embed_backfill` |
| **Actors** | `actor_register`, `actor_get`, `actor_list`, `actor_update`, `actor_whoami`, `actor_expertise` |
| **Assignments** | `assignment_create`, `assignment_get`, `assignment_list`, `assignment_update`, `assignment_accept`, `assignment_complete`, `assignment_decline`, `assignment_start`, `assignment_block`, `assignment_cancel` |
| **HITL** | `hitl_submit_request`, `hitl_check_status`, `hitl_list_pending`, `hitl_resolve` |
| Activities | `activity_create`, `activity_get`, `activity_search`, `activity_complete`, `activity_update`, `activity_get_timeline` |
| Contacts | `contact_create`, `contact_get`, `contact_search`, `contact_update`, `contact_set_lifecycle`, `contact_log_activity`, `contact_get_timeline`, `contact_delete` |
| Accounts | `account_create`, `account_get`, `account_search`, `account_update`, `account_set_health_score`, `account_get_hierarchy`, `account_health_report`, `account_delete` |
| Opportunities | `opportunity_create`, `opportunity_get`, `opportunity_search`, `opportunity_advance_stage`, `opportunity_update`, `opportunity_delete` |
| Messaging | `message_channel_create`, `message_channel_update`, `message_channel_get`, `message_channel_delete`, `message_channel_list`, `message_send`, `message_delivery_get`, `message_delivery_search` |
| Analytics | `pipeline_summary`, `pipeline_forecast`, `crm_search`, `account_health_report`, `tenant_get_stats` |
| Use Cases | `use_case_create`, `use_case_get`, `use_case_search`, `use_case_update`, `use_case_delete`, `use_case_advance_stage`, `use_case_update_consumption`, `use_case_set_health`, `use_case_link_contact`, `use_case_unlink_contact`, `use_case_list_contacts`, `use_case_get_timeline`, `use_case_summary` |
| Registries | `activity_type_list`, `activity_type_add`, `activity_type_remove`, `context_type_list`, `context_type_add`, `context_type_remove` |
| Notes | `note_create`, `note_get`, `note_update`, `note_delete`, `note_list` |
| Workflows | `workflow_create`, `workflow_get`, `workflow_update`, `workflow_delete`, `workflow_list`, `workflow_run_list`, `workflow_template_list` ★ |
| Webhooks | `webhook_create`, `webhook_get`, `webhook_update`, `webhook_delete`, `webhook_list`, `webhook_list_deliveries` |
| Emails | `email_create`, `email_get`, `email_search`, `email_provider_set`, `email_provider_get` |
| Email Sequences | `email_sequence_create`, `email_sequence_get`, `email_sequence_update`, `email_sequence_delete`, `email_sequence_list`, `email_sequence_enroll`, `email_sequence_unenroll`, `email_sequence_enrollment_list` |
| Custom Fields | `custom_field_create`, `custom_field_update`, `custom_field_delete`, `custom_field_list` |
| Meta | `schema_get`, `entity_resolve`, `guide_search` |

★ New in v0.7

---

## CLI Reference

```
Setup & Diagnostics
  crmy init [--yes]                      Interactive setup wizard (DB, migrations, admin)
  crmy doctor [--port 3000]              8-point diagnostic check
  crmy server [--port 3000]              Start HTTP server + Web UI
  crmy mcp                               Start stdio MCP server (for Claude Code)
  crmy seed-demo [--reset]               Seed rich demo data (idempotent)

Authentication
  crmy login                             Sign in (shortcut)
  crmy auth setup [url]                  Configure server URL
  crmy auth login                        Sign in (stores JWT)
  crmy auth status                       Show auth state + token expiry
  crmy auth logout                       Clear stored credentials

Contacts
  crmy contacts list [--q <query>]       List contacts
  crmy contacts create                   Interactive create
  crmy contacts get <id>                 Get contact details
  crmy contacts delete <id>              Delete (admin/owner only)

Accounts
  crmy accounts list                     List accounts
  crmy accounts create                   Interactive create
  crmy accounts get <id>                 Get account + contacts + opps
  crmy accounts delete <id>              Delete (admin/owner only)

Opportunities
  crmy opps list [--stage <s>]           List opportunities
  crmy opps get <id>                     Get opportunity details
  crmy opps create                       Interactive create
  crmy opps advance <id> <stage>         Advance opportunity stage
  crmy opps delete <id>                  Delete (admin/owner only)

Use Cases
  crmy use-cases list                    List use cases
  crmy use-cases get <id>                Get use case details
  crmy use-cases create                  Interactive create
  crmy use-cases summary                 Use case summary
  crmy use-cases delete <id>             Delete (admin/owner only)

Actors
  crmy actors list [--type <t>]          List actors (humans & agents)
  crmy actors register                   Interactive actor registration
  crmy actors get <id>                   Get actor details
  crmy actors whoami                     Show current actor identity

Assignments
  crmy assignments list [--mine]         List assignments
  crmy assignments create                Interactive create
  crmy assignments get <id>              Get assignment details
  crmy assignments accept <id>           Accept a pending assignment
  crmy assignments start <id>            Start working on an assignment
  crmy assignments complete <id>         Complete an assignment
  crmy assignments decline <id>          Decline an assignment
  crmy assignments block <id>            Mark as blocked
  crmy assignments cancel <id>           Cancel an assignment

Context
  crmy context list [--subject-type <t>] [--subject-id <id>]
  crmy context add                       Add context about a CRM object
  crmy context get <id>                  Get context entry
  crmy context supersede <id>            Supersede with updated content
  crmy context search <query>            Full-text search across context
  crmy context review <id>              Mark entry as still accurate
  crmy context stale                     List stale entries needing review

Briefing
  crmy briefing <type:UUID>              Get a full briefing for an object

HITL
  crmy hitl list                         Pending HITL requests
  crmy hitl approve <id>                 Approve request
  crmy hitl reject <id> [--note]         Reject request

Workflows
  crmy workflows list                    List automation workflows
  crmy workflows get <id>                Get workflow + recent runs
  crmy workflows create                  Interactive create
  crmy workflows delete <id>             Delete workflow
  crmy workflows runs <id>               Execution history

Webhooks
  crmy webhooks list                     List webhook endpoints
  crmy webhooks create                   Register new webhook
  crmy webhooks delete <id>              Remove webhook
  crmy webhooks deliveries               Delivery log

Emails
  crmy emails list                       List outbound emails
  crmy emails get <id>                   Get email details
  crmy emails create                     Compose email (draft or send)

Other
  crmy pipeline                          Pipeline summary
  crmy search <query>                    Cross-entity search
  crmy events [--object <id>]            Audit log
  crmy config show                       Show config
  crmy migrate run                       Run migrations
  crmy migrate status                    Migration status
  crmy notes list [--subject <id>]       List notes
  crmy notes create                      Create a note
  crmy custom-fields list                List custom field definitions
  crmy activity-types list               List activity type registry
  crmy context-types list                List context type registry
```

---

## Web UI

Available at `/app` when the server is running. The web UI provides full CRUD for all CRM entities and agent management.

**Sidebar navigation:**

| Section | Pages |
|---------|-------|
| **Agent Hub** | Memory Hub (dashboard), Approvals (HITL), Agents, Context, Workflows, Handoffs (assignments) |
| **CRM Data** | Contacts, Accounts, Opportunities, Use Cases, Activities, Emails |
| **System** | Settings (Profile, Appearance, API Keys, Webhooks, Custom Fields, Actors, Registries, Local AI Agent, Database) |

**Key features:**
- **Memory Hub** — pipeline stats, recent activity feed, context overview with Knowledge tab for cross-entity context browsing
- **Contact/Account drawers** — Detail, Brief, and Graph tabs; Brief surfaces a full structured briefing inline; Graph opens a full-page Obsidian-style memory graph
- **Memory Graph** — dark canvas visualization showing entity nodes, context clusters, related records, activities, and assignments in a concentric radial layout; sidebar for category filtering; click any node to open a detail Sheet drawer
- **Context page** — browse and search context entries; inline keyword/semantic search toggle; semantic fallback to keyword (with toast notification) when pgvector is unavailable; **Add** button for manually crafting entries without ingestion; 15 MB upload guard with clear error
- **Context import** — paste text or upload a file (PDF, DOCX, TXT, MD); subjects are auto-detected from the document using entity resolution — no manual subject selection needed; smart clipboard paste detection
- **Assignments** — My Queue / Delegated / All tabs with status-based filtering
- **HITL Approvals** — approve or reject pending agent action requests; sequence step cards show full email preview + enrollment progress with **Approve & Send** / **Decline & Skip** actions
- **Workflows** — create event-driven automations; start from 8 built-in GTM templates; per-action log drill-down in run history; variable syntax validated before save; crash-isolated editor sections
- **Sequences** — email sequence management; enrollment status filters (All / Active / Paused / Completed); Resume button for paused enrollments awaiting HITL approval
- **Emails** — compose, view, and track outbound emails with approval flow
- **Settings → Registries** — manage custom context types and activity types
- **Settings → Actors** — view and configure registered agents
- **Settings → Local AI Agent** — enable auto-extraction of context from activities; configure provider, model, and capability flags
- **Command palette** — `⌘K` for cross-entity search, quick navigation, and automation shortcuts (New Trigger, New Sequence, Go to Automations)

**First-run setup (Docker):** There are no default credentials. After `docker compose up`, create your first admin account using one of these methods:

```bash
# Option A — CLI wizard (recommended)
npx @crmy/cli init

# Option B — REST API
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"...","name":"Your Name","tenant_name":"My Org"}'

# Option C — Environment variables (headless / CI)
# Set CRMY_ADMIN_EMAIL, CRMY_ADMIN_PASSWORD in your environment before starting
```

---

## REST API

All MCP tools have a corresponding REST endpoint at `/api/v1/*`. Use the API directly for integrations that can't run MCP, or when building custom tooling.

Server URLs when running:

```
Web UI    →  http://localhost:3000/app
REST API  →  http://localhost:3000/api/v1
MCP HTTP  →  http://localhost:3000/mcp
Health    →  http://localhost:3000/health
```

All endpoints require:

```
Authorization: Bearer <jwt-token>          # human login
Authorization: Bearer crmy_<api-key>       # agent or integration
```

Create scoped API keys for agents and integrations:

```
POST /auth/api-keys   { "label": "my-agent", "scopes": ["contacts:read", "activities:write"] }
```

The key is shown once. Store it securely.

#### HTTP MCP transport (remote agents)

```
POST /mcp
Authorization: Bearer crmy_<key>
Content-Type: application/json
```

### Scope reference

| Scope | Grants access to |
|-------|-----------------|
| `*` | Everything |
| `read` | All read operations |
| `write` | All write operations |
| `contacts:read` / `contacts:write` | Contact records |
| `accounts:read` / `accounts:write` | Account records |
| `opportunities:read` / `opportunities:write` | Pipeline and deals |
| `activities:read` / `activities:write` | Activities |
| `assignments:create` / `assignments:update` | Assignment lifecycle |
| `context:read` / `context:write` | Context entries and briefings |

---

## Architecture

```
packages/
  shared/   @crmy/shared   TypeScript types, Zod schemas
  server/   @crmy/server   Express + PostgreSQL + MCP Streamable HTTP
  cli/      @crmy/cli      Local CLI + stdio MCP server
  web/      @crmy/web      React SPA at /app
docker/                    Dockerfile + docker-compose.yml
docs/recipes/              Agent tutorial walkthroughs
```

### Design decisions

- **MCP-first** — All CRM operations are MCP tools. REST API and CLI are thin wrappers around the same handlers.
- **Raw SQL** — No ORM. Every query is readable and auditable.
- **Event sourcing** — Every mutation appends to an `events` table. Full audit trail, never overwritten.
- **Scope enforcement** — API key scopes checked before every handler. JWT users always have full access.
- **Governor limits** — Plan-based quotas on actors, activities, and context entries. Prevents runaway agents.
- **Plugins** — Extensible lifecycle hooks for custom integrations.
- **Workflows** — Event-driven automation with configurable triggers and actions.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | JWT signing secret (rejected if set to a known default in production) |
| `PORT` | No | `3000` | HTTP port |
| `CRMY_TENANT_ID` | No | `default` | Tenant slug |
| `CRMY_ADMIN_EMAIL` | No | — | Auto-create admin on first boot |
| `CRMY_ADMIN_PASSWORD` | No | — | Admin password (min 12 chars) |
| `CRMY_SEED_DEMO` | No | — | Set `true` to seed demo data on startup |
| `ENABLE_PGVECTOR` | No | — | Set `true` to enable semantic search migration |
| `EMBEDDING_PROVIDER` | No | — | Embedding service (`openai` or compatible) |
| `EMBEDDING_API_KEY` | No | — | API key for embedding provider |
| `NODE_ENV` | No | — | Set `production` to enable security hardening |
| `LLM_TIMEOUT_MS` | No | `30000` | Hard timeout (ms) for LLM extraction calls |
| `WORKFLOW_FAILURE_ALERT_THRESHOLD` | No | `3` | Consecutive failures before a HITL escalation fires |

See [`.env.example`](.env.example) for the full reference with descriptions.

---

## Develop from source

**Requirements:** Node.js >= 20, PostgreSQL >= 14

```bash
git clone https://github.com/codycharris/crmy.git
cd crmy
npm install
npm run build
```

### Option A — Use `crmy init` (recommended)

The init wizard handles everything — database creation, migrations, admin account, and demo data:

```bash
npx @crmy/cli init
npx @crmy/cli server     # starts on :3000 with hot reload via the CLI
```

### Option B — Manual setup

```bash
# Start just the database via Docker (if you don't have local Postgres)
docker compose -f docker/docker-compose.yml up db -d

# Create the database (if it doesn't exist)
createdb crmy

# Copy .env.example and fill in your values
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET at minimum

# Run migrations
DATABASE_URL=postgresql://localhost:5432/crmy npx tsx scripts/migrate.ts

# Seed demo data (optional)
DATABASE_URL=postgresql://localhost:5432/crmy npx tsx scripts/seed-demo.ts

# Start BOTH the API server and the web UI dev server with hot reload:
npm run dev
```

`npm run dev` starts two processes in parallel:
- **API server** on `:3000` — auto-loads `.env` from repo root (or `packages/server/.env`)
- **Vite dev server** on `:5173` — React hot module replacement

Open http://localhost:5173/app for the web UI during development (Vite proxies API calls to `:3000`).

You can also run them individually:
```bash
npm run dev:server   # API only (port 3000)
npm run dev:web      # Web UI only (port 5173, needs API server running)
```

> **Tip:** You can also pass env vars inline instead of using a `.env` file:
> ```bash
> DATABASE_URL=postgresql://localhost:5432/crmy JWT_SECRET=$(openssl rand -hex 32) npm run dev
> ```

### Option C — Docker only

```bash
export JWT_SECRET=$(openssl rand -hex 32)
export CRMY_ADMIN_EMAIL=admin@dev.local
export CRMY_ADMIN_PASSWORD=dev-password-here
CRMY_SEED_DEMO=true docker compose -f docker/docker-compose.yml up
```

### Verify everything works

```bash
crmy doctor          # runs 8 diagnostic checks
npm run build        # verify TypeScript compilation
npm test             # run test suite
```

### Connecting Claude Code to your local dev server

```bash
claude mcp add crmy -- npx @crmy/cli mcp
```

---

## Agent recipe tutorials

Step-by-step guides for building agents on CRMy, each with MCP tool calls, CLI equivalents, realistic response shapes, and a copy-paste system prompt:

- [**Post-Meeting Agent**](docs/recipes/post-meeting-agent.md) — Process call transcripts into structured CRM context
- [**Outreach Agent**](docs/recipes/outreach-agent.md) — Briefing-driven outreach with HITL approval flow
- [**Pipeline Review Agent**](docs/recipes/pipeline-review-agent.md) — Weekly pipeline forecast and at-risk deal identification

---

## What's new in v0.7

### Enterprise-grade context & memory

The extraction pipeline, briefing service, and semantic search layer have been hardened for production multi-agent deployments:

- **Concurrent extraction** — activities are now extracted in parallel (`Promise.allSettled`). A batch of 20 activities drops from ~100s to ~10s.
- **LLM timeout guard** — all LLM calls have a 30-second hard timeout via `AbortController`. Set `LLM_TIMEOUT_MS` to customize.
- **Orphaned-entry prevention** — activities with no `subject_type`/`subject_id` are now marked `skipped` instead of writing entries with a corrupted subject.
- **SQL injection fix** — the `extend_days` parameter in context entry review was string-interpolated into SQL; it is now fully parameterized.
- **`dropped_entries` in briefings** — when the token budget is exhausted, the briefing response now tells agents exactly what was cut, so they can request it explicitly.
- **6 new DB indexes** (migration 042) — covering the primary briefing path, semantic search pre-filter, authored-by, source-activity, and the extraction backlog polling query.

#### Two new bulk MCP tools for agents managing large context queues:

```
context_review_batch    { entry_ids: [...200], extend_days: 30 }
context_bulk_mark_stale { entry_ids: [...200], reason: "outdated" }
```

### Automation engine hardening

- **HITL auto-resume** — approving a sequence HITL request now actually sends the email and advances the enrollment. Previously the enrollment stayed `paused` forever.
- **Trigger deduplication** — burst events no longer create duplicate workflow runs. Runs are deduplicated by `event_id`.
- **Failure alerts** — after 3 consecutive workflow failures, an urgent HITL escalation appears in the Handoffs queue automatically.
- **Workflow templates** — `workflow_template_list` MCP tool returns 8 ready-to-use GTM patterns (lead qualification, deal won, churn risk, email engaged, inbound reply, and more). Select from the "From template" picker in the editor.
- **Command palette** — `⌘K` now includes New Trigger, New Sequence, and Go to Automations actions, plus live search across workflow and sequence names.
- **HITL sequence preview** — sequence step approval cards now show the full email preview and enrollment progress, with **Approve & Send** / **Decline & Skip** buttons instead of raw JSON.
- **Editor crash isolation** — a React error boundary wraps editor sub-sections so a single misconfigured action card doesn't close the entire dialog.
- **Variable syntax validation** — unclosed `{{variable` references are caught client-side before save.

### Web UI

- **Add context entry modal** — a new **Add** button in the Context browser opens a full form (subject, type, title, body, confidence, tags, source, expiry). No more paste-only ingestion.
- **Semantic search fallback toast** — one-shot toast when pgvector is unavailable, on top of the existing inline banner.
- **15 MB upload guard** — oversized files are rejected with a clear error message before upload.
- **ContextPanel error state** — fetch failures now show an `AlertTriangle` card instead of silently disappearing.
- **Sequence enrollment filters** — All / Active / Paused / Completed tabs, loading skeleton, and a Resume button for paused enrollments awaiting HITL approval.
- **Run history drill-down** — workflow run cards are now expandable to show per-action logs: type, status, duration, and inline error message.

---

## What's new in v0.7

### Context import — zero-friction ingestion

Context is the core value of CRMy. v0.7 makes adding it effortless:

- **Auto-subject detection** — paste any text and CRMy automatically identifies which contacts and accounts are mentioned, using the 6-tier entity resolution service. No manual subject selection required.
- **File upload** — drag and drop PDF, DOCX, TXT, or Markdown files. Text is extracted server-side (`pdf-parse` + `mammoth`) and subjects are detected automatically from the content.
- **Smart clipboard paste** — when you open the import dialog with an empty body, CRMy checks your clipboard. If it contains >100 characters, a banner offers to use it immediately.
- **New MCP tool: `context_ingest_auto`** — for agents and CLI workflows, this tool ingests a document and resolves subjects automatically. No subject IDs needed. Pass a `confidence_threshold` to control how aggressively it links to CRM records.

```
context_ingest_auto {
  document: "<full meeting transcript>",
  source_label: "Discovery call 2026-04-09",
  confidence_threshold: 0.6    // default
}
→ { subjects_resolved: [...], entries_created: 3 }
```

- **Auto-extract from activities** — configurable in Settings → Local AI Agent (`auto_extract_context` toggle). When enabled, the extraction pipeline runs automatically on every new activity.

### Memory Graph — full redesign

The entity memory graph (`/contacts/:id/graph`, `/accounts/:id/graph`) is now an Obsidian-style dark canvas visualization:

- **6 node types**: entity center, related objects, context type clusters, individual context entries, activities, and assignments
- **5-zone concentric radial layout**: related records on the right arc, context clusters on the left, leaf entries orbiting their cluster, activities and assignments in the lower arcs
- **Sidebar filter panel**: toggle context, related, activities, and assignments on/off without rebuilding the layout
- **Node detail Sheet**: clicking any node opens a full-width slide-in drawer with complete entry details — readable font sizes, full body text, tags, confidence indicators
- **MiniMap**: functional top-right minimap showing colored nodes for orientation

### UI simplifications

- **Accounts list**: removed the initials circle avatar — accounts are companies, not people
- **Context page**: keyword/semantic search toggle moved inline with the search bar
- **Dashboard**: Overview/Knowledge tab toggle moved from the header into the page body
- **BriefingPanel**: larger fonts, colored activity-type icons, activity count pill
- **ContextPanel**: larger fonts and more readable entry cards throughout
- **Navigation**: fixed horizontal scroll on collapsed left nav

---

## What's new in v0.6

### Developer experience
- **`crmy init` wizard** — auto-creates database, offers pgvector opt-in, seeds demo data, shows API key
- **`crmy init --yes`** — fully non-interactive setup for CI/Docker
- **`crmy doctor`** — 8-point diagnostic (Node version, DB, migrations, users, pgvector, port, JWT)
- **`crmy seed-demo`** — rich demo data with stable UUIDs (3 accounts, 6 contacts, 3 opportunities, 10 activities, 12 context entries, 3 assignments)
- **Per-migration progress** — spinner updates per file during migrations
- **Node.js version gate** — clear error on Node < 20 instead of cryptic ESM failures

### MCP tools
- **175+ tools** with rewritten descriptions optimized for LLM tool selection
- **Tool ordering** — briefing and context tools first in manifest, signaling priority to agents
- **Semantic search** — `context_semantic_search` and `context_embed_backfill` (pgvector)
- **Multi-channel messaging** — `message_channel_create`, `message_send`, `message_delivery_get` with Slack built-in, extensible via plugins
- **User guide search** — `guide_search` tool lets the agent look up CRMy documentation to answer user questions

### Web UI
- **18 pages** — Dashboard, Contacts, Accounts, Opportunities, Use Cases, Activities, Context, Assignments, Agents, HITL, Workflows, Emails, Settings, and more
- **19 drawer/panel components** — inline detail views for every entity type
- **Command palette** (`⌘K`) — cross-entity search and quick navigation
- **Settings → Registries** — manage custom context and activity types

### Self-hosting
- **Railway one-click deploy** — `railway.toml` template
- **Render.com blueprint** — `render.yaml` with auto-provisioned DB and JWT secret
- **Docker Compose** — pgvector-ready Postgres, health checks, env var configuration
- **JWT secret enforcement** — server rejects known-bad secrets in production

### Documentation
- **3 agent recipe tutorials** with full MCP tool call sequences
- **CONTRIBUTING.md** — architecture overview, local dev setup, conventions
- **`.env.example`** — comprehensive reference for all environment variables

---

## License

Apache-2.0
