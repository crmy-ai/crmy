# CRMy User Guide

Complete documentation for CRMy — the operational customer context layer for AI agents.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Configuration](#configuration)
3. [Authentication](#authentication)
4. [Web UI](#web-ui)
5. [Core Concepts](#core-concepts)
6. [Contacts](#contacts)
7. [Accounts](#accounts)
8. [Opportunities](#opportunities)
9. [Customer Activity](#customer-activity)
10. [Actors](#actors)
11. [Assignments](#assignments)
12. [Context Engine](#context-engine)
13. [Briefings](#briefings)
14. [Identity Resolution](#identity-resolution)
15. [Type Registries](#type-registries)
16. [Scope Enforcement](#scope-enforcement)
17. [Governor Limits](#governor-limits)
18. [Use Cases](#use-cases)
19. [Workflows & Automation](#workflows--automation)
20. [Webhooks](#webhooks)
21. [Customer Email](#customer-email)
22. [Messaging & Channels](#messaging--channels)
23. [Custom Fields](#custom-fields)
24. [Action Policies and HITL (Human-in-the-Loop)](#action-policies-and-hitl-human-in-the-loop)
25. [Analytics & Reporting](#analytics--reporting)
26. [Systems of Record](#systems-of-record)
27. [Roadmap](#roadmap)
28. [Plugins](#plugins)
29. [MCP Tools Reference](#mcp-tools-reference)
30. [REST API Reference](#rest-api-reference)
31. [Database & Migrations](#database--migrations)

---

## Getting Started

### Install

```bash
npm install -g @crmy/cli
```

Or use with npx (no install):

```bash
npx -y @crmy/cli init
```

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL >= 14

### Quick setup — Local mode

```bash
# 1. Start Postgres with pgvector if you do not already have a database
docker run --name crmy-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=crmy \
  -p 5432:5432 \
  -d pgvector/pgvector:pg16

# 2. Initialize non-interactively
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
export CRMY_ADMIN_EMAIL=admin@example.com
export CRMY_ADMIN_PASSWORD=change-me-please-123
npx -y @crmy/cli init --yes

# 3. Check setup and start the server (REST API + MCP + Web UI at /app)
npx -y @crmy/cli doctor
npx -y @crmy/cli server

# 4. Add to Claude Code as an MCP server
claude mcp add crmy -- npx -y @crmy/cli mcp

# 5. Verify the seeded agent path
npx -y @crmy/cli agent-smoke
```

Prefer prompts? Run `npx -y @crmy/cli init` without `--yes`.

Semantic retrieval is optional but recommended for serious context work. It lets CRMy find related Signals and Memory by meaning instead of exact keywords. To enable it, use Postgres with the pgvector extension, set `ENABLE_PGVECTOR=true` before running migrations on a fresh database, and configure embedding variables in the server environment:

```env
ENABLE_PGVECTOR=true
EMBEDDING_PROVIDER=openai
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
```

Restart the server after changing these values, then run `crmy doctor` or check **Settings → Database → Semantic retrieval setup**. Model Settings configures the Workspace Agent; embeddings are server settings because they are used by background indexing and semantic search.

### Run the GTM agent demo

`init --yes` seeds the same demo data used by the web app. To reload it later:

```bash
crmy seed-demo --reset
```

Then follow the core CRMy workflow:

```bash
crmy briefing "account:Northstar Labs"
crmy context lineage --subject "account:Northstar Labs"
crmy context raw-sources
crmy context signal-groups
crmy hitl list
```

In the web UI, open `/app` and follow **Raw Context → Signals → Memory → Handoffs**. The seeded Northstar Labs workflow shows a GTM agent path end to end: messy customer context is processed into Signals, trusted items become Memory, risky decisions route to Handoffs, and system-of-record writeback remains governed.

For role-scoped QA, demo data also creates sample users:

```text
Admin   sample.admin@crmy.local / crmy-demo-123
Manager sample.manager@crmy.local / crmy-demo-123
Rep     sample.rep@crmy.local / crmy-demo-123
Peer    sample.peer@crmy.local / crmy-demo-123
```

Most CLI commands that work with customer records accept friendly references like `account:Northstar Labs`, `contact:Maya Patel`, `opportunity:Agent Context Rollout`, and `use_case:Production Rollout`. CRMy resolves the record inside your visible scope first. IDs are still expected for operational artifacts such as Handoff requests, raw-source receipts, sync runs, and writeback requests.

### First-run product path

Start with the lifecycle, not the admin surfaces:

1. **Overview** shows the scoped Focus Queue: source issues, Signals to confirm, Handoffs to decide, stale Memory, and deal/account work that needs attention.
2. **Context** is the customer-context lifecycle: **Raw Context → Signals → Memory → Lineage**.
3. **Context → Sources** explains how context enters CRMy: Add Context, MCP/API, Customer Email, and Customer Activity.
4. **Handoffs** is where humans approve, reject, reassign, or complete governed decisions.
5. **Settings** is for workspace setup. Advanced automation, sequences, webhooks, system setup, registries, and reliability tools should not be the first-run path unless you are configuring the platform.

For contributors deciding where new UI belongs, see [What Belongs Where](./what-belongs-where.md).

### Quick setup — Remote mode

Connect the CLI to an existing CRMy server without needing direct database access:

```bash
# 1. Point the CLI at your server
crmy auth setup https://crm.company.com

# 2. Sign in
crmy login
# Prompts for email + password, stores JWT in ~/.crmy/auth.json

# 3. Use the CLI normally — all commands call the REST API
crmy contacts list
crmy use-cases create
```

### Docker

```bash
docker compose -f docker/docker-compose.yml up -d
```

This starts PostgreSQL and the crmy server on port 3000 with auto-migrations.

**First-run setup — there are no default credentials.** After the server starts, create the first admin account using one of these methods:

**Option A — CLI wizard (recommended for local installs)**
```bash
npx -y @crmy/cli init
```

**Option B — REST API (works against any running server)**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"strongpassword","name":"Your Name","tenant_name":"My Org"}'
```

**Option C — Environment variables (headless / Docker / CI)**

Set `CRMY_ADMIN_EMAIL`, `CRMY_ADMIN_PASSWORD`, and optionally `CRMY_ADMIN_NAME` in your environment or `docker-compose.yml` before starting the server. On first boot with no existing users, the server will create the admin account automatically:

```yaml
# docker-compose.yml
environment:
  DATABASE_URL: postgres://crmy:crmy@db:5432/crmy
  JWT_SECRET: your-secret-here
  CRMY_ADMIN_EMAIL: admin@yourcompany.com
  CRMY_ADMIN_PASSWORD: choose-a-strong-password
  CRMY_ADMIN_NAME: "Admin"
```

If the server starts with no users and none of the above methods has been used, it will print a prominent warning in the logs with setup instructions.

#### Reset a local admin password

For local installs, reset any user's password directly in PostgreSQL with the CLI:

```bash
npx -y @crmy/cli reset-password --email admin@yourcompany.com
```

The command uses the database URL from `.crmy.json` or `DATABASE_URL`, prompts for a new password, and updates every matching user record. Passwords must be at least 12 characters.

If `.crmy.json` is missing, set the database URL first:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
npx -y @crmy/cli reset-password --email admin@yourcompany.com
```

### Develop from source

```bash
git clone https://github.com/codycharris/crmy.git
cd crmy
npm install
npm run build
npm run dev
```

---

## Configuration

### .crmy.json

Created by `crmy init`. Stored in your project root. Auto-added to `.gitignore`.

```json
{
  "serverUrl": "http://localhost:3000",
  "apiKey": "crmy_...",
  "tenantId": "default",
  "database": {
    "url": "postgresql://localhost:5432/crmy"
  },
  "jwtSecret": "...",
  "hitl": {
    "requireApproval": ["bulk_update", "bulk_delete", "send_email"],
    "autoApproveSeconds": 0
  }
}
```

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Secret for JWT token signing |
| `PORT` | No | `3000` | HTTP server port |
| `CRMY_TENANT_ID` | No | `default` | Default tenant slug |
| `CRMY_ALLOW_PUBLIC_REGISTRATION` | No | — | Set `true` to keep unauthenticated registration open after initial workspace setup |
| `CRMY_API_KEY` | No | — | API key for CLI auth (overrides .crmy.json) |
| `CRMY_SERVER_URL` | No | — | Server URL for remote CLI mode |
| `LLM_TIMEOUT_MS` | No | `30000` | Hard timeout for general background LLM calls |
| `CONTEXT_EXTRACTION_LLM_TIMEOUT_MS` | No | `90000` | Hard timeout for Raw Context → Signals extraction |
| `CONTEXT_EXTRACTION_RECOVERY_TIMEOUT_MS` | No | `45000` | Fallback extraction timeout after an empty valid response |
| `CONTEXT_EXTRACTION_REPAIR_TIMEOUT_MS` | No | `30000` | JSON repair timeout after malformed model output |
| `RAW_CONTEXT_SUBJECT_MATCH_TIMEOUT_MS` | No | `15000` | Hard timeout for automatic Raw Context record matching |

---

## Authentication

CRMy supports multiple authentication methods across the CLI, Web UI, and API.

### CLI Authentication

#### Local mode (direct database)

When you run `crmy init`, the CLI connects directly to PostgreSQL. An API key is generated and stored in both `.crmy.json` and `~/.crmy/config.json`. No server is needed for local CLI/MCP commands because tools can run in-process against the configured database.

#### Remote mode (REST API)

Connect the CLI to a running CRMy server:

```bash
# Configure the server URL (validates with health check)
crmy auth setup http://localhost:3000

# Sign in with email + password
crmy login
# or: crmy auth login

# Check current auth status
crmy auth status

# Sign out (clears stored credentials)
crmy auth logout
```

Credentials are stored in `~/.crmy/auth.json` (file permissions `0600`). The JWT token has a 1-hour expiration — run `crmy login` again when it expires.

#### Password recovery for local installs

If you lose the local admin password, reset it directly against the configured PostgreSQL database:

```bash
npx -y @crmy/cli reset-password --email admin@yourcompany.com
```

Use `DATABASE_URL` if the CLI has not been initialized in the current project:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy \
  npx -y @crmy/cli reset-password --email admin@yourcompany.com
```

#### Headless / CI mode

For automation, set environment variables instead of interactive login:

```bash
export CRMY_SERVER_URL=https://crm.company.com
export CRMY_API_KEY=crmy_abc123...
crmy contacts list   # uses REST API with API key
```

#### Priority order

The CLI resolves credentials in this order:
1. Direct database (`DATABASE_URL` or `.crmy.json` → `database.url`)
2. Stored JWT from `crmy login` (`~/.crmy/auth.json`)
3. Server URL + API key from environment (`CRMY_SERVER_URL` + `CRMY_API_KEY`)

### Web UI Authentication

Visit `/app/login` in your browser. Enter email + password to receive a JWT stored in `localStorage`.

Registration is also available at `/app/login` — creates a new tenant and owner account.

### API Authentication

All `/api/v1/*` endpoints require an `Authorization` header:

```
Authorization: Bearer <jwt-token>
Authorization: Bearer crmy_<api-key>
```

#### JWT tokens

Obtain a JWT by registering or logging in:

```
POST /auth/register   { name, email, password, tenant_name }
POST /auth/login      { email, password }
```

Tokens expire after 1 hour.

#### API keys

Create API keys for long-lived, programmatic access:

```
POST /auth/api-keys   { label, scopes: ["*"] }
```

Returns the key once (prefixed `crmy_...`). Store it securely.

```
GET    /auth/api-keys        List all keys
DELETE /auth/api-keys/:id    Revoke a key
```

#### API Key Scopes

API keys can be created with a restricted set of scopes to limit what the key is permitted to do. This is the primary access-control mechanism for agents and integrations.

**Scope format:** `<resource>:<action>` — for example `contacts:read`, `activities:write`.

**Wildcard shortcuts:**
- `read` — grants read access to all resources (equivalent to `contacts:read`, `accounts:read`, `opportunities:read`, etc.)
- `write` — grants write access to all resources
- `*` — full access (read + write everything)

Systems-of-record scopes are intentionally excluded from the `read` and `write` shortcuts. Connector setup, sync, mapping, conflicts, and external writebacks must be granted with explicit `systems:read`, `systems:write`, or `systems:admin` scopes, or with `*`.

**Available resource scopes:**

| Scope | Grants access to |
|---|---|
| `contacts:read` / `contacts:write` | Contact records and timelines |
| `accounts:read` / `accounts:write` | Account records and use cases |
| `opportunities:read` / `opportunities:write` | Pipeline and deal records |
| `activities:read` / `activities:write` | Activities, notes, emails |
| `assignments:read` / `assignments:write` | Assignment lifecycle |
| `context:read` / `context:write` | Context entries and briefings |
| `systems:read` | List systems, mappings, sync runs, conflicts, and writebacks |
| `systems:write` | Run syncs, resolve conflicts, preview/request/review/execute governed writebacks |
| `systems:admin` | Create, update, test, delete systems and manage mappings |
| `read` | All `:read` scopes (wildcard) |
| `write` | All `:write` scopes (wildcard) |
| `*` | Everything |

**How scopes are enforced:**

- JWT tokens (human login) bypass scope enforcement and always have full access.
- MCP sessions filter the tool manifest before an agent sees it, then API key requests have their scopes checked against `TOOL_SCOPES` again before any tool handler runs.
- If a required scope is missing, the server returns HTTP 403 with a message identifying exactly which scope was needed.

See the [Scope Enforcement](#scope-enforcement) section for the complete reference.

#### Agent Self-Registration

Agents can register themselves without admin intervention.

Via MCP:

```
actor_register {
  display_name: "Outreach Agent",
  agent_identifier: "outreach-pipeline-v2",
  agent_model: "claude-sonnet-4-20250514",
  scopes: ["contacts:read", "activities:write"]
}
```

Via CLI:

```bash
crmy actors register
```

Via REST API:

```
POST /auth/register-agent
Authorization: Bearer <jwt-or-api-key>

{
  "display_name": "Outreach Agent",
  "agent_identifier": "outreach-pipeline-v2",
  "agent_model": "claude-sonnet-4-20250514",
  "requested_scopes": ["contacts:read", "activities:write"]
}
```

Response includes the created (or existing) actor record and a bound API key:

```json
{
  "actor": { "id": "...", "display_name": "Outreach Agent", ... },
  "api_key": {
    "id": "...",
    "label": "Outreach Agent auto",
    "key": "crmy_...",
    "scopes": ["contacts:read", "activities:write"]
  }
}
```

The operation is idempotent — calling it twice with the same `agent_identifier` returns the existing actor (no duplicate). New agents start with `['read']` scopes by default if `requested_scopes` is not provided. An admin can expand scopes from the Settings → Actors panel.

### Roles

- `owner` — full tenant access, can manage users and keys
- `admin` — full tenant access to CRM data, setup, reliability, and audit views
- `manager` — can see their own records plus records owned by reporting users
- `member` — scoped access to their own book of business

---

## Web UI

The CRMy web interface is a React SPA served at `/app` by the Express server.

```
http://localhost:3000/app
```

### Tech stack

- React 18 + TypeScript
- Vite (build tooling)
- Tailwind CSS
- TanStack Query (server state)
- React Router v6

### Pages

#### Overview (`/app`)

Admins and owners see the Command Center for the context engine. A compact flow shows **Raw Context → Signals → Memory → Handoffs** so operators can see setup status, source volume, reviewable Signals, Current Memory, and pending governed decisions. A second **Memory Health** tab keeps stale and contradictory Memory review close to the command center.

Members and managers see an Overview focused on their book of business: record coverage, pipeline pulse, a Focus Queue, and quick actions for Add Context, Ask Agent, Signals, Handoffs, and Opportunities. The Focus Queue is also where source issues appear: unmatched customer emails, meetings missing notes/transcripts/debriefs, Signals needing confirmation, and Handoffs needing decisions.

#### Contacts (`/app/contacts`)

- **List**: searchable card/table views with name, email, account, lifecycle stage, and Memory coverage.
- **Create**: lightweight Workspace Agent creation flow when configured, with manual form fallback.
- **Detail drawer**: contact info, linked account, activity, Memory, Signals, Generate Brief, Context Graph, and Draft Email actions.

#### Accounts (`/app/accounts`)

- **List**: searchable card/table views with industry, revenue, health, owner scope, and Memory coverage.
- **Create**: lightweight Workspace Agent creation flow with editable enrichment suggestions and manual form fallback.
- **Detail drawer**: account info, contacts, opportunities, use cases, Memory, Generate Brief, Context Graph, and Draft Email actions.

#### Opportunities (`/app/opportunities`)

Searchable card/table views for deal stage, value, close date, health signals, owner scope, and Memory coverage. The detail drawer supports stage updates, linked account/contact/use cases, Memory, Generate Brief, Context Graph, and Draft Email actions.

#### Use Cases (`/app/use-cases`)

Searchable card/table views for customer outcomes, stage, health, attributed ARR, adoption details, owner scope, and Memory coverage. The detail drawer links account, opportunity, contacts, activity, Memory, Generate Brief, Context Graph, and Draft Email actions.

#### Customer Activity (`/app/activities`)

Meeting and activity capture for customer context. Tabs cover **Meetings**, **Needs Context**, **Calls & Notes**, **All Activity**, and **Connections**. Calendar meetings can link to customer records, show missing transcript/notes status, and route directly into Add Context for Signal extraction.

#### Customer Email (`/app/emails`)

Customer-facing inbox and governed outbound drafting. Tabs cover **Customer Inbox**, **Needs Review**, **Drafts & Approvals**, and **Connections**. CRMy filters internal email noise, links customer messages to revenue records, processes useful messages as Raw Context, and routes agent-generated drafts through review.

#### Handoffs (`/app/handoffs`)

Action-oriented queue for human decisions and delegated work. Tabs cover **Needs Attention**, **Delegated**, and **All**. Handoff detail drawers show the decision packet, linked record, evidence, policy reason, reviewer/assignee, due/SLA, reassignment controls, and Approve/Reject/Resolve actions.

#### Workspace Agent (`/app/agent`)

Scoped GTM workbench for asking questions, retrieving Active Context, using CRMy tools, attaching temporary context, and processing source material into Raw Context. The agent runs with the current human user's visibility, not admin bypass permissions.

#### Actors (`/app/settings/actors`)

Admin-only actor and user management for humans, agents, scopes, API keys, and registrations.

#### Context (`/app/context`)

The Context page is the dedicated workspace for the customer-context lifecycle. Raw Context is the user-facing label for raw observations/source material. The primary tabs are:

- **Raw Context tab**: source volume and recent processing outcomes across activities, inbound/outbound emails, Add Context imports, Systems of Record sync runs, MCP/REST/CLI context writes, and future source types
- **Signals tab**: inferred customer claims that need confirmation, dismissal, more evidence, or Handoff review before agents rely on them
- **Memory tab**: confirmed operational customer context agents retrieve into Active Context through briefings and search
- **Lineage tab**: source-to-action timeline showing how Raw Context produced Signals, trusted Memory, handoffs, writebacks, and audit history
- **Sources action**: secondary link for choosing how context enters CRMy: Add Context, MCP/API, Customer Email, and Customer Activity
- **Graph action**: secondary link for record-centered exploration of related records, Current Memory, recent activity, and open handoffs
- **Dual search modes**: keyword (full-text, client-side) and **semantic** (pgvector similarity). The toggle sits inline in the search bar. If semantic search is unavailable, it falls back to keyword automatically with a warning banner. Admins enable semantic retrieval in Database Settings by using a pgvector-capable database, setting `ENABLE_PGVECTOR=true`, and adding `EMBEDDING_PROVIDER` / `EMBEDDING_API_KEY` to the server environment.
- **Filter** by subject type (contact, account, opportunity, use case) and context type
- **Needs Review toggle** to surface Current Memory past its `valid_until` date
- Confidence score pills, review-date highlighting, and `is_current` badges
- Inline **"Mark reviewed"** action for Memory that has been reverified
- **Add Context dialog**:
  - **Paste text tab**: paste transcripts, emails, meeting notes, support updates, or research; subjects are auto-detected and shown as colored chips
  - **Upload file tab**: drag-and-drop or browse for PDF, DOCX, TXT, or Markdown; text is extracted server-side and subjects detected automatically; file name, size, and a text preview are shown before confirming
  - Both tabs allow adding or removing detected subjects and providing a source label
  - Submit records a Raw Context source, preserves selected subject links, and runs extraction so useful claims become Signals or Memory according to readiness rules

#### Context Graph (`/app/context?tab=graph`) {#context-graph}

Context Graph is a record-centered explorer, not the full Memory lifecycle view. Select a customer record to explore related records, Current Memory, recent activity, and open handoffs. Use **Context → Lineage** when you need to trace Raw Context through Signals, Memory, Handoffs, writebacks, and audit receipts.

Click any graph node to open a detail drawer with key fields, content preview, and links back to the underlying record or context item.

#### Settings (`/app/settings`)

Role-aware settings:
- **Profile**: name, email, role, and personal appearance preferences
- **API Keys**: create new keys (shown once), list existing, revoke
- **Admin-only setup**: Model Settings, Systems of Record, source filters, Actors, Webhooks, Custom Fields, Registries, Action Policies, Advanced Automation, Reliability, and Audit Log
- **Tenant identity**: read-only workspace/tenant details for admins

#### Workspace Agent settings (`/app/settings/model`)

Controls the agent that performs background intelligence tasks for your tenant.

**Section 1 — Enable**: master on/off switch.

**Section 2 — Provider & Model**: select Anthropic, OpenAI, OpenRouter, Ollama, or a custom OpenAI-compatible endpoint. Enter the API key (stored encrypted, shown only as a hint after saving). Model pricing is estimated per-turn based on `max_tokens_per_turn`.

**Section 3 — Behavior**:

| Flag | Default | Description |
|---|---|---|
| Allow agent to create assignments | ✓ | Agent can create `stale_context_review` and task assignments |
| Allow agent to log activities | ✓ | Agent can create activity records as provenance for extractions |
| **Auto-extract context from activities** | ✓ | Automatically run the extraction pipeline on every new activity |
| Allow agent to write revenue objects | ✓ | Lite and full Workspace Agent can create/update contacts, accounts, opportunities, use cases, and activities after user confirmation and access checks |

The **Auto-extract context from activities** flag (`auto_extract_context`) controls whether newly created activities trigger the extraction pipeline. When disabled, activities are marked `skipped` and no context entries are written. This is useful when you want to control extraction cost or use `context_ingest_auto` explicitly instead.

**Section 4 — Observability**: link to the agent activity log showing every tool call, argument, result, and session attribution.

**System prompt**: editable with full preview; the default instructs the agent to complete tasks directly via tools rather than describing UI steps.

#### Actors Settings Panel

The Actors tab in Settings provides a full view of every registered identity in your tenant.

**Table view**: columns for Name/Type, Role/Model, Scopes, Status, and Created date. Click any row to expand an inline detail panel.

**Card view** (mobile/narrow): chevron button on each card expands the detail panel inline.

**Actor Detail Panel** (expanded inline):

*Scopes viewer*: chip list of all active scopes. Clicking **Edit** opens an interactive scope editor with toggles grouped by category:

| Group | Scopes |
|---|---|
| General | `read`, `write` (wildcard) |
| Contacts | `contacts:read`, `contacts:write` |
| Accounts | `accounts:read`, `accounts:write` |
| Opportunities | `opportunities:read`, `opportunities:write` |
| Activities | `activities:read`, `activities:write` |
| Assignments | `assignments:read`, `assignments:write` |
| Context | `context:read`, `context:write` |

*API Keys section*: lists all API keys bound to this actor. Each key shows label, creation date, expiry, and last-used date. Actions:
- **Create key** — generates a new key bound to the actor; the raw value is shown once in a dismissible banner
- **Copy** — copies the key value (only available immediately after creation)
- **Revoke** — permanently disables the key

**`agent_model` field**: shown in the Role/Model column for agent-type actors. This is informational metadata — it records which model version the agent reported at registration time. It is not used in authentication or scope enforcement. Useful for governance (spotting deprecated model versions), auditing, and incident triage when correlating behavior changes to model updates.

---

## Core Concepts

### Active Context vs Memory

CRMy separates the model's temporary working set from persistent customer Memory.

- **Active Context** is the working desk: the current prompt, conversation, bound record, retrieved briefing, tool results, and any loaded source material visible to the model in this task. It is ephemeral and limited by the model's context window.
- **Memory** is the filing cabinet: confirmed typed customer context that survives across sessions, carries evidence and lifecycle state, and can be retrieved for future agent work.
- **Raw Context** is incoming source material before extraction: calls, emails, transcripts, notes, systems-of-record updates, documents, and MCP/REST/CLI inputs.
- **Signals** are inferred, evidence-backed claims from Raw Context. Trusted Signals become Memory; uncertain or risky Signals stay separate or route to Handoffs.

The normal flow is:

```text
Raw Context -> Signals -> Memory -> Active Context -> Handoffs / writeback
```

Agents should retrieve Memory into Active Context with `briefing_get`, `context_search`, or semantic search before making recommendations or preparing writes. Lineage explains where Memory came from; Active Context is what the model is using right now.

### MCP-First Architecture

All customer-context operations are defined as **MCP tools**. The REST API and CLI mostly call the same tool handlers, while a few UI-first admin wizards (mailbox/calendar OAuth, provider setup, and other connection flows) remain REST/UI surfaces because they involve redirects or secrets. MCP is the complete agent-facing surface; the CLI is curated for setup, demos, Raw Context ingestion, activity/email review, systems, workflows, and operational QA.

Use high-level tools for most revenue agents: `briefing_get`, `customer_record_resolve`, `crm_search`, `context_ingest_auto`, `context_ingest`, `activity_create`, Signal promotion/handoff tools, compound actions, assignments, and HITL. Use `context_ingest_auto` for messy transcripts, emails, notes, and research; use `customer_record_resolve` when an agent needs to resolve a customer record before briefing or action. Reserve `context_add`, setup, mapping, operations, workflow administration, compatibility lookup tools, and systems-of-record tools for operator agents or human admins with explicit scopes.

**Four ways to interact:**

1. **MCP (stdio)** — `crmy mcp` starts an MCP server over stdio for Claude Code
2. **MCP (HTTP)** — `POST /mcp` endpoint for remote MCP clients (Streamable HTTP transport)
3. **REST API** — `GET/POST/PATCH/DELETE /api/v1/*` endpoints for traditional integrations
4. **CLI** — `crmy <command>` for terminal workflows and smoke tests

### Multi-Tenancy

Every record is scoped to a tenant. Tenants are identified by a slug (e.g. `default`). Users, contacts, accounts, and all other entities belong to a tenant.

### Event Sourcing

Every mutation writes an append-only event row to the `events` table. Events capture:

- What changed (`event_type`)
- Who did it (`actor_id`, `actor_type`: user/agent/system)
- What object was affected (`object_type`, `object_id`)
- Before and after state (`before_data`, `after_data`)

Browse the audit log with `crmy events` or `GET /api/v1/events`.

### Pagination

All list endpoints use cursor-based pagination:

- `limit` — max items per page (default 20, max 100)
- `cursor` — opaque cursor from the previous response's `next_cursor`

Response format:

```json
{
  "data": [...],
  "next_cursor": "2026-03-12T10:00:00Z",
  "total": 42
}
```

---

## Contacts

Contacts are people you interact with. They can be linked to an account and have a lifecycle stage.

### Lifecycle stages

`lead` → `prospect` → `customer` → `churned`

### MCP tools

| Tool | Description |
|---|---|
| `contact_create` | Create a contact. Required: `first_name`. Optional: `last_name`, `email`, `phone`, `title`, `company_name`, `account_id`, `lifecycle_stage`, `aliases`, `tags`, `custom_fields`, `source` |
| `contact_get` | Get a contact by ID |
| `contact_search` | Search with filters: `query`, `lifecycle_stage`, `account_id`, `owner_id`, `tags`. Query matches name, email, linked account, and any alias. |
| `contact_update` | Patch any fields via `{ id, patch: { ... } }`. Supports `aliases` array. |
| `contact_set_lifecycle` | Change stage with optional `reason` |
| `contact_get_timeline` | Get the activity timeline with optional type filter |
| `contact_get_opportunities` | List opportunities linked to a contact |
| `contact_score` | Compute and persist the contact lead score |
| `contact_merge` | Merge a duplicate contact into a primary contact |
| `contact_delete` | Permanently delete a contact. Admin/owner role required. |

### CLI

```bash
crmy contacts list --q "sarah"
crmy contacts create          # interactive
crmy contacts get "Maya Patel"
crmy contacts delete "Maya Patel"     # admin/owner only
```

### REST API

```
GET    /api/v1/contacts?q=sarah&stage=prospect&limit=20
POST   /api/v1/contacts              { first_name, email, ... }
GET    /api/v1/contacts/:id
PATCH  /api/v1/contacts/:id          { first_name, tags, ... }
DELETE /api/v1/contacts/:id          (admin/owner only)
GET    /api/v1/contacts/:id/timeline
```

---

## Accounts

Accounts represent organizations. Accounts can have parent/child hierarchies, health scores, and linked contacts and opportunities.

### MCP tools

| Tool | Description |
|---|---|
| `account_create` | Create an account. Required: `name`. Optional: `domain`, `industry`, `employee_count`, `annual_revenue`, `currency_code`, `website`, `parent_id`, `aliases`, `tags`, `custom_fields` |
| `account_get` | Get an account with its contacts and open opportunities |
| `account_search` | Search with filters: `query`, `industry`, `owner_id`, `min_revenue`, `tags`. Query matches name, domain, and any alias. |
| `account_update` | Patch any fields. Supports `aliases` array. |
| `account_set_health_score` | Set score (0-100) with `rationale` |
| `account_get_hierarchy` | Get parent/child tree |
| `account_delete` | Permanently delete an account. Admin/owner role required. |

### CLI

```bash
crmy accounts list
crmy accounts create          # interactive
crmy accounts get "Northstar Labs"
crmy accounts delete "Northstar Labs" # admin/owner only
```

### REST API

```
GET    /api/v1/accounts?q=acme&industry=tech
POST   /api/v1/accounts
GET    /api/v1/accounts/:id
PATCH  /api/v1/accounts/:id
DELETE /api/v1/accounts/:id          (admin/owner only)
```

---

## Opportunities

Opportunities track sales deals through a pipeline.

### Pipeline stages

`prospecting` → `qualification` → `proposal` → `negotiation` → `closed_won` / `closed_lost`

### Forecast categories

- `pipeline` — early stage
- `best_case` — likely to close
- `commit` — committed to close
- `closed` — deal completed

### MCP tools

| Tool | Description |
|---|---|
| `opportunity_create` | Create an opportunity. Required: `name`. Optional: `account_id`, `contact_id`, `amount`, `currency_code`, `close_date`, `stage`, `description` |
| `opportunity_get` | Get with recent activities |
| `opportunity_search` | Filter by `stage`, `owner_id`, `account_id`, `forecast_cat`, `close_date_before/after` |
| `opportunity_advance_stage` | Move to next stage with optional `note`. `lost_reason` required for `closed_lost` |
| `opportunity_update` | Patch any fields |
| `opportunity_delete` | Permanently delete an opportunity. Admin/owner role required. |
| `pipeline_summary` | Aggregate pipeline by `stage`, `owner`, or `forecast_cat` |

### CLI

```bash
crmy opps list --stage proposal
crmy opps get "Agent Context Rollout"
crmy opps create
crmy opps advance "Agent Context Rollout" negotiation
crmy opps advance "Agent Context Rollout" closed_lost --lost-reason "No budget"
crmy opps delete "Agent Context Rollout"
crmy pipeline
```

### REST API

```
GET    /api/v1/opportunities?stage=proposal
POST   /api/v1/opportunities
GET    /api/v1/opportunities/:id
PATCH  /api/v1/opportunities/:id    { stage: "negotiation", note: "..." }
DELETE /api/v1/opportunities/:id    (admin/owner only)
GET    /api/v1/analytics/pipeline?group_by=stage
GET    /api/v1/analytics/forecast?period=quarter
```

---

## Customer Activity

Customer Activity is the meeting/call/note context feed. Calendar meetings, phone calls, in-person meetings, notes, and manually logged interactions can become Raw Context when they include a transcript, debrief, or summary. The activity model supports polymorphic subjects (any customer record), structured `detail` payloads, `occurred_at` timestamps for retroactive logging, and `outcome` tracking.

Calendar capture is optional. Meeting transcripts and call notes can still feed context through **Add Context**, `activity_add_context`, `calendar_event_add_context`, or `context_ingest_auto`.

Calendar and meeting association uses the same account-first Subject Graph resolver as Raw Context extraction. CRMy still uses deterministic attendee email and account-domain matching first, but opportunity and use-case links are only added when the resolver can identify them inside the matched account scope. Ambiguous child records stay reviewable instead of being guessed.

### Activity types

Default types are seeded and organized by category. Meeting classifications are customizable in [Type Registries](#type-registries), while the core activity write tools currently accept the built-in activity type values.

| Category | Types |
|---|---|
| `basic` | call, email, meeting, note, task, demo, proposal, research, handoff, status_update |
| `outreach` | outreach_email, outreach_call, outreach_linkedin, outreach_other |
| `meeting` | meeting_scheduled, meeting_held |
| `internal` | note_added, research_completed |
| `lifecycle` | stage_change |

### Key fields

| Field | Notes |
|---|---|
| `type` | Built-in activity type string such as `call`, `meeting_held`, `note_added`, or `research_completed` |
| `subject_type` / `subject_id` | Polymorphic attachment to any customer record |
| `occurred_at` | When the activity happened (may differ from `created_at` for retroactive logging) |
| `detail` | JSONB — structured payload (call recording URL, email thread ID, etc.) |
| `outcome` | String describing what resulted from this activity |
| `direction` | `inbound` or `outbound` |

### MCP tools

| Tool | Description |
|---|---|
| `activity_create` | Create an activity. Required: `type`, `subject`. Optional: `body`, `contact_id`, `account_id`, `opportunity_id`, `due_at`, `direction`, `detail`, `outcome`, `occurred_at` |
| `activity_get` | Get by ID |
| `activity_search` | Filter by `contact_id`, `account_id`, `opportunity_id`, `type` |
| `activity_add_context` | Add debrief notes, transcript, or summary to an existing activity and process it as Raw Context |
| `activity_complete` | Mark as completed with optional timestamp and note |
| `activity_update` | Patch `subject`, `body`, `status`, `due_at` |
| `activity_get_timeline` | Get timeline for any subject object |
| `calendar_connection_list` | List calendar connections and meeting-capture health |
| `calendar_event_search` | Search customer meetings by validation and processing state |
| `calendar_event_get` | Get one meeting and linked artifacts |
| `calendar_event_process` | Process a ready meeting as Raw Context |
| `calendar_event_add_context` | Add transcript/notes/summary to a meeting and process it |
| `meeting_classification_list` | List tenant meeting classifications |

### CLI

```bash
crmy activities list --subject "account:Northstar Labs"
crmy activities meetings
crmy activities meeting <id>
crmy activities add-context <id> --file transcript.txt --type transcript
crmy activities process <id>
crmy activities connections
crmy activities classifications
```

### REST API

```
GET    /api/v1/activities?contact_id=...&type=call
POST   /api/v1/activities
PATCH  /api/v1/activities/:id
POST   /api/v1/activities/:id/context
GET    /api/v1/calendar/connections
POST   /api/v1/calendar/connections/:provider/start
POST   /api/v1/calendar/connections/:id/sync
GET    /api/v1/calendar-events
GET    /api/v1/calendar-events/:id
POST   /api/v1/calendar-events/:id/process
POST   /api/v1/calendar-events/:id/artifacts
```

---

## Actors

Actors are the first-class identity layer in CRMy — every action is attributed to an actor. Actors bridge human users (from the `users` auth table) and AI agents into a single identity model.

### Actor types

| Type | Description |
|---|---|
| `human` | A human user linked to a `users` record via `user_id` |
| `agent` | An AI agent registered via `actor_register` or self-registration |
| `system` | Automated system processes (e.g., workflow engine, scheduler) |

### Key fields

| Field | Description |
|---|---|
| `display_name` | Human-readable name shown in the UI and audit log |
| `actor_type` | `human`, `agent`, or `system` |
| `agent_identifier` | Stable external identifier for agents (e.g., `"outreach-pipeline-v2"`) |
| `agent_model` | The model version the agent reported at registration (informational only) |
| `scopes` | `TEXT[]` of scope strings controlling what this actor can do |
| `is_active` | Whether the actor is currently enabled |
| `metadata` | JSONB — additional context (e.g., team, version, deployment info) |

### Effective scopes

When an API key is used to authenticate, the **effective scopes** are the intersection of:
1. The API key's own `scopes`
2. The bound actor's `scopes` (if the key is linked to an actor)

The narrower of the two always wins. This allows creating a key with broad scopes but bounding it to an actor with narrow scopes, or vice versa.

### MCP tools

| Tool | Description |
|---|---|
| `actor_register` | Register a new actor (human or agent). Required: `display_name`, `actor_type`. Optional: `agent_identifier`, `agent_model`, `scopes`, `metadata` |
| `actor_get` | Get actor by ID |
| `actor_list` | List actors. Filter by `actor_type`, `is_active` |
| `actor_update` | Update `display_name`, `scopes`, `is_active`, `metadata` |
| `actor_whoami` | Return the actor identity for the current request (always allowed, no scope required) |
| `actor_expertise` | Query actor Memory contributions — two modes (see below) |

### Actor expertise

`actor_expertise` has two modes depending on what you provide:

**Mode 1 — what does this actor know?** Pass `actor_id` to see which subjects an actor has contributed context about, ordered by contribution count. Useful for routing reviews to the right person.

```
actor_expertise { actor_id: "<agent-uuid>", limit: 20 }
```

Returns:
```json
{
  "mode": "by_actor",
  "actor_id": "...",
  "total_entries": 142,
  "subjects": [
    { "subject_type": "account", "subject_id": "...", "entry_count": 28, "last_authored_at": "...", "context_types": ["objection", "competitive_intel"] }
  ],
  "top_context_types": [
    { "context_type": "objection", "count": 45 }
  ]
}
```

**Mode 2 — who knows the most about this entity?** Pass `subject_type` + `subject_id` to find the actors with the most context contributions. Useful before creating a Memory review assignment or asking for a human opinion.

```
actor_expertise { subject_type: "account", subject_id: "<uuid>", limit: 5 }
```

Returns:
```json
{
  "mode": "by_subject",
  "subject_type": "account",
  "subject_id": "...",
  "experts": [
    { "actor_id": "...", "entry_count": 28, "last_authored_at": "..." }
  ]
}
```

At least one of `actor_id` or (`subject_type` + `subject_id`) must be provided.

### CLI

```bash
crmy actors list --type agent
crmy actors register             # interactive
crmy actors get <id>
crmy actors whoami
```

### REST API

```
GET    /api/v1/actors?type=agent&active=true
POST   /api/v1/actors              { display_name, actor_type, agent_identifier, ... }
GET    /api/v1/actors/:id
PATCH  /api/v1/actors/:id          { scopes, is_active, ... }
DELETE /api/v1/actors/:id          (admin/owner only)
```

---

## Assignments

Assignments are the coordination layer — structured handoffs of work between agents and humans. An assignment says "this actor should do this thing about this customer record by this time."

### Lifecycle

```
pending → accepted → in_progress → completed
                  ↘ declined
       ↘ cancelled
         (any non-terminal state) → blocked → in_progress (unblocked)
```

| Status | Meaning |
|---|---|
| `pending` | Created, awaiting acceptance |
| `accepted` | Assignee has acknowledged |
| `in_progress` | Actively being worked |
| `blocked` | Cannot proceed; `blocked_reason` is set |
| `completed` | Work is done |
| `declined` | Assignee refused with optional reason |
| `cancelled` | Cancelled by creator or admin |

### Key fields

| Field | Description |
|---|---|
| `title` | Short description of what needs to be done |
| `description` | Optional longer explanation |
| `assignment_type` | Work category such as `review`, `follow_up`, `research`, or `custom` |
| `subject_type` / `subject_id` | The customer record this assignment is about |
| `assigned_to` | Actor who should do the work |
| `assigned_by` | Actor who created it |
| `due_at` | Optional deadline |
| `priority` | `low`, `normal`, `high`, `urgent` |
| `context` | Freeform handoff notes for the assignee |
| `outcome` | Filled in when completing the assignment |
| `blocked_reason` | Filled in when blocking |

### MCP tools

| Tool | Description |
|---|---|
| `assignment_create` | Create an assignment. Required: `title`, `assignment_type`, `assigned_to`. Optional: `description`, `subject_type`, `subject_id`, `context`, `priority`, `due_at` |
| `assignment_get` | Get by ID |
| `assignment_list` | List with filters: `assigned_to`, `assigned_by`, `status`, `subject_type`, `subject_id` |
| `assignment_update` | Patch `title`, `description`, `context`, `due_at`, `priority` |
| `assignment_accept` | Accept a pending assignment |
| `assignment_start` | Transition to `in_progress` |
| `assignment_complete` | Mark complete with optional `outcome` |
| `assignment_decline` | Decline with optional `reason` |
| `assignment_block` | Mark as blocked with required `blocked_reason` |
| `assignment_cancel` | Cancel the assignment |

### CLI

```bash
crmy assignments list --mine
crmy assignments create
crmy assignments get <id>
crmy assignments accept <id>
crmy assignments start <id>
crmy assignments complete <id>
crmy assignments block <id>
crmy assignments decline <id>
crmy assignments cancel <id>
```

### REST API

```
GET    /api/v1/assignments?assigned_to=...&status=pending
POST   /api/v1/assignments
GET    /api/v1/assignments/:id
PATCH  /api/v1/assignments/:id
POST   /api/v1/assignments/:id/accept
POST   /api/v1/assignments/:id/start
POST   /api/v1/assignments/:id/complete   { outcome }
POST   /api/v1/assignments/:id/decline    { reason }
POST   /api/v1/assignments/:id/block      { blocked_reason }
POST   /api/v1/assignments/:id/cancel
```

---

## Context Engine

The Context Engine turns Raw Context into reviewable Signals and Current Memory attached to customer records. Context entries are structured, typed, searchable, and carry metadata for agent consumption:

- **`context_type`** — typed from a registry (transcript, summary, objection, etc.)
- **`confidence`** — how certain the source is (1.0 for verbatim transcripts, 0.6 for inferred sentiment)
- **`valid_until`** — when the entry needs review (e.g., pricing info should be rechecked after 30 days)
- **`tags`** — filterable JSONB array for fast lookup
- **Full-text search** — PostgreSQL `tsvector`/`tsquery` with GIN index
- **Supersede chain** — old entries are marked `is_current = false` rather than deleted; new entries point back via `supersedes_id`
- **Priority weights** — each context type carries a `priority_weight` (0.5–2.0) used when ranking entries in token-budget-aware briefings
- **Confidence decay** — each type can have a `confidence_half_life_days`; effective confidence decays as `stored_confidence × 0.5^(age / half_life)`, so old intel does not crowd out fresh Memory

Memory has a first-class lifecycle:

- **Signal** — inferred, evidence-backed context that is not confirmed truth yet.
- **Current Memory** — confirmed operational context agents can use for briefings, workflows, handoffs, and governed writeback.
- **Needs Review** — Current Memory whose `valid_until` has passed. Agents should verify it before acting.
- **Superseded** — old Memory replaced by fresher evidence. It stays preserved for audit and lineage.
- **Dismissed** — rejected Signal preserved with evidence, but excluded from operational Memory.

This is the core Memory Health model: GTM facts decay, and CRMy keeps customer Memory current instead of letting old CRM notes silently rot.

When agents work, this Memory still has to be retrieved into Active Context. `briefing_get` is the primary high-level retrieval path: it assembles the record, related objects, activity timeline, open handoffs, Current Memory, unconfirmed Signals, stale warnings, and token-budget metadata into the model-visible working set.

### Context types

17 default types are seeded per tenant across two groups:

**Structured (auto-extractable from activities):**
`commitment`, `next_step`, `stakeholder`, `deal_risk`, `competitive_intel`, `objection`, `key_fact`

**Unstructured (written explicitly):**
`note`, `transcript`, `summary`, `research`, `preference`, `sentiment_analysis`, `decision`, `relationship_map`, `meeting_notes`, `agent_reasoning`

Custom types can be added via the [Type Registries](#type-registries).

**Default priority weights and half-lives (all types):**

| Type | Priority weight | Half-life (days) |
|---|---|---|
| `commitment` | 2.0 | 90 |
| `deal_risk` | 2.0 | 60 |
| `next_step` | 1.8 | 30 |
| `objection` | 1.8 | 45 |
| `stakeholder` | 1.5 | 180 |
| `competitive_intel` | 1.5 | 60 |
| `relationship_map` | 1.3 | 365 |
| `key_fact` | 1.3 | — |
| `summary` | 1.2 | — |
| `meeting_notes` | 1.2 | — |
| `preference` | 1.0 | 180 |
| `sentiment_analysis` | 1.0 | 30 |
| `decision` | 1.0 | — |
| `research` | 0.8 | — |
| `note` | 0.7 | — |
| `agent_reasoning` | 0.6 | — |
| `transcript` | 0.5 | — |

Custom types default to weight 1.0, no decay.

### Key fields

| Field | Description |
|---|---|
| `subject_type` / `subject_id` | Polymorphic attachment to any customer record |
| `context_type` | Type string from the context type registry |
| `body` | The content (max size enforced by governor limit `context_body_max_chars`) |
| `structured_data` | Optional JSONB payload for typed context (e.g., objection status, competitor details) |
| `confidence` | Float 0.0–1.0 signaling how reliable this information is |
| `tags` | String array for filtering (e.g., `["pricing", "q2-2026"]`) |
| `authored_by` | Which actor created this entry |
| `valid_until` | Optional expiry timestamp; entries past this date need review |
| `is_current` | `false` if superseded by a newer entry |
| `supersedes_id` | Foreign key to the entry this one replaces |

### Memory Health and automatic assignments

Current Memory with a `valid_until` in the past needs review. The briefing service surfaces these entries with warnings so agents know not to treat aging customer context as unquestioned truth.

CRMy automatically assigns Memory that needs review — a background worker runs every 60 seconds, finds Current Memory past its review date, identifies the actor with the most context contributions to that subject, and creates a `stale_context_review` assignment. Duplicate assignments are never created for the same entry.

Tools:
- `context_stale` — list Current Memory that needs review
- `context_review` — confirm Memory is still accurate (bumps `reviewed_at`)
- `context_review_batch` — mark up to 200 entries reviewed in a single call (v0.7+)
- `context_bulk_mark_stale` — mark up to 200 entries as needing review in a single call, with optional reason tag (v0.7+)
- `context_stale_assign` — trigger the Memory Health review loop on-demand (normally runs automatically)

#### Bulk review example

Agents managing large context queues can process many entries at once without hitting rate limits from individual calls:

```
# Mark 50 entries as reviewed, extending valid_until by 30 days
context_review_batch {
  entry_ids: ["uuid1", "uuid2", ... "uuid50"],
  extend_days: 30
}

# Mark outdated research Memory for review
context_bulk_mark_stale {
  entry_ids: ["uuid-a", "uuid-b", ...],
  reason: "superseded-by-q2-research"
}
```

### Structured data queries

The `structured_data` field is JSONB and supports containment queries via `structured_data_filter`. This lets you query across typed context using domain-specific predicates:

```
# Find all open objections on this account
context_list {
  subject_type: "account",
  subject_id: "...",
  context_type: "objection",
  structured_data_filter: { "status": "open" }
}

# Full-text search only among critical deal risks
context_search {
  query: "security compliance",
  context_type: "deal_risk",
  structured_data_filter: { "severity": "critical" }
}
```

### Superseding entries

When information changes, supersede the old entry rather than deleting it:

```
context_supersede { id: "<old-id>", body: "Updated pricing...", ... }
```

The old entry's `is_current` is set to `false`. Queries for context automatically filter to `is_current = true` unless explicitly requesting the full history.

### Bulk ingestion

`context_ingest` takes Raw Context (transcript, email, meeting notes) for a known record and runs the full extraction pipeline, creating an activity as provenance and returning a processing receipt plus the Signals and Memory produced:

```
context_ingest {
  subject_type: "opportunity",
  subject_id: "...",
  document: "<full meeting transcript>",
  source_label: "Q2 kickoff call"
}
```

Returns `{ extracted_count, memory_created, signals_created, skipped, signals, memory_entries, context_entries, activity_id, raw_context_source, processing_receipt }`. `context_entries` is retained for broad clients; agents should use `signals`, `memory_entries`, and `processing_receipt.next_action` to decide whether to review, promote, retry, or brief.

### Signals and Memory

CRMy separates messy Raw Context from Current Memory:

- **Raw Context** is raw source material: calls, emails, notes, transcripts, CRM/warehouse changes, Slack messages, support records, product usage, and documents.
- **Signals** are inferred context extracted from Raw Context. They include confidence and evidence, but they are not confirmed truth.
- CRMy combines related Signals into one evidence-backed claim so multiple sources can support, strengthen, or contradict the same inference.
- **Memory** is Current typed operational context. Briefings and normal context search return Memory by default.

Every Signal and important Memory entry should read as a **claim with evidence**. The claim is the entry body. Evidence records source type, source ID/reference, source URL when available, source label, speaker or author, snippet, observed timestamp, captured timestamp, support confidence, rationale, and optional verification metadata. This lets an agent explain, for example, “Budget approval is a risk” together with the meeting excerpt and date that support the claim.

Extraction stays tolerant of messy customer context. CRMy can keep an incomplete but useful Signal, then mark what it needs before it becomes Memory. Readiness language is intentionally operational: **Ready for Memory**, **Needs more detail**, **Needs supporting evidence**, **Needs review before agents can act**, or **Could affect forecast, approval required**. Internally, context type registries define the typed details that make a Signal actionable; developer/API docs may call these JSON schemas, but the product concept is typed Memory readiness.

Corroborated Signals should be promoted before they are used to coordinate work, influence forecast, update external systems, assign tasks, or guide customer engagement. Use `context_signal_group_promote` for grouped/corroborated claims, `context_signal_promote` for a single reviewed Signal, and the reject tools when a claim should stay out of Memory.

The lifecycle is first-class:

- `signal`: inferred, evidence-backed, and reviewable.
- `active`: Current Memory that agents, workflows, scoring, and writeback can rely on.
- `superseded`: replaced by newer Memory.
- `rejected`: dismissed after review but retained with evidence for audit.

Creating a Signal requires evidence. Normal retrieval, briefings, actor expertise, scoring, and state prerequisites use Current Memory unless a caller explicitly asks for Signals.

### Automatic subject detection — `context_ingest_auto`

When you don't know which customer records a document mentions, use `context_ingest_auto`. The configured Workspace Agent identifies likely accounts, people, opportunities, and use cases; CRMy grounds those candidates against visible records with account-scoped subject resolution. When an account is matched, CRMy narrows contact, opportunity, and use-case matching to that account before falling back to global matching for strong identifiers.

```
context_ingest_auto {
  document: "<full meeting transcript>",
  source_label: "Discovery call 2026-04-09",
  confidence_threshold: 0.6    // optional, default 0.6 — skip low-confidence matches
}
```

Returns:

```json
{
  "subjects_resolved": [
    { "entity_type": "account", "id": "...", "name": "Northstar Labs", "confidence": "high", "entries_created": 3, "memory_created": 2, "signals_created": 1, "activity_id": "...", "processing_receipt": { "status": "needs_review", "next_action": "Review Signals and promote trusted items to Memory." } },
    { "entity_type": "contact", "id": "...", "name": "Jane Smith", "confidence": "medium", "entries_created": 2, "memory_created": 0, "signals_created": 2, "activity_id": "...", "processing_receipt": { "status": "needs_review" } }
  ],
  "entries_created": 5,
  "memory_created": 2,
  "signals_created": 3,
  "low_confidence_skipped": ["Inc", "Q2", "Monday"]
}
```

Automatic extraction uses the same account-first subject graph exposed by `customer_record_resolve`: exact IDs/emails/domains, stored aliases, account-scoped child matching, ambiguity receipts, and reviewed record proposals. Only matches above the `confidence_threshold` are linked. Common English words, days of the week, and month names are filtered before resolution to avoid noise. If CRMy finds a customer account but no existing child record fits, it can return proposed records for review instead of auto-creating duplicates.

This is the recommended tool for agents processing inbound content (emails, transcripts, documents) when subject IDs are not already known.

### Auto-extract from activities

When the **Workspace Agent** is configured and `auto_extract_context` is enabled in Model Settings, CRMy runs the extraction pipeline automatically on every new activity. Extraction happens fire-and-forget — it does not slow down activity creation. Activities are processed immediately if the agent is configured; otherwise they are queued with `extraction_status = 'pending'` and processed by the background worker (runs every 60 seconds) once the agent becomes available. Extracted items are stored as Signals by default.

Each raw input also creates or updates a Raw Context processing record with the source type, source reference, linked subject, processing stage, status, extracted Signal count, Memory count, skipped count, and failure reason when available. This gives operators and agents one place to understand whether a transcript, email, system update, MCP write, or import produced useful Signals and Memory.

Use `context_extract { activity_id }` to manually re-run extraction on any activity.

### Catch-up diff

`context_diff` shows what changed about a subject since a timestamp — useful for daily agent check-ins:

```
context_diff {
  subject_type: "account",
  subject_id: "...",
  since: "7d"    // or "24h", "30m", or ISO timestamp
}
```

Returns:
- `new_entries` — context created since the timestamp
- `superseded_entries` — entries that were replaced (the old, now-inactive versions)
- `newly_stale` — entries whose `valid_until` fell within the window
- `resolved_entries` — entries that were reviewed (confirmed accurate) in the window
- `summary` — counts of each category

### MCP tools

| Tool | Description |
|---|---|
| `context_ingest_auto` | Ingest Raw Context and automatically resolve mentioned entities — **no subject IDs needed**. Configurable `confidence_threshold`; optional `subjects` lets an app/agent pin a known record. Recommended for agents processing transcripts, emails, notes, and research. |
| `context_ingest` | Ingest Raw Context and auto-extract structured Signals for a known subject. Requires explicit `subject_type` + `subject_id`. Returns a Raw Context processing receipt. |
| `context_raw_source_list` | List Raw Context processing records with source, status, stage, Signal count, Memory count, skipped count, and failure reason. |
| `context_raw_source_get` | Inspect one Raw Context processing record. |
| `context_add` | Advanced direct write for Current Memory or an evidence-backed Signal. Required: `subject_type`, `subject_id`, `context_type`, `body`. Optional: `memory_status`, `confidence`, typed `evidence`, `tags`, `valid_until`, `structured_data`, `source_activity_id`. Signals require evidence; `rejected` and `superseded` are lifecycle states managed by review tools. |
| `context_get` | Get by ID (includes superseded entry if applicable) |
| `context_list` | List entries for an object. Filter by `memory_status`, `context_type`, `tags`, `is_current`, `authored_by`, `structured_data_filter` |
| `context_search` | Full-text search across Memory by default. Pass `memory_status: "signal"` to search Signals. |
| `context_signal_group_list` | List corroborated Signal claims with aggregate confidence, support count, source count, status, and conflict state. |
| `context_signal_group_get` | Inspect one corroborated Signal with supporting/conflicting evidence. |
| `context_lineage_get` | Trace Raw Context through Signals, Memory, Handoffs, writebacks, and audit events. |
| `context_signal_group_promote` | Promote a trusted corroborated Signal into Current Memory. |
| `context_signal_handoff` | Route a Signal to Handoff when policy, conflict, or risk requires human review before promotion. |
| `context_signal_group_reject` | Dismiss a corroborated Signal while preserving evidence for audit. |
| `context_signal_promote` | Promote a reviewed Signal into Current Memory |
| `context_signal_reject` | Reject a Signal while preserving evidence for audit |
| `context_supersede` | Replace an entry with updated content |
| `context_review` | Mark an entry as reviewed (confirm still accurate) |
| `context_stale` | List Current Memory past `valid_until` that needs review |
| `context_diff` | Catch-up diff since a timestamp: new, superseded, stale, and resolved entries |
| `context_extract` | Re-run the extraction pipeline on a specific activity (backfill or retry) |
| `context_stale_assign` | Trigger the Memory Health review loop on-demand for the current tenant |
| `context_semantic_search` | Semantic (vector) similarity search using pgvector. Falls back gracefully with `fallback_available: true` if pgvector or embeddings are not configured. Requires a pgvector-capable database, `ENABLE_PGVECTOR=true`, and server-side `EMBEDDING_PROVIDER` settings. |
| `context_embed_backfill` | Generate embeddings for context entries that have not yet been embedded. Use `dry_run: true` first to see pending count. |

### CLI

```bash
crmy context ingest --file discovery-call.txt --auto
crmy context raw-sources --status needs_review
crmy context reprocess-source <raw-source-id>
crmy context lineage --subject "account:Northstar Labs"
crmy context signals --subject "opportunity:Agent Context Rollout"
crmy context signal-groups --subject "opportunity:Agent Context Rollout"
crmy context promote <signal-entry-id>
crmy context promote-group <signal-id>
crmy context handoff-group <signal-id>
crmy context list --subject "contact:Maya Patel" --status active
crmy context add   # advanced direct write only
crmy context get <id>
crmy context supersede <id>
crmy context search "competitor pricing"
crmy context semantic-search "security review risk"
crmy context review <id>
crmy context stale
```

### REST API

```
GET    /api/v1/context?subject_type=contact&subject_id=...
POST   /api/v1/context
GET    /api/v1/context/:id
POST   /api/v1/context/:id/supersede
POST   /api/v1/context/:id/review
GET    /api/v1/context/stale
GET    /api/v1/context/search?q=pricing&tags=q2
GET    /api/v1/context/semantic-search?q=...&subject_type=...
POST   /api/v1/context/ingest           { text, subject_type, subject_id, source_label }
POST   /api/v1/context/detect-subjects  { text }          → { subjects: [{ type, id, name, confidence, match_tier }] }
POST   /api/v1/context/ingest-file      { filename, data (base64), source_label }  → { text_preview, subjects, truncated }
```

---

## Briefings

A briefing is a single API call that assembles everything an agent or human needs before engaging with a customer record. It replaces the need to make 5–10 separate queries.

### What a briefing includes

1. The core record (contact, account, opportunity, or use case)
2. Related records (e.g., the account a contact belongs to, or contacts linked to a use case)
3. Recent activities (last 10 by default)
4. Open assignments for this object
5. Context entries grouped by `context_type` (only `is_current = true` entries)
6. Memory Health warnings for any Current Memory past `valid_until`
7. Adjacent context from related entities (when `context_radius` is set)

### MCP tool

```
briefing_get { subject_type: "contact", subject_id: "<id>" }
```

Returns a structured object:

```json
{
  "record": { ... },
  "related": { ... },
  "activities": [ ... ],
  "open_assignments": [ ... ],
  "context": {
    "transcript": [ ... ],
    "objection": [ ... ],
    "competitive_intel": [ ... ]
  },
  "stale_warnings": [
    { "id": "...", "context_type": "research", "valid_until": "2026-01-01", "body": "..." }
  ]
}
```

### Context radius

By default, `briefing_get` only includes context entries directly attached to the requested subject (`context_radius: "direct"`). Pass a wider radius to pull in context from related entities:

| Radius | What's included |
|---|---|
| `direct` (default) | Only entries on the requested subject |
| `adjacent` | The subject plus all directly related objects (the account a contact belongs to, contacts linked to a use case, etc.) |
| `account_wide` | Everything in `adjacent` plus all contacts and opportunities under the same account |

```
briefing_get {
  subject_type: "opportunity",
  subject_id: "...",
  context_radius: "adjacent"
}
```

When `adjacent_context` is present in the response, it lists each related subject alongside its context entries.

### Token budget

Pass `token_budget` (integer, minimum 100) to get a priority-ranked, budget-constrained context pack that fits within a caller-specified token estimate. This is the primary mechanism for loading the right context into an LLM without overflow.

```
briefing_get {
  subject_type: "contact",
  subject_id: "...",
  token_budget: 4000
}
```

How it works:

1. Each context entry is scored: `effective_confidence × priority_weight`, where `effective_confidence = stored_confidence × 0.5^(age_days / half_life_days)` (from the type registry)
2. Entries are sorted by score descending (most important, freshest first)
3. Entries are greedily packed until the budget is exhausted; the last entry that partially fits has its body truncated
4. The response includes `token_estimate` (actual tokens used) and `truncated: true` if any body was cut

When no `token_budget` is given, all entries are returned sorted by score, and `token_estimate` is still included for reference.

#### `dropped_entries` (v0.7+)

When the token budget is exhausted and entries are dropped, the briefing response includes a `dropped_entries` summary listing the `context_type`, `title`, and `confidence` of every entry that was omitted. Agents can use this to:

- Request specific dropped entries with `context_get`
- Widen the budget on a follow-up `briefing_get` call
- Inform the user that some context was deprioritized

```json
{
  "dropped_entries": [
    { "context_type": "research", "title": "TAM analysis Q4 2025", "confidence": 0.6 },
    { "context_type": "agent_reasoning", "confidence": 0.4 }
  ]
}
```

### Text format

Pass `format: "text"` to receive a single `briefing_text` string formatted for direct injection into a prompt:

```
briefing_get { subject_type: "account", subject_id: "...", format: "text", token_budget: 3000 }
```

### CLI

```bash
crmy briefing "contact:Maya Patel"
crmy briefing "account:Northstar Labs"
crmy briefing "use_case:Production Rollout"
```

### REST API

```
GET /api/v1/briefing/:subject_type/:subject_id?context_radius=adjacent&token_budget=4000
```

---

## Identity Resolution

When an agent or user references an entity by a name that doesn't exactly match what's in the database — "JPMC" instead of "JP Morgan Chase", a nickname, a typo, or a common abbreviation — CRMy resolves it automatically before performing any operation.

### How resolution works

Resolution runs through five tiers in order, returning as soon as a confident match is found:

| Tier | Method | Confidence |
|---|---|---|
| 1 | Email exact match (contacts) / domain exact match (accounts) | `HIGH` |
| 2 | Full name exact match (case-insensitive) | `HIGH` |
| 3 | Alias array exact match | `HIGH` |
| 4 | ILIKE substring match on name/email/domain/aliases | `MEDIUM` |
| 5 | pg_trgm trigram similarity fallback (handles typos) | `LOW` |

If a single `MEDIUM` or `HIGH` candidate is found, it is returned as `status: "resolved"`. If multiple candidates survive, `status: "ambiguous"` is returned with the full candidate list for HITL disambiguation.

### Aliases

Both contacts and accounts have an `aliases` field — a string array of known alternate names, abbreviations, and nicknames. These are indexed with a GIN index for fast lookup.

```json
// Account example
{
  "name": "JP Morgan Chase",
  "domain": "jpmorgan.com",
  "aliases": ["JPMC", "JPMorgan", "J.P. Morgan"]
}
```

Populate aliases when creating or updating a record:

```
PATCH /api/v1/accounts/:id
{ "aliases": ["JPMC", "JPMorgan", "J.P. Morgan"] }
```

Or via MCP:

```
account_update { id: "...", patch: { aliases: ["JPMC", "JPMorgan"] } }
```

Aliases are also searched by `contact_search`, `account_search`, and `crm_search`.

### Actor affinity scoring

When multiple candidates are ambiguous, CRMy scores each one by how much the requesting actor has previously interacted with it — across activities, context entries, and assignments. The intuition: agents typically work a fixed book of accounts, so prior history is a strong disambiguation signal.

Affinity is computed as:

```
score = activities.performed_by count
      + context_entries.authored_by count
      + assignments.assigned_to/assigned_by count
```

If a single candidate has non-zero affinity and no other candidate matches at a higher tier, it is auto-resolved. If multiple HIGH-confidence candidates exist and one has substantially more affinity, it is preferred.

### HITL fallback

When resolution returns `status: "ambiguous"` and actor affinity cannot break the tie, the agent should surface the candidates to a human via `hitl_submit_request` before proceeding. The response includes a `candidates` array with IDs, names, and confidence scores to populate the approval payload.

### Customer record resolution

Use `customer_record_resolve` when an agent needs to resolve a customer record before briefing or action. It uses the same account-first resolver as Raw Context extraction and returns account scope, ambiguity receipts, and proposed child records.

Use `context_ingest_auto` instead when the input is a messy meeting transcript, email thread, call notes, research, or any other source that should become Signals and Memory.

`entity_resolve` remains available as a compatibility/simple account-contact lookup tool for older agent harnesses. It should not be the primary path for messy GTM context or child records such as opportunities and use cases.

**Input:**

| Field | Type | Description |
|---|---|---|
| `query` or `text` | string (one required) | Customer reference or short source snippet to resolve before action |
| `subject_type` | `account` \| `contact` \| `opportunity` \| `use_case` \| `any` | Optional target record type |
| `account_hint` | string | Optional account/customer name, alias, or domain to narrow child records |
| `confidence_threshold` | 0–1 | Minimum confidence threshold for model-assisted matches |
| `limit` | 1–20 | Max records/candidates to return |

**Output:**

```json
{
  "resolver": "subject_graph",
  "subjects": [
    { "type": "account", "id": "uuid", "name": "Northstar Labs", "confidence": "high" }
  ],
  "skipped": [],
  "proposed_records": [],
  "account_scope": [],
  "resolution_summary": "Matched 1 customer record."
}
```

### REST endpoint

```
POST /api/v1/subjects/resolve
Authorization: Bearer <key>

{
  "query": "Northstar Pegasus expansion",
  "subject_type": "opportunity",
  "account_hint": "Northstar Labs",
  "limit": 5
}
```

Returns the same shape as the MCP tool output.

Compatibility endpoint: `POST /api/v1/resolve` still serves `entity_resolve` for simple account/contact lookup used by older integrations.

### Database

Migration `018_identity_resolution.sql` adds:
- `pg_trgm` extension
- `aliases text[]` column on `contacts` and `accounts` (GIN indexed)
- Trigram indexes on `contacts.first_name`, `contacts.last_name`, `accounts.name`

---

## Type Registries

Activity types and context types are discoverable via per-tenant registries. Defaults are seeded on tenant creation. You can add and remove custom types without schema changes.

### Activity Types

19 default types across 7 categories (see [Activities](#activities) for the full list).

#### MCP tools

| Tool | Description |
|---|---|
| `activity_type_list` | List all registered activity types for the tenant |
| `activity_type_add` | Add a custom type. Required: `name` (snake_case). Optional: `category`, `description` |
| `activity_type_remove` | Remove a custom type by `name` |

#### CLI

```bash
crmy activity-types list
crmy activity-types add partner_call
crmy activity-types remove partner_call
```

### Context Types

17 default types: `commitment`, `next_step`, `stakeholder`, `deal_risk`, `competitive_intel`, `objection`, `key_fact`, `note`, `transcript`, `summary`, `research`, `preference`, `sentiment_analysis`, `decision`, `relationship_map`, `meeting_notes`, `agent_reasoning`.

Each type has two additional fields that control how it is prioritized in token-budget-aware briefings:

| Field | Description |
|---|---|
| `priority_weight` | Multiplier (default 1.0) applied when scoring entries for briefing packing. Higher = surfaces first. |
| `confidence_half_life_days` | If set, confidence decays as `stored_confidence × 0.5^(age_days / half_life_days)`. `null` means no decay. |

#### MCP tools

| Tool | Description |
|---|---|
| `context_type_list` | List all registered context types for the tenant |
| `context_type_add` | Add a custom type. Required: `name` (snake_case). Optional: `description`, `priority_weight`, `confidence_half_life_days` |
| `context_type_remove` | Remove a custom type by `name` |

#### CLI

```bash
crmy context-types list
crmy context-types add deal_risk
crmy context-types remove deal_risk
```

---

## Scope Enforcement

Scope enforcement is the authorization layer for API key and agent access. Every MCP tool and REST route that is called by a non-JWT actor is checked against a central `TOOL_SCOPES` map before the handler runs.

### How it works

1. Request arrives with `Authorization: Bearer crmy_<key>`
2. API key is resolved to an `ActorContext` (including the actor's scopes)
3. For MCP tool calls: `enforceToolScopes(toolName, actor)` is called before the handler
4. For REST routes: `enforceToolScopes(toolName, actor)` or `requireScopes(actor, ...scopes)` is called
5. If any required scope is missing → HTTP 403 with an explanatory message

**Human JWT users keep their role and record visibility.** Owners and admins can access tenant-wide data. Managers can access records owned by themselves and reporting users. Members can access only their visible book of business. Constructed actors, anonymous actors, agents, and API keys must also carry explicit scopes. Tools that are intentionally public are limited to identity/schema/help lookups such as `actor_whoami`, `entity_resolve`, `schema_get`, and `guide_search`. Account-first GTM resolution through `customer_record_resolve` requires `context:read`.

### Wildcard resolution

| Actor has | Grants |
|---|---|
| `read` | All non-systems scopes ending in `:read` |
| `write` | All non-systems scopes ending in `:write` |
| `systems:read` / `systems:write` / `systems:admin` | Explicit systems-of-record access |
| `*` | Everything |
| `contacts:read` | Only `contacts:read` |

### Tool scope map (reference)

| Tool | Required scopes |
|---|---|
| `contact_get`, `contact_search`, `contact_get_timeline` | `contacts:read` |
| `contact_get_opportunities` | `contacts:read`, `opportunities:read` |
| `contact_create`, `contact_update`, `contact_delete`, `contact_set_lifecycle`, `contact_score`, `contact_merge` | `contacts:write` |
| `account_get`, `account_search`, `account_get_hierarchy`, `account_health_report` | `accounts:read` |
| `account_create`, `account_update`, `account_delete`, `account_set_health_score` | `accounts:write` |
| `opportunity_get`, `opportunity_search` | `opportunities:read` |
| `opportunity_create`, `opportunity_update`, `opportunity_advance_stage`, `opportunity_delete` | `opportunities:write` |
| `pipeline_summary`, `pipeline_forecast` | `opportunities:read` |
| `activity_get`, `activity_search`, `activity_get_timeline`, `calendar_connection_list`, `calendar_event_search`, `calendar_event_get` | `activities:read` |
| `activity_create`, `activity_update`, `activity_complete` | `activities:write` |
| `activity_add_context`, `calendar_event_process`, `calendar_event_add_context` | `activities:write`, `context:write` |
| `assignment_get`, `assignment_list` | `assignments:read` |
| `assignment_create`, `assignment_update`, `assignment_accept`, `assignment_complete`, `assignment_decline`, `assignment_start`, `assignment_block`, `assignment_cancel` | `assignments:write` |
| `use_case_get`, `use_case_search`, `use_case_list_contacts`, `use_case_get_timeline`, `use_case_summary` | `accounts:read` |
| `use_case_create`, `use_case_update`, `use_case_delete`, `use_case_advance_stage`, `use_case_update_consumption`, `use_case_set_health`, `use_case_unlink_contact` | `accounts:write` |
| `use_case_link_contact` | `accounts:write`, `contacts:read` |
| `context_get`, `context_search`, `context_list`, `context_raw_source_list`, `context_raw_source_get`, `context_signal_group_list`, `context_signal_group_get`, `context_stale`, `context_diff`, `briefing_get` | `context:read` |
| `context_add`, `context_signal_promote`, `context_signal_reject`, `context_supersede`, `context_review`, `context_extract`, `context_ingest`, `context_ingest_auto`, `context_bulk_mark_stale`, `context_embed_backfill`, `context_stale_assign`, `context_review_batch`, `context_resolve_contradiction`, `context_consolidate` | `context:write` |
| `context_signal_group_promote`, `context_signal_handoff`, `context_signal_group_reject`, `context_raw_source_reprocess` | `context:write` |
| `context_detect_contradictions`, `context_semantic_search`, `context_lineage_get`, `customer_record_resolve` | `context:read` |
| `context_contradiction_assign` | `context:read`, `assignments:write` |
| `email_get`, `email_search`, `email_message_search`, `email_message_get`, `mailbox_connection_list`, `email_draft_preview` | `activities:read` plus `context:read` for draft preview |
| `email_create`, `email_draft_save`, `email_message_ignore` | `activities:write` |
| `email_ingest`, `email_message_process`, `email_message_link` | `activities:write`, `context:write` |
| `hitl_check_status`, `hitl_list_pending` | `read` |
| `hitl_submit_request`, `hitl_resolve` | `write` |
| `actor_get`, `actor_list`, `actor_expertise`, `agent_find_specialist`, `crm_search`, `tenant_get_stats` | `read` |
| `actor_register`, `actor_update`, `agent_register_specialization`, `agent_set_availability` | `write` |
| `ops_status_get`, `ops_data_quality_get`, `ops_audit_get`, `ops_privacy_export` | `read` plus admin/owner visibility |
| `ops_job_recover`, `ops_data_quality_repair`, `ops_pii_redact`, `ops_privacy_delete`, `ops_retention_apply` | `write` plus admin/owner visibility |
| `webhook_*`, `custom_field_*`, `workflow_*` | `read` or `write` (general) |
| `actor_whoami`, `entity_resolve`, `schema_get`, `guide_search` | *(always allowed)* |

### Error response

When a scope check fails:

```json
{
  "code": "PERMISSION_DENIED",
  "message": "Scope 'contacts:write' is required for 'contact_create'. Your scopes: [read]",
  "status": 403
}
```

---

## Governor Limits

Governor limits are plan-based rate and quota controls. They prevent runaway agents from writing unbounded data and enforce plan tier constraints.

### Plans

| Plan | Who it's for |
|---|---|
| `solo_agent` | Single-agent deployments or personal use |
| `pro_agent` | Production single-agent workloads |
| `team` | Multi-human + multi-agent teams |

### Limits enforced

| Limit name | Enforced on | Description |
|---|---|---|
| `actors_max` | `actor_register` | Maximum number of active actors |
| `activities_per_day` | `activity_create` | Maximum activities created per calendar day (UTC) |
| `assignments_active` | `assignment_create` | Maximum concurrently active (non-terminal) assignments |
| `context_entries_max` | `context_add` | Maximum total context entries in the tenant |
| `context_body_max_chars` | `context_add` | Maximum character length of a single context entry body |

### Tenant overrides

Limits can be overridden per-tenant via the `governor_limits` table:

```sql
INSERT INTO governor_limits (tenant_id, limit_name, limit_value)
VALUES ('<tenant-id>', 'actors_max', 50);
```

Tenant-specific overrides take precedence over plan defaults.

### Quota exceeded response

When a limit is hit:

```json
{
  "code": "QUOTA_EXCEEDED",
  "message": "Governor limit exceeded: activities_per_day (current: 500, max: 500)",
  "status": 429,
  "data": { "limit_name": "activities_per_day", "current": 500, "max": 500 }
}
```

---

## Use Cases

Use cases track consumption-based workloads for customer success. They link to accounts and track consumption, ARR, health, and expansion potential.

### Use case stages

`discovery` → `poc` → `production` → `scaling` → `sunset`

| Stage | Meaning |
|-------|---------|
| `discovery` | Use case identified; evaluating fit |
| `poc` | Active proof-of-concept or pilot |
| `production` | Live in production, driving real consumption |
| `scaling` | Expanding volume/users within same use case |
| `sunset` | Being wound down, consumption declining |

### MCP tools

| Tool | Description |
|---|---|
| `use_case_create` | Create with `account_id`, `name`. Optional: `stage`, `unit_label`, `consumption_capacity`, `attributed_arr`, `expansion_potential`, etc. |
| `use_case_get` | Get by ID |
| `use_case_search` | Filter by `account_id`, `stage`, `owner_id`, `product_line`, `tags` |
| `use_case_update` | Patch any fields |
| `use_case_delete` | Soft delete |
| `use_case_advance_stage` | Move to next stage with optional `note` |
| `use_case_update_consumption` | Update `consumption_current` with optional `note` |
| `use_case_set_health` | Set `score` (0-100) with `rationale` |
| `use_case_link_contact` | Link a contact with a `role` (e.g. stakeholder, champion) |
| `use_case_unlink_contact` | Remove contact link |
| `use_case_list_contacts` | List linked contacts |
| `use_case_get_timeline` | Activity timeline for this use case |
| `use_case_summary` | Aggregate by `stage`, `product_line`, or `owner` |

### CLI

```bash
crmy use-cases list --account "Northstar Labs"
crmy use-cases create
crmy use-cases get "Production Rollout"
crmy use-cases summary --group-by stage
crmy use-cases delete "Production Rollout"    # admin/owner only
```

### REST API

```
GET    /api/v1/use-cases?account_id=...&stage=active
POST   /api/v1/use-cases
GET    /api/v1/use-cases/:id
PATCH  /api/v1/use-cases/:id
DELETE /api/v1/use-cases/:id
POST   /api/v1/use-cases/:id/consumption   { consumption_current, note }
POST   /api/v1/use-cases/:id/health        { score, rationale }
GET    /api/v1/use-cases/:id/contacts
POST   /api/v1/use-cases/:id/contacts      { contact_id, role }
DELETE /api/v1/use-cases/:ucId/contacts/:contactId
GET    /api/v1/use-cases/:id/timeline
GET    /api/v1/analytics/use-cases?group_by=stage
```

## Workflows & Automation

Event-driven automation. Workflows trigger on CRM events and execute a sequence of actions.

This is an admin capability, now reached from **Settings → Automations** or the compatible `/app/automations` route. It should not be part of the first-run user path. Most users should start from Overview, Context, Handoffs, customer records, and Workspace Agent before configuring action rules or sequences.

### Trigger events

Any event type from the audit log can trigger a workflow:

- `contact.created`, `contact.updated`, `contact.lifecycle_changed`
- `account.created`, `account.updated`, `account.health_changed`
- `opportunity.created`, `opportunity.stage_changed`
- `activity.created`, `activity.completed`
- `note.created`
- `email.created`, `email.sent`
- `hitl.submitted`, `hitl.resolved`
- `use_case.stage_changed`, `use_case.health_changed`
- `actor.self_registered`

### Trigger filters

Optional JSON conditions on the event payload. Only events matching all filter conditions trigger the workflow.

```json
{
  "trigger_event": "opportunity.stage_changed",
  "trigger_filter": { "stage": "closed_won" }
}
```

### Action types

| Action | Description |
|---|---|
| `send_notification` | Send a message through a configured messaging channel (with delivery tracking) or emit a notification event. Falls back to the tenant's default channel when no `channel_id` is specified. |
| `send_email` | Draft and optionally send an outbound email with HITL approval. Set `require_approval: false` to skip human review. |
| `create_activity` | Create a follow-up task or activity |
| `create_context_entry` | Add Memory to the triggering customer record |
| `add_tag` | Add a tag to the triggering object (contact, account, or opportunity). Config: `tag`, optional `object_type`, `object_id`. |
| `remove_tag` | Remove a tag from the triggering object. Config: `tag`, optional `object_type`, `object_id`. |
| `assign_owner` | Change the owner of the triggering object. Config: `owner_id`, optional `object_type`, `object_id`. |
| `update_field` | Update a field on the triggering object. Config: `field`, `value`, optional `object_type`, `object_id`. |
| `webhook` | Fire an outbound HTTP request |

### Example: notify on closed-won deals

When `channel_id` is provided, the message is delivered through that channel with tracking and retries. When omitted, the tenant's **default channel** is used if one is configured (see [Default channel](#default-channel)). If no default exists, a `workflow.notification` event is emitted for plugin handling.

```json
{
  "name": "Celebrate closed deals",
  "trigger_event": "opportunity.stage_changed",
  "trigger_filter": { "stage": "closed_won" },
  "actions": [
    {
      "type": "send_notification",
      "config": {
        "message": "Deal closed!",
        "recipient": "#wins"
      }
    },
    {
      "type": "create_activity",
      "config": { "type": "task", "subject": "Schedule kickoff call" }
    }
  ]
}
```

### Example: send email on new contact

The `send_email` action drafts an outbound email. By default, a HITL approval request is created so a human can review before sending. Set `require_approval` to `false` for automated sends.

```json
{
  "name": "Welcome email for new contacts",
  "trigger_event": "contact.created",
  "trigger_filter": {},
  "actions": [
    {
      "type": "send_email",
      "config": {
        "to_address": "{{contact.email}}",
        "subject": "Welcome aboard!",
        "body_text": "Thanks for signing up. We're excited to have you.",
        "require_approval": true
      }
    }
  ]
}
```

### Run tracking

Every workflow execution creates a `workflow_run` record with:

- `status`: running, completed, failed
- `actions_run` / `actions_total`
- `action_logs`: JSONB array with per-action detail — type, status, duration_ms, resolved config, and error
- `error` (if failed)
- Timestamps

The web UI **Runs** tab expands each run to show the full `action_logs` breakdown.

### Trigger deduplication

Workflow runs are deduplicated by `event_id`. If the same event fires multiple times (network retries, burst publishers), only the first run is created. When triggering manually via REST, pass an optional `idempotency_key` to prevent duplicate runs within a 5-minute window.

### Failure alerts

After a configurable number of consecutive failures (default: 3, set via `WORKFLOW_FAILURE_ALERT_THRESHOLD`), CRMy creates an urgent `workflow.repeated_failure` HITL request in the Handoffs queue. This surfaces repeated automation failures to operators without requiring a separate alerting system.

### Workflow templates

Eight built-in GTM workflow templates are available via the `workflow_template_list` MCP tool or the **From template** picker in the web UI workflow editor:

| Template | Trigger | Key actions |
|---|---|---|
| Lead Qualification | `contact.created` | context_entry + assign_owner + notify |
| Deal Won | `opportunity.stage_changed` → Closed Won | notify + create_activity |
| Churn Risk Alert | `use_case.health_changed` → at-risk | HITL checkpoint + notify |
| Email Engaged | `email.opened` | add_tag + enroll_sequence |
| Inbound Reply | `email.replied` | update_lifecycle + create_activity + notify |
| Assignment Overdue | `assignment.overdue` | notify + escalate (HITL) |
| ICP Outreach | `contact.created` + ICP filter | context_entry + enroll_sequence |
| Opportunity Stalled | `opportunity.no_activity` | notify + HITL checkpoint |

### MCP tools

| Tool | Description |
|---|---|
| `workflow_create` | Create a workflow with trigger, filter, and actions |
| `workflow_get` | Get workflow with 5 most recent runs |
| `workflow_update` | Update name, trigger, filter, actions, or active status |
| `workflow_delete` | Delete workflow and run history |
| `workflow_list` | List workflows. Filter by `trigger_event` or `is_active` |
| `workflow_run_list` | List runs for a workflow. Filter by `status` |
| `workflow_template_list` | List available GTM workflow templates (static, no DB) |

### CLI

```bash
crmy workflows list --active
crmy workflows create         # interactive
crmy workflows get <id>
crmy workflows update <id> --inactive
crmy workflows test <id> --payload '{"event":"demo"}'
crmy workflows clone <id> --name "Copy"
crmy workflows trigger <id> --subject "opportunity:Agent Context Rollout"
crmy workflows runs <id> --status failed
crmy workflows delete <id>
```

### REST API

```
GET    /api/v1/workflows?trigger_event=contact.created&active=true
POST   /api/v1/workflows
GET    /api/v1/workflows/:id
PATCH  /api/v1/workflows/:id
DELETE /api/v1/workflows/:id
GET    /api/v1/workflows/:id/runs?status=completed
```

---

## Webhooks

Register HTTP endpoints to receive event notifications. Webhooks include automatic retry logic and delivery tracking.

### MCP tools

| Tool | Description |
|---|---|
| `webhook_create` | Register an endpoint. Required: `url`, `events` (array of event types) |
| `webhook_get` | Get endpoint details (includes the signing secret) |
| `webhook_update` | Update `url`, `events`, `active`, `description` |
| `webhook_delete` | Remove endpoint |
| `webhook_list` | List endpoints. Filter by `active` |
| `webhook_list_deliveries` | List delivery attempts. Filter by `endpoint_id`, `status` |

### CLI

```bash
crmy webhooks create
crmy webhooks list --active
crmy webhooks deliveries --endpoint <id> --status failed
crmy webhooks delete <id>
```

### REST API

```
GET    /api/v1/webhooks
POST   /api/v1/webhooks            { url, events: ["contact.created", ...] }
GET    /api/v1/webhooks/:id
PATCH  /api/v1/webhooks/:id        { active: false }
DELETE /api/v1/webhooks/:id
GET    /api/v1/webhooks/:id/deliveries
```

---

## Customer Email

Customer Email is an optional context feed and governed response workspace. Connect a mailbox when you want customer threads auto-matched to customer records and processed into Signals and Memory. Emails can also feed context through **Add Context** or MCP `context_ingest_auto` without connecting a mailbox.

Email association uses deterministic contact email, reply-chain, and account-domain matching first, then enriches the link with the same account-first Subject Graph resolver used by Raw Context. This lets CRMy match an opportunity or use case mentioned in an email under the right account while leaving ambiguous references in review.

### How it works

1. **Connect a mailbox** — users connect Gmail or Microsoft 365 from `/app/emails` so customer-facing messages can sync into CRMy.
2. **Filter before storage** — admin source filters skip internal-only, automated, spam/trash, newsletter, and excluded-domain messages before extraction by default.
3. **Match customer records** — CRMy links messages using known contact email, account domain, reply/thread hints, and Subject Graph account-scoped opportunity/use-case matching.
4. **Process useful messages** — linked customer messages can become Raw Context, producing Signals, Memory, or review items.
5. **Draft safely** — users can generate or edit customer replies from Memory, Signals, recent email context, and linked records. Agent-generated drafts land in **Drafts & Approvals** first.

### Mailbox and source filters

Mailbox OAuth setup is UI-first because it involves user redirects and provider consent. Admins control source filters in Settings so CRMy does not waste processing on internal mail or spam-like sources.

Current mailbox connectors:

| Provider | Status | Notes |
|---|---|---|
| Gmail / Google Workspace | Built-in | User mailbox OAuth and sync jobs |
| Microsoft 365 / Outlook | Built-in | User mailbox OAuth and sync jobs |
| Inbound webhook providers | Advanced | Use for provider-level ingestion or custom API/MCP flows |

### Governed outbound provider

Outbound delivery still uses the governed email provider configuration. SMTP is built in; additional providers can be added via plugins.

```json
{
  "provider": "smtp",
  "config": {
    "host": "smtp.gmail.com",
    "port": 587,
    "secure": false,
    "auth": { "user": "you@example.com", "pass": "app-password" }
  },
  "from_name": "CRMy",
  "from_email": "crm@example.com"
}
```

| Provider | Config fields | Status |
|----------|--------------|--------|
| `smtp` | `host`, `port`, `auth.user`, `auth.pass`, optional `secure` | Built-in |
| `sendgrid` | Provider-specific | Via plugin |
| `ses` | Provider-specific | Via plugin |

### MCP tools

| Tool | Description |
|---|---|
| `mailbox_connection_list` | List mailbox connections and processing summary visible to the current user |
| `email_message_search` | Search customer email messages from mailbox sync, inbound webhooks, manual ingest, and outbound sends |
| `email_message_get` | Get one canonical email message |
| `email_message_link` | Link or relink a message to a customer record before processing |
| `email_message_process` | Process a linked customer message as Raw Context |
| `email_message_ignore` | Ignore a message so it no longer needs review |
| `email_draft_preview` | Generate a customer email draft preview from Memory, Signals, source email, and linked records |
| `email_draft_save` | Save an edited/generated draft, request approval, or explicitly send when allowed |
| `email_create` | Legacy governed outbound email creation. Required: `to_address`, `subject`. Optional: `body_html`, `body_text`, `contact_id`, `account_id`, `opportunity_id`, `use_case_id`, `require_approval` |
| `email_get` | Get email by ID |
| `email_search` | Search by `contact_id`, `status` |
| `email_provider_set` | Configure the tenant's email provider (SMTP, etc.) |
| `email_provider_get` | Get current email provider config (passwords redacted) |

### Email statuses

```
draft → pending_approval → approved → sending → sent
                                             ↘ failed
         (if rejected)  → rejected
```

- **draft**: saved but not sent
- **pending_approval**: awaiting HITL review
- **approved**: HITL approved, delivery in progress
- **sending**: provider send in flight
- **sent**: successfully delivered
- **failed**: provider error or no provider configured
- **rejected**: HITL reviewer rejected the email

### CLI

```bash
crmy emails create           # interactive
crmy emails list --status pending_approval
crmy emails get <id>
crmy emails messages --view review
crmy emails process <message-id>
crmy emails draft-preview --source-email <message-id>
crmy emails save-draft --to customer@example.com --subject-line "Next steps" --body-file draft.txt
crmy emails ignore-message <message-id>
```

### REST API

```
GET    /api/v1/emails?contact_id=...&status=sent
POST   /api/v1/emails
GET    /api/v1/emails/:id
GET    /api/v1/mailbox/connections
POST   /api/v1/mailbox/connections/:provider/start
POST   /api/v1/mailbox/connections/:id/sync
GET    /api/v1/email-messages
GET    /api/v1/email-messages/:id
POST   /api/v1/email-messages/:id/process
POST   /api/v1/email-messages/:id/ignore
POST   /api/v1/emails/draft-preview
POST   /api/v1/emails/drafts
GET    /api/v1/email-provider
PUT    /api/v1/email-provider
```

---

## Email Sequences

Create automated drip campaigns that send a series of emails to enrolled contacts on a schedule.

### How it works

1. **Create a sequence** — define steps with `delay_days`, `subject`, and email body
2. **Enroll contacts** — use `email_sequence_enroll` to start a contact on the sequence
3. **Automatic sending** — the background worker sends each step's email when the delay elapses, then advances to the next step
4. **Completion** — once all steps are sent, the enrollment is marked `completed`

### MCP tools

| Tool | Description |
|---|---|
| `email_sequence_create` | Create a new sequence with steps |
| `email_sequence_get` | Get sequence by ID |
| `email_sequence_update` | Update name, description, steps, or active status |
| `email_sequence_delete` | Delete a sequence (cascades to enrollments) |
| `email_sequence_list` | List sequences with optional active filter |
| `email_sequence_enroll` | Enroll a contact (one enrollment per contact per sequence) |
| `email_sequence_unenroll` | Cancel an active enrollment |
| `email_sequence_enrollment_list` | List enrollments by sequence, contact, or status |

### Example sequence

```json
{
  "name": "Onboarding drip",
  "steps": [
    { "delay_days": 0, "subject": "Welcome!", "body_text": "Thanks for signing up." },
    { "delay_days": 3, "subject": "Getting started", "body_text": "Here are some tips..." },
    { "delay_days": 7, "subject": "How's it going?", "body_text": "We'd love your feedback." }
  ]
}
```

### Enrollment statuses

| Status | Meaning |
|--------|---------|
| `active` | Currently progressing through steps |
| `completed` | All steps sent |
| `paused` | Temporarily paused |
| `cancelled` | Manually unenrolled |

### REST API

```
GET    /api/v1/email-sequences
POST   /api/v1/email-sequences
GET    /api/v1/email-sequences/:id
PATCH  /api/v1/email-sequences/:id
DELETE /api/v1/email-sequences/:id
POST   /api/v1/email-sequences/enroll
POST   /api/v1/email-sequences/unenroll
GET    /api/v1/email-sequences/enrollments
```

---

## Messaging & Channels

Send messages through configured channels (Slack, email, and more) with delivery tracking, automatic retries, and status monitoring.

### How it works

1. **Configure a channel** — register a messaging endpoint (e.g. a Slack webhook) via `message_channel_create`
2. **Set a default** — mark one channel as `is_default: true` so workflow actions can omit `channel_id`
3. **Send messages** — use `message_send` or workflow `send_notification` actions with an optional `channel_id`
4. **Track delivery** — every message creates a delivery record with status tracking and automatic retry on failure

### Providers

CRMy ships with a built-in Slack provider. Additional providers (Teams, Discord, SMS) can be added via plugins.

| Provider | Config fields | Status |
|----------|--------------|--------|
| `slack` | `webhook_url` (required), `channel` (optional default) | Built-in |
| `email` | Provider-specific | Planned |
| `teams` | Provider-specific | Via plugin |
| `discord` | Provider-specific | Via plugin |

### Channel configuration

```json
{
  "name": "Eng Slack",
  "provider": "slack",
  "config": {
    "webhook_url": "https://hooks.slack.com/services/T00/B00/xxxx",
    "channel": "#crm-alerts"
  },
  "is_default": true
}
```

### Default channel

Each tenant can designate one channel as the **default** by setting `is_default: true` when creating or updating a channel. Only one channel per tenant can be the default — setting a new default automatically clears the previous one.

The default channel is used as a fallback by the `send_notification` workflow action when no `channel_id` is specified. This means workflows can simply specify a message without needing to know the channel ID:

```json
{ "type": "send_notification", "config": { "message": "New lead!" } }
```

### Delivery tracking

Every `message_send` call creates a `message_delivery` record:

| Status | Meaning |
|--------|---------|
| `pending` | Created, not yet attempted |
| `delivered` | Provider confirmed receipt |
| `retrying` | Failed, will retry (exponential backoff: 30s, 60s, 2m, ... up to 1hr) |
| `failed` | Exhausted all retry attempts (default: 5) |

### Retry logic

Failed deliveries are automatically retried with exponential backoff. The retry loop runs every 30 seconds and processes pending retries in batches.

### Adding custom providers via plugins

Plugins can register new channel providers in their `onInit` hook:

```typescript
import type { CrmyPlugin, PluginContext } from '@crmy/server';
import { registerProvider } from '@crmy/server/messaging/providers';

export default function teamsNotifier(options: TeamsOptions): CrmyPlugin {
  return {
    name: 'teams-notifier',
    async onInit(_ctx: PluginContext) {
      registerProvider({
        type: 'teams',
        validateConfig(config) {
          if (!config.webhook_url) return { valid: false, error: 'webhook_url required' };
          return { valid: true };
        },
        async send(config, message) {
          // POST to Teams webhook
          // Return { success: true/false, ... }
        },
      });
    },
  };
}
```

### MCP tools

| Tool | Description |
|------|-------------|
| `message_channel_create` | Configure a new messaging channel. Required: `name`, `provider`, `config` |
| `message_channel_update` | Update channel name, config, or active status |
| `message_channel_get` | Get channel details by ID |
| `message_channel_delete` | Delete a channel (delivery records are preserved) |
| `message_channel_list` | List channels. Filter by `provider`, `is_active` |
| `message_send` | Send a message through a channel. Required: `channel_id`, `body`. Optional: `recipient`, `subject`, `metadata` |
| `message_delivery_get` | Check delivery status by ID |
| `message_delivery_search` | Search deliveries. Filter by `channel_id`, `status` |

### REST API

```
GET    /api/v1/messaging/channels
POST   /api/v1/messaging/channels
GET    /api/v1/messaging/channels/:id
PATCH  /api/v1/messaging/channels/:id
DELETE /api/v1/messaging/channels/:id
POST   /api/v1/messaging/send
GET    /api/v1/messaging/deliveries?channel_id=...&status=delivered
GET    /api/v1/messaging/deliveries/:id
```

---

## Custom Fields

Define custom fields for any object type. Fields are stored as JSONB in the `custom_fields` column on each entity.

### Supported object types

`contact`, `account`, `opportunity`, `activity`, `use_case`

### Field types

`text`, `number`, `boolean`, `date`, `select`, `multi_select`

### MCP tools

| Tool | Description |
|---|---|
| `custom_field_create` | Define a field. Required: `object_type`, `field_name` (snake_case), `field_type`, `label`. Optional: `required`, `options` (for select types), `default_value` |
| `custom_field_update` | Update `label`, `required`, `options`, `sort_order` |
| `custom_field_delete` | Remove field definition |
| `custom_field_list` | List all fields for an object type |

### CLI

```bash
crmy custom-fields list contact
crmy custom-fields create      # interactive
crmy custom-fields delete <id>
```

### REST API

```
GET    /api/v1/custom-fields?object_type=contact
POST   /api/v1/custom-fields
PATCH  /api/v1/custom-fields/:id
DELETE /api/v1/custom-fields/:id
```

---

## Action Policies and HITL (Human-in-the-Loop)

CRMy is the policy boundary between agent inference and operational change. Agents can infer Signals, draft recommendations, and prepare work freely, but actions that affect forecast, customer engagement, assignments, Current Memory, or systems of record pass through scopes, Action Policies, HITL approvals, and audit receipts.

Built-in Action Policies protect high-risk actions before custom rules run:

- Forecast category changes require approval for non-user actors.
- Signal promotion requires evidence and may require approval when confidence is low.
- External writebacks evaluate object write scope, source authority, allowed fields, writeback mode, idempotency, and target system policy.
- Workflow field updates create approval requests instead of directly mutating sensitive fields.

HITL is the review mechanism for policy decisions that require human judgment. Agents submit requests; humans approve or reject.

### How it works

1. Agent calls `hitl_submit_request` with action details
2. Request enters `pending` status
3. Human reviews via CLI (`crmy hitl list`) or REST API
4. Human approves or rejects with optional note
5. Agent checks status with `hitl_check_status`

### Custom auto-approval policies

Set `auto_approve_after_seconds` to auto-approve if no human responds within the timeout. Admins can also configure Action Policies in Settings to auto-approve routine requests or auto-reject risky ones. A background worker checks pending requests every 60 seconds.

### Request statuses

`pending` → `approved` / `rejected` / `expired` / `auto_approved`

### MCP tools

| Tool | Description |
|---|---|
| `hitl_submit_request` | Submit a request. Required: `action_type`, `action_summary`, `action_payload`. Optional: `auto_approve_after_seconds` |
| `hitl_check_status` | Check the status of a request |
| `hitl_list_pending` | List pending requests |
| `hitl_resolve` | Approve or reject. Required: `request_id`, `decision` (approved/rejected). Optional: `note` |

### CLI

```bash
crmy hitl list
crmy hitl approve <id>
crmy hitl reject <id> --note "Not ready"
```

### REST API

```
GET    /api/v1/hitl?limit=20
POST   /api/v1/hitl
GET    /api/v1/hitl/:id
POST   /api/v1/hitl/:id/resolve   { decision: "approved", note: "..." }
```

---

## Analytics & Reporting

### MCP tools

| Tool | Description |
|---|---|
| `crm_search` | Cross-entity search across contacts, accounts, and opportunities |
| `pipeline_forecast` | Forecast by `period` (month/quarter/year). Returns committed, best_case, pipeline totals, win rate, avg deal size, avg cycle days |
| `account_health_report` | Health report for an account: score, open opps, pipeline value, last activity, contact count, 30-day activity count |

### CLI

```bash
crmy pipeline
crmy search "acme"
```

### REST API

```
GET    /api/v1/analytics/pipeline?owner_id=...&group_by=stage
GET    /api/v1/analytics/forecast?period=quarter
GET    /api/v1/search?q=acme&limit=10
```

---

## Systems of Record

Systems of Record connect CRMy to the enterprise sources that already hold customer state. In 0.8, the connector framework supports HubSpot, Salesforce, Databricks, and Snowflake through one governed model.

Use **Settings → Systems of Record** to:

- Create encrypted connections. HubSpot uses OAuth app credentials by default: App ID, Client ID, Client Secret, Sample install URL, and CRMy's generated callback URL.
- Salesforce supports encrypted OAuth refresh credentials with `instance_url`, `refresh_token`, `client_id`, and `client_secret`, so CRMy can refresh tokens before sync or writeback.
- Databricks and Snowflake use credential JSON for host/account and token metadata. Warehouse writeback remains restricted to configured mappings and SQL templates.
- Test credentials and health.
- Discover schema and map external objects, tables, or views into CRMy contacts, accounts, opportunities, activities, use cases, and context entries.
- Run syncs and inspect run status.
- Review source/local conflicts.
- Preview and request governed external writebacks.

Use **Reliability** to monitor connector status, latest sync runs, open conflicts, and pending writebacks alongside queues and data-quality checks.

CLI:

```bash
crmy systems list
crmy systems test <system-id>
crmy systems discover <system-id> --object contacts
crmy systems mappings --system <system-id>
crmy systems upsert-mapping --system <system-id> --object-type contact --external-object contacts --field-mapping '{"email":"email","first_name":"firstname"}' --writable-fields email,firstname --writeback-mode mapped_upsert
crmy systems sync <system-id>
crmy systems conflicts
crmy systems resolve-conflict <conflict-id> --resolution resolved_external
crmy systems writebacks
crmy systems preview-writeback <system-id> --object-type contact --external-object contacts --operation update --mode mapped_upsert --payload '{"email":"a@example.com"}'
crmy systems request-writeback <system-id> --object-type contact --external-object contacts --operation update --mode mapped_upsert --payload @payload.json
crmy systems review-writeback <writeback-id> --decision approved
crmy systems execute-writeback <writeback-id>
```

MCP tools use the `sor_` prefix, including `sor_system_list`, `sor_mapping_upsert`, `sor_mapping_delete`, `sor_sync_run`, `sor_conflict_list`, `sor_writeback_request`, `sor_writeback_review`, and `sor_writeback_execute`.

Security notes:

- Connector credentials are stored as AES-256-GCM encrypted envelopes.
- Set `CRMY_ENCRYPTION_KEY` in production before storing connector secrets.
- REST, MCP, and CLI responses redact credential fields.
- External writes require configured mappings and writeback modes. Arbitrary agent-generated SQL writes are not allowed.
- Sync respects mapping source authority. External-authoritative mappings can update CRMy directly; CRMy-authoritative, read-only, and approval-required mappings create conflicts instead of overwriting existing records. Bidirectional mappings update only when CRMy has not diverged from the last synced value.
- Databricks and Snowflake writeback previews block requests unless the mapping has an admin-defined `writeback_config.sql_template` and the payload only uses configured writable fields. Add `writeback_config.parameter_order` when SQL parameters must bind in a specific order.
- `context_entry` mappings are reserved in 0.8. They create reviewable sync conflicts until connector/system author actors are available, rather than silently writing memory.

Automation notes:

- Sync changes emit normal CRMy events with source metadata.
- Every sync run also emits `system_sync.completed` or `system_sync.failed`, so direct UI, CLI, REST, and MCP syncs can trigger Workflows just like object updates.
- Workflow filters can match metadata such as `origin`, `system_id`, `system_type`, `changed_fields`, `confidence`, and `conflict_state`.
- Workflow external writeback actions must provide an explicit payload JSON object. CRMy will not infer payload fields from the rest of the action config.
- Workflow-created writebacks include deterministic idempotency keys unless you provide one, so replayed events do not create duplicate external writes.
- Sync-originated events do not write back to the same source unless a mapping explicitly allows it.
- Replay sync events are recorded for audit and connector recovery, but Workflows skip `metadata.sync_mode = replay` by default so historical data does not re-run automations.
- Sequence enrollment actions can resolve contacts from external-origin event subjects, linked contact IDs, or connector metadata.

---

## Roadmap

CRMy's 0.8-1.0 roadmap focuses on becoming the enterprise context and execution layer between AI agents and revenue systems of record.

The 0.8 direction expands CRMy beyond CRM-adjacent storage into a governed systems-of-record overlay across Salesforce, HubSpot, Databricks, and Snowflake. HubSpot is the first certified connector path; Salesforce, Databricks, and Snowflake share the same governed framework and should receive live-environment certification before production rollout. Connector and warehouse changes should emit normal CRMy events so existing Workflows, Sequences, HITL approvals, audit, and context extraction continue to operate through the same event bus.

Read the full roadmap: [CRMy 0.8-1.0 Roadmap: Enterprise Systems-Of-Record Overlay](roadmap-0.8-1.0.md).

---

## Plugins

Extend crmy with custom plugins. Plugins can hook into events, register MCP tools, add REST routes, and more.

### Plugin interface

```typescript
interface CrmyPlugin {
  name: string;
  version?: string;
  onInit?: (ctx: PluginContext) => Promise<void>;
  onEvent?: (event: CrmyEvent) => Promise<void>;
  registerTools?: (server: McpServer) => void;
  registerRoutes?: (router: Router) => void;
  onShutdown?: () => Promise<void>;
}
```

### Lifecycle

1. **onInit** — called once during server startup with DB access
2. **onEvent** — called for every CRM event (mutations, workflow actions)
3. **registerTools** — register additional MCP tools
4. **registerRoutes** — add custom REST endpoints
5. **onShutdown** — cleanup on server shutdown

### Configuration

Pass plugins via `ServerConfig.plugins`:

```typescript
const config: ServerConfig = {
  databaseUrl: '...',
  jwtSecret: '...',
  port: 3000,
  tenantSlug: 'default',
  plugins: [
    {
      module: './plugins/customer-health-alerts.js',
      options: {
        events: ['account.health_changed', 'hitl.submitted'],
      },
    },
  ],
};
```

### Writing your own plugin

Create a module that exports a factory function returning a `CrmyPlugin`:

```typescript
import type { CrmyPlugin, PluginContext } from '@crmy/server';

export default function myPlugin(options: MyOptions): CrmyPlugin {
  return {
    name: 'my-plugin',
    version: '1.0.0',
    async onInit(ctx) {
      // Access ctx.db for database queries
    },
    async onEvent(event) {
      if (event.event_type === 'contact.created') {
        // do something
      }
    },
  };
}
```

---

## MCP Tools Reference

See [mcp-tools.md](mcp-tools.md) for the full tool catalog. The guide below highlights the common connection patterns and high-value tools.

### MCP connection

**Stdio (Claude Code, Claude Desktop, Cursor, Windsurf):**

```bash
# Claude Code
claude mcp add crmy -- npx -y @crmy/cli mcp

# claude_desktop_config.json / .cursor/mcp.json
{
  "mcpServers": {
    "crmy": { "command": "npx", "args": ["-y", "@crmy/cli", "mcp"] }
  }
}
```

**Codex (`~/.codex/config.toml` or `codex mcp add`):**

```bash
codex mcp add crmy -- npx -y @crmy/cli mcp
```

For more control, add CRMy to `~/.codex/config.toml` or a trusted project-scoped `.codex/config.toml`:

```toml
[mcp_servers.crmy]
command = "npx"
args = ["-y", "@crmy/cli", "mcp"]

[mcp_servers.crmy.env]
DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/crmy"
CRMY_API_KEY = "crmy_..."
```

For a remote CRMy server:

```toml
[mcp_servers.crmy]
url = "https://<your-crmy-host>/mcp"
bearer_token_env_var = "CRMY_API_KEY"
```

**ChatGPT Developer Mode:**

ChatGPT Developer Mode connects to remote MCP servers over SSE or streaming HTTP. Use CRMy's remote MCP endpoint as a Developer Mode app:

```text
https://<your-crmy-host>/mcp
Authorization: Bearer crmy_...
```

Use a reachable HTTPS CRMy server or a secure development tunnel. Local stdio MCP servers are better suited to Claude Code, Claude Desktop, Codex, Cursor, Windsurf, and similar local agent harnesses.

**Hermes Agent (`~/.hermes/config.yaml`):**

Hermes reads MCP servers from `mcp_servers` and supports local stdio servers with `command`/`args` or remote HTTP servers with `url`/`headers`. CRMy works with either path.

```yaml
mcp_servers:
  crmy:
    command: "npx"
    args: ["-y", "@crmy/cli", "mcp"]
    timeout: 120
    connect_timeout: 60
    tools:
      include:
        - customer_record_resolve
        - briefing_get
        - context_ingest_auto
        - context_signal_group_list
        - context_signal_group_get
        - context_signal_group_promote
        - context_signal_handoff
        - email_draft_preview
        - email_draft_save
        - record_draft_preview
```

If Hermes is running in a service/container and cannot see your local CRMy config, add:

```yaml
    env:
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/crmy"
      CRMY_API_KEY: "crmy_..."
```

Or use CRMy's HTTP MCP endpoint:

```yaml
mcp_servers:
  crmy:
    url: "http://localhost:3000/mcp"
    headers:
      Authorization: "Bearer crmy_..."
```

Hermes registers tools with the `mcp_<server>_<tool>` naming pattern, so `briefing_get` becomes `mcp_crmy_briefing_get`. Restart Hermes or run `/reload-mcp` after editing the config.

Verify the agent-facing tool path directly:

```bash
npx -y @crmy/cli agent-smoke
```

Then ask the connected agent:

```text
Use the CRMy MCP tools to resolve the customer record "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.
```

Hermes Agent prompt:

```text
Use mcp_crmy_customer_record_resolve to resolve "Northstar Labs", call mcp_crmy_briefing_get, then call mcp_crmy_context_signal_group_list for Signals needing attention. Tell me the safest next action with the evidence you used.
```

**HTTP (remote agents):**

```
POST /mcp
Authorization: Bearer <jwt-or-api-key>
Content-Type: application/json
```

Uses the MCP Streamable HTTP transport. Each request creates a new session.

### Full tool list

| Category | Tools |
|---|---|
| Briefing | `briefing_get` |
| Context | `context_ingest_auto`, `context_ingest`, `context_raw_source_list`, `context_raw_source_get`, `context_raw_source_reprocess`, `context_add`, `context_get`, `context_list`, `context_lineage_get`, `context_signal_group_list`, `context_signal_group_get`, `context_signal_group_promote`, `context_signal_handoff`, `context_signal_group_reject`, `context_signal_promote`, `context_signal_reject`, `context_supersede`, `context_search`, `context_semantic_search`, `context_review`, `context_stale`, `context_diff`, `context_extract`, `context_stale_assign`, `context_embed_backfill` |
| Actors | `actor_register`, `actor_get`, `actor_list`, `actor_update`, `actor_whoami`, `actor_expertise` |
| Assignments | `assignment_create`, `assignment_get`, `assignment_list`, `assignment_update`, `assignment_accept`, `assignment_complete`, `assignment_decline`, `assignment_start`, `assignment_block`, `assignment_cancel` |
| HITL | `hitl_submit_request`, `hitl_check_status`, `hitl_list_pending`, `hitl_resolve` |
| Activities and Calendar | `activity_create`, `activity_get`, `activity_search`, `activity_add_context`, `activity_complete`, `activity_update`, `activity_get_timeline`, `calendar_connection_list`, `calendar_event_search`, `calendar_event_get`, `calendar_event_process`, `calendar_event_add_context`, `meeting_classification_list` |
| Contacts | `contact_create`, `contact_get`, `contact_search`, `contact_update`, `contact_set_lifecycle`, `contact_get_timeline`, `contact_get_opportunities`, `contact_score`, `contact_merge`, `contact_delete` |
| Accounts | `account_create`, `account_get`, `account_search`, `account_update`, `account_set_health_score`, `account_get_hierarchy`, `account_health_report`, `account_delete` |
| Opportunities | `opportunity_create`, `opportunity_get`, `opportunity_search`, `opportunity_advance_stage`, `opportunity_update`, `opportunity_delete` |
| Messaging | `message_channel_create`, `message_channel_update`, `message_channel_get`, `message_channel_delete`, `message_channel_list`, `message_send`, `message_delivery_get`, `message_delivery_search` |
| Use Cases | `use_case_create`, `use_case_get`, `use_case_search`, `use_case_update`, `use_case_delete`, `use_case_advance_stage`, `use_case_update_consumption`, `use_case_set_health`, `use_case_link_contact`, `use_case_unlink_contact`, `use_case_list_contacts`, `use_case_get_timeline`, `use_case_summary` |
| Registries | `activity_type_list`, `activity_type_add`, `activity_type_remove`, `context_type_list`, `context_type_add`, `context_type_remove` |
| Workflows | `workflow_create`, `workflow_get`, `workflow_update`, `workflow_delete`, `workflow_list`, `workflow_run_list` |
| Webhooks | `webhook_create`, `webhook_get`, `webhook_update`, `webhook_delete`, `webhook_list`, `webhook_list_deliveries` |
| Emails | `email_create`, `email_get`, `email_search`, `mailbox_connection_list`, `email_message_search`, `email_message_get`, `email_message_link`, `email_message_process`, `email_message_ignore`, `email_draft_preview`, `email_draft_save`, `email_ingest`, `email_provider_set`, `email_provider_get` |
| Email Sequences | `email_sequence_create`, `email_sequence_get`, `email_sequence_update`, `email_sequence_delete`, `email_sequence_list`, `email_sequence_enroll`, `email_sequence_unenroll`, `email_sequence_enrollment_list` |
| Custom Fields | `custom_field_create`, `custom_field_update`, `custom_field_delete`, `custom_field_list` |
| Record Resolution | `customer_record_resolve` |
| Compatibility | `entity_resolve` |
| Analytics | `crm_search`, `pipeline_summary`, `pipeline_forecast`, `account_health_report`, `tenant_get_stats` |
| Record Drafts | `record_draft_preview` |
| Operations | `ops_status_get`, `ops_job_recover`, `ops_data_quality_get`, `ops_data_quality_repair`, `ops_audit_get`, `ops_privacy_export`, `ops_pii_redact`, `ops_privacy_delete`, `ops_retention_apply` |
| Meta | `schema_get`, `guide_search` |

---

## REST API Reference

Most endpoints require `Authorization: Bearer <jwt-or-api-key>`. Authentication setup endpoints such as login and first-user registration are intentionally unauthenticated.

Base URL: `/api/v1`

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register a new user + tenant |
| POST | `/auth/login` | Login, receive JWT |
| GET | `/auth/api-keys` | List API keys |
| POST | `/auth/api-keys` | Create API key |
| DELETE | `/auth/api-keys/:id` | Revoke API key |
| POST | `/auth/register-agent` | Agent self-registration (returns actor + bound key) |

### Contacts

| Method | Path | Description |
|---|---|---|
| GET | `/contacts` | List/search contacts |
| POST | `/contacts` | Create contact |
| GET | `/contacts/:id` | Get contact |
| PATCH | `/contacts/:id` | Update contact |
| DELETE | `/contacts/:id` | Delete (admin/owner only) |
| GET | `/contacts/:id/timeline` | Activity timeline |

### Accounts

| Method | Path | Description |
|---|---|---|
| GET | `/accounts` | List/search accounts |
| POST | `/accounts` | Create account |
| GET | `/accounts/:id` | Get with contacts + opps |
| PATCH | `/accounts/:id` | Update account |
| DELETE | `/accounts/:id` | Delete (admin/owner only) |

### Opportunities

| Method | Path | Description |
|---|---|---|
| GET | `/opportunities` | List/search opps |
| POST | `/opportunities` | Create opportunity |
| GET | `/opportunities/:id` | Get with activities |
| PATCH | `/opportunities/:id` | Update or advance stage |
| DELETE | `/opportunities/:id` | Delete (admin/owner only) |

### Activities

| Method | Path | Description |
|---|---|---|
| GET | `/activities` | List/search activities |
| POST | `/activities` | Create activity |
| PATCH | `/activities/:id` | Update activity |

### Actors

| Method | Path | Description |
|---|---|---|
| GET | `/actors` | List actors |
| POST | `/actors` | Register actor |
| GET | `/actors/:id` | Get actor |
| PATCH | `/actors/:id` | Update actor (scopes, `is_active`, display name) |

> Actors are deactivated, not hard-deleted. Use `PATCH /actors/:id` with `{ "is_active": false }` to disable an actor.

### Assignments

| Method | Path | Description |
|---|---|---|
| GET | `/assignments` | List assignments |
| POST | `/assignments` | Create assignment |
| GET | `/assignments/:id` | Get assignment |
| PATCH | `/assignments/:id` | Update assignment |
| POST | `/assignments/:id/accept` | Accept |
| POST | `/assignments/:id/start` | Start |
| POST | `/assignments/:id/complete` | Complete |
| POST | `/assignments/:id/decline` | Decline |
| POST | `/assignments/:id/block` | Block |
| POST | `/assignments/:id/cancel` | Cancel |

### Context

| Method | Path | Description |
|---|---|---|
| GET | `/context` | List context entries |
| POST | `/context` | Advanced direct Memory/Signal write |
| GET | `/context/:id` | Get entry |
| POST | `/context/:id/supersede` | Supersede with updated content |
| POST | `/context/:id/review` | Mark as reviewed |
| GET | `/context/stale` | List stale entries |
| GET | `/context/search` | Full-text search |
| GET | `/context/semantic-search` | pgvector similarity search (`?q=`, `?subject_type=`, `?limit=`) |
| GET | `/context/raw-sources` | List Raw Context processing receipts |
| GET | `/context/raw-sources/:id` | Get one Raw Context receipt |
| POST | `/context/raw-sources/:id/reprocess` | Retry or reprocess a Raw Context source |
| GET | `/context/signal-groups` | List grouped Signals and readiness state |
| GET | `/context/signal-groups/:id` | Inspect a Signal group with evidence |
| POST | `/context/signal-groups/:id/promote` | Confirm a trusted Signal as Memory |
| POST | `/context/signal-groups/:id/handoff` | Send a Signal to Handoff review |
| POST | `/context/signal-groups/:id/reject` | Dismiss a Signal while preserving audit |
| GET | `/context/lineage` | Trace Raw Context through Signals, Memory, Handoffs, writebacks, and audit |
| POST | `/context/detect-subjects` | Detect customer records mentioned in text (`{ text }`) |
| POST | `/context/ingest` | Ingest context for a known subject (structured form) |
| POST | `/context/ingest-auto` | Ingest Raw Context and resolve or pin subjects automatically |
| POST | `/context/ingest-file` | Extract text from file and ingest (`{ filename, data (base64), source_label }`) |

### Briefings

| Method | Path | Description |
|---|---|---|
| GET | `/briefing/:subject_type/:subject_id` | Get full briefing for an object |

### Use Cases

| Method | Path | Description |
|---|---|---|
| GET | `/use-cases` | List/search |
| POST | `/use-cases` | Create |
| GET | `/use-cases/:id` | Get |
| PATCH | `/use-cases/:id` | Update or advance stage |
| DELETE | `/use-cases/:id` | Delete |
| POST | `/use-cases/:id/consumption` | Update consumption |
| POST | `/use-cases/:id/health` | Set health score |
| GET | `/use-cases/:id/contacts` | List linked contacts |
| POST | `/use-cases/:id/contacts` | Link contact |
| DELETE | `/use-cases/:ucId/contacts/:contactId` | Unlink contact |
| GET | `/use-cases/:id/timeline` | Activity timeline |

### Workflows

| Method | Path | Description |
|---|---|---|
| GET | `/workflows` | List workflows |
| POST | `/workflows` | Create |
| GET | `/workflows/:id` | Get with recent runs |
| PATCH | `/workflows/:id` | Update |
| DELETE | `/workflows/:id` | Delete |
| GET | `/workflows/:id/runs` | List execution runs |

### Webhooks

| Method | Path | Description |
|---|---|---|
| GET | `/webhooks` | List endpoints |
| POST | `/webhooks` | Register endpoint |
| GET | `/webhooks/:id` | Get endpoint |
| PATCH | `/webhooks/:id` | Update |
| DELETE | `/webhooks/:id` | Remove |
| GET | `/webhooks/:id/deliveries` | Delivery log |

### Emails

Customer Email is the mailbox-facing Raw Context layer. Connect Gmail, Outlook, or an inbound webhook so CRMy can capture customer-facing messages, filter internal-only email by default, associate conversations to accounts/contacts/opportunities/use cases, and process useful messages into Signals and Memory.

| Method | Path | Description |
|---|---|---|
| GET | `/emails` | List/search governed outbound email drafts and send history |
| POST | `/emails` | Draft a governed follow-up email |
| GET | `/emails/:id` | Get outbound email |
| GET | `/mailbox/connections` | List mailbox connections and customer-email processing summary |
| POST | `/mailbox/connections/:provider/start` | Start a Gmail or Outlook mailbox connection |
| POST | `/mailbox/connections/:id/sync` | Queue a mailbox sync job |
| GET | `/email-messages` | List canonical customer email messages |
| GET | `/email-messages/:id` | Get customer email message, linked records, and processing receipt |
| PATCH | `/email-messages/:id/classification` | Mark a message as customer, mixed, internal, automated, or unknown |
| PATCH | `/email-messages/:id` | Update classification and linked customer records |
| POST | `/email-messages/:id/process` | Process an email as Raw Context |
| POST | `/email-messages/:id/ignore` | Hide a message from review queues |
| POST | `/emails/draft-preview` | Generate an editable customer email draft preview |
| POST | `/emails/drafts` | Save a CRMy draft, request approval, or explicit send when allowed |

### Messaging Channels

| Method | Path | Description |
|---|---|---|
| GET | `/messaging/channels` | List channels |
| POST | `/messaging/channels` | Create channel |
| GET | `/messaging/channels/:id` | Get channel |
| PATCH | `/messaging/channels/:id` | Update channel |
| DELETE | `/messaging/channels/:id` | Delete channel |
| POST | `/messaging/send` | Send a message |
| GET | `/messaging/deliveries` | List deliveries |
| GET | `/messaging/deliveries/:id` | Get delivery status |

### Custom Fields

| Method | Path | Description |
|---|---|---|
| GET | `/custom-fields` | List (requires `object_type`) |
| POST | `/custom-fields` | Create definition |
| PATCH | `/custom-fields/:id` | Update definition |
| DELETE | `/custom-fields/:id` | Remove definition |

### HITL

| Method | Path | Description |
|---|---|---|
| GET | `/hitl` | List pending requests |
| POST | `/hitl` | Submit request |
| GET | `/hitl/:id` | Check status |
| POST | `/hitl/:id/resolve` | Approve or reject |

### Analytics

| Method | Path | Description |
|---|---|---|
| GET | `/analytics/pipeline` | Pipeline summary |
| GET | `/analytics/forecast` | Pipeline forecast |
| GET | `/analytics/use-cases` | Use case summary |

### Events

| Method | Path | Description |
|---|---|---|
| GET | `/events` | Audit log |

### Search & Identity

| Method | Path | Description |
|---|---|---|
| GET | `/search` | Cross-entity search (requires `q`) |
| POST | `/resolve` | Resolve a name/abbreviation to a contact or account ID. Body: `{ query, entity_type?, actor_id?, context_hints?, limit? }` |

---

## Database & Migrations

### Running migrations

```bash
npx -y @crmy/cli migrate run      # apply pending migrations
npx -y @crmy/cli migrate status   # show migration status
```

Migrations run automatically on server startup and during `crmy init`.

### Migration files

Located in `packages/server/migrations/`:

| File | Tables |
|---|---|
| 001_core.sql | tenants, users, contacts, accounts, opportunities, activities |
| 002_auth.sql | api_keys |
| 003_hitl.sql | hitl_requests |
| 004_events.sql | events |
| 005_use_cases.sql | use_cases, use_case_contacts |
| 006_webhooks.sql | webhook_endpoints, webhook_deliveries |
| 007_email.sql | email_providers, emails, email_sequences, sequence_enrollments |
| 008_custom_fields.sql | custom_field_definitions |
| 009_bulk.sql | bulk_jobs |
| 010_notes.sql | notes |
| 011_workflows.sql | workflows, workflow_runs |
| 012_actors.sql | actors, actor scopes, actor↔user bridge |
| 013_assignments.sql | assignments, assignment status history |
| 014_context.sql | context_entries, context type registry, FTS indexes |
| 015_activity_types.sql | activity type registry, default types seed |
| 016_governor.sql | governor_limits, plan defaults |
| 017_agent.sql | agent_configs, agent sessions |
| 018_extraction.sql | context extraction pipeline |
| 018_identity_resolution.sql | identity resolution tables |
| 020_agent_activity.sql | agent tool call activity log |
| 021_context_priorities.sql | context entry priority weights |
| 022_pgvector.sql | pgvector embedding column (conditional) |
| 023_messaging_channels.sql | messaging_channels, message_deliveries |
| 024_messaging_default.sql | is_default column + unique partial index |
