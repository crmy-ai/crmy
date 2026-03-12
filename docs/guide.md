# CRMy User Guide

Complete documentation for CRMy — the agent-first open source CRM.

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
9. [Activities](#activities)
10. [Use Cases](#use-cases)
11. [Notes & Comments](#notes--comments)
12. [Workflows & Automation](#workflows--automation)
13. [Webhooks](#webhooks)
14. [Email](#email)
15. [Custom Fields](#custom-fields)
16. [HITL (Human-in-the-Loop)](#hitl-human-in-the-loop)
17. [Analytics & Reporting](#analytics--reporting)
18. [Plugins](#plugins)
19. [REST API Reference](#rest-api-reference)
20. [MCP Tools Reference](#mcp-tools-reference)
21. [Database & Migrations](#database--migrations)

---

## Getting Started

### Install

```bash
npm install -g crmy
```

Or use with npx (no install):

```bash
npx crmy init
```

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL >= 14

### Quick setup — Local mode

```bash
# 1. Initialize (interactive — sets up DB, user, API key)
npx crmy init

# 2. Start the server (REST API + Web UI at /app)
npx crmy server

# 3. Add to Claude Code as an MCP server
claude mcp add crmy -- npx crmy mcp
```

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
| `CRMY_API_KEY` | No | — | API key for CLI auth (overrides .crmy.json) |
| `CRMY_SERVER_URL` | No | — | Server URL for remote CLI mode |

---

## Authentication

CRMy supports multiple authentication methods across the CLI, Web UI, and API.

### CLI Authentication

#### Local mode (direct database)

When you run `crmy init`, the CLI connects directly to PostgreSQL. An API key is generated and stored in `.crmy.json`. No server is needed — all commands run MCP tools in-process.

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

### Roles

- `owner` — full access, can manage users and keys
- `admin` — full access to CRM data, can delete records
- `member` — standard access, cannot delete

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

#### Dashboard (`/app`)

Four stat cards at the top: Pipeline Value, Open Deals, Active Use Cases, HITL Pending.

Below that, a **Use Case stage summary strip** showing count and attributed ARR per stage. Click any stage to filter the use cases list.

Bottom section shows the 10 most recent activities.

#### Contacts (`/app/contacts`)

- **List**: searchable table with name, email, company, lifecycle stage
- **Create** (`/app/contacts/new`): form for first name, last name, email, phone, title, company, stage
- **Detail** (`/app/contacts/:id`): contact info, activity timeline, and linked use cases section

#### Accounts (`/app/accounts`)

- **List**: searchable table with name, industry, revenue, employees, health score
- **Create** (`/app/accounts/new`): name, domain, industry, website
- **Detail** (`/app/accounts/:id`): account info with tabs:
  - **Overview**: details, contacts, opportunities
  - **Use Cases**: list with consumption bars, health badges, and total attributed ARR

#### Pipeline (`/app/pipeline`)

Kanban-style board with columns for each opportunity stage (prospecting through closed). Each card shows deal name, amount, and close date.

#### Opportunities (`/app/opportunities/:id`)

Detail view with tabs:
- **Details**: stage, amount, probability, forecast category
- **Use Cases**: linked use cases with attributed ARR total

#### Use Cases (`/app/use-cases`)

- **List**: table with stage filter, consumption progress bars, health badges
- **Create** (`/app/use-cases/new`): full form with account selection, stage, consumption unit/capacity, ARR, dates
- **360 Detail** (`/app/use-cases/:id`): the most comprehensive page:

**Stage bar**: horizontal bar showing all stages. Current stage highlighted. Click another stage to open the advance modal (note required for sunset).

**Left panel**:
- Account and opportunity links
- Revenue: attributed ARR and expansion potential
- Consumption bar: green < 70%, amber 70–90%, red > 90% — with edit modal
- Health badge: colored score with note — with update modal (note required)
- Contacts: list with role badges, add/remove functionality

**Right panel**: activity timeline

#### Analytics (`/app/analytics`)

- Pipeline by stage (deal count + value)
- Forecast summary
- Use case ARR by stage
- Use case ARR by account
- Health distribution (healthy / at-risk / critical)

#### HITL Queue (`/app/hitl`)

Cards for each pending approval request showing:
- Action type and agent ID
- Submission time and expiration
- Action summary
- Expandable payload viewer
- Note input + Approve/Reject buttons
- Empty state: "No pending approvals — your agents are running autonomously"

Polls every 10 seconds.

#### Settings (`/app/settings`)

Tabbed interface:
- **Profile**: name, email, role (read-only)
- **API Keys**: create new keys (shown once), list existing, revoke
- **Webhooks**: add endpoint URL + event types, list existing, delete
- **Custom Fields**: tabbed by object type (contact, account, opportunity, activity, use_case) — create field definitions, list, delete

---

## Core Concepts

### MCP-First Architecture

All CRM operations are defined as **MCP tools**. The REST API and CLI are thin wrappers that call the same tool handlers. This means any AI agent that speaks MCP has full CRM access.

**Three ways to interact:**

1. **MCP (stdio)** — `crmy mcp` starts an MCP server over stdio for Claude Code
2. **MCP (HTTP)** — `POST /mcp` endpoint for remote MCP clients (Streamable HTTP transport)
3. **REST API** — `GET/POST/PATCH/DELETE /api/v1/*` endpoints for traditional integrations
4. **CLI** — `crmy <command>` for terminal workflows

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
| `contact_create` | Create a contact. Required: `first_name`. Optional: `last_name`, `email`, `phone`, `title`, `company_name`, `account_id`, `lifecycle_stage`, `tags`, `custom_fields`, `source` |
| `contact_get` | Get a contact by ID |
| `contact_search` | Search with filters: `query`, `lifecycle_stage`, `account_id`, `owner_id`, `tags` |
| `contact_update` | Patch any fields via `{ id, patch: { ... } }` |
| `contact_set_lifecycle` | Change stage with optional `reason` |
| `contact_log_activity` | Log a call, email, meeting, note, or task for a contact |
| `contact_get_timeline` | Get the activity timeline with optional type filter |

### CLI

```bash
crmy contacts list --q "sarah"
crmy contacts create          # interactive
crmy contacts get <id>
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

Accounts represent companies or organizations. Accounts can have parent/child hierarchies, health scores, and linked contacts and opportunities.

### MCP tools

| Tool | Description |
|---|---|
| `account_create` | Create an account. Required: `name`. Optional: `domain`, `industry`, `employee_count`, `annual_revenue`, `currency_code`, `website`, `parent_id`, `tags`, `custom_fields` |
| `account_get` | Get account with its contacts and open opportunities |
| `account_search` | Search with filters: `query`, `industry`, `owner_id`, `min_revenue`, `tags` |
| `account_update` | Patch any fields |
| `account_set_health_score` | Set score (0-100) with `rationale` |
| `account_get_hierarchy` | Get parent/child tree |

### CLI

```bash
crmy accounts list
crmy accounts get <id>
```

### REST API

```
GET    /api/v1/accounts?q=acme&industry=tech
POST   /api/v1/accounts
GET    /api/v1/accounts/:id
PATCH  /api/v1/accounts/:id
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
| `pipeline_summary` | Aggregate pipeline by `stage`, `owner`, or `forecast_cat` |

### CLI

```bash
crmy opps list --stage proposal
crmy opps advance <id> negotiation
crmy pipeline
```

### REST API

```
GET    /api/v1/opportunities?stage=proposal
POST   /api/v1/opportunities
GET    /api/v1/opportunities/:id
PATCH  /api/v1/opportunities/:id    { stage: "negotiation", note: "..." }
GET    /api/v1/analytics/pipeline?group_by=stage
GET    /api/v1/analytics/forecast?period=quarter
```

---

## Activities

Activities are logged interactions: calls, emails, meetings, notes, and tasks.

### Activity types

`call` | `email` | `meeting` | `note` | `task`

### MCP tools

| Tool | Description |
|---|---|
| `activity_create` | Create an activity. Required: `type`, `subject`. Optional: `body`, `contact_id`, `account_id`, `opportunity_id`, `due_at`, `direction` (inbound/outbound) |
| `activity_get` | Get by ID |
| `activity_search` | Filter by `contact_id`, `account_id`, `opportunity_id`, `type` |
| `activity_complete` | Mark as completed with optional timestamp and note |
| `activity_update` | Patch `subject`, `body`, `status`, `due_at` |

### REST API

```
GET    /api/v1/activities?contact_id=...&type=call
POST   /api/v1/activities
PATCH  /api/v1/activities/:id
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
crmy use-cases list --account <id>
crmy use-cases create
crmy use-cases summary --group-by stage
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

---

## Notes & Comments

Threaded notes on any CRM entity. Supports internal vs external visibility, @mentions, and pinned notes.

### Object types

Notes can be attached to: `contact`, `account`, `opportunity`, `activity`, `use_case`

### Visibility

- `internal` (default) — only visible to team members
- `external` — visible to customers (in future portal)

### Threading

Set `parent_id` when creating a note to reply to an existing note. Replies are returned when you `note_get` a parent.

### MCP tools

| Tool | Description |
|---|---|
| `note_create` | Add a note. Required: `object_type`, `object_id`, `body`. Optional: `parent_id`, `visibility`, `mentions`, `pinned` |
| `note_get` | Get note with threaded replies |
| `note_update` | Update `body`, `visibility`, or `pinned` status |
| `note_delete` | Delete note and its replies |
| `note_list` | List notes for an object. Pinned notes appear first. Filter by `visibility` or `pinned` |

### CLI

```bash
crmy notes list contact <contact-id>
crmy notes add account <account-id> --pin
crmy notes add contact <id> --parent <note-id>    # threaded reply
crmy notes get <note-id>
crmy notes delete <note-id>
```

### REST API

```
GET    /api/v1/notes?object_type=contact&object_id=...&visibility=internal
POST   /api/v1/notes              { object_type, object_id, body, ... }
GET    /api/v1/notes/:id
PATCH  /api/v1/notes/:id          { body, pinned }
DELETE /api/v1/notes/:id
```

---

## Workflows & Automation

Event-driven automation. Workflows trigger on CRM events and execute a sequence of actions.

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
| `send_notification` | Emit a notification event (picked up by plugins like Slack) |
| `create_activity` | Create a follow-up task or activity |
| `create_note` | Add a note to the triggering object |
| `add_tag` | Add a tag to the object |
| `remove_tag` | Remove a tag |
| `assign_owner` | Change the owner |
| `update_field` | Update a field on the object |
| `webhook` | Fire an outbound HTTP request |

### Example: notify on closed-won deals

```json
{
  "name": "Celebrate closed deals",
  "trigger_event": "opportunity.stage_changed",
  "trigger_filter": { "stage": "closed_won" },
  "actions": [
    {
      "type": "send_notification",
      "config": { "channel": "slack", "message": "Deal closed!" }
    },
    {
      "type": "create_activity",
      "config": { "type": "task", "subject": "Schedule kickoff call" }
    }
  ]
}
```

### Run tracking

Every workflow execution creates a `workflow_run` record with:

- `status`: running, completed, failed
- `actions_run` / `actions_total`
- `error` (if failed)
- Timestamps

### MCP tools

| Tool | Description |
|---|---|
| `workflow_create` | Create a workflow with trigger, filter, and actions |
| `workflow_get` | Get workflow with 5 most recent runs |
| `workflow_update` | Update name, trigger, filter, actions, or active status |
| `workflow_delete` | Delete workflow and run history |
| `workflow_list` | List workflows. Filter by `trigger_event` or `is_active` |
| `workflow_run_list` | List runs for a workflow. Filter by `status` |

### CLI

```bash
crmy workflows list --active
crmy workflows create         # interactive
crmy workflows get <id>
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

## Email

Draft and send outbound emails with built-in HITL approval.

When `require_approval` is true (default), creating an email automatically submits a HITL request. The email is sent only after approval.

### MCP tools

| Tool | Description |
|---|---|
| `email_create` | Draft an email. Required: `to_address`, `subject`. Optional: `body_html`, `body_text`, `contact_id`, `account_id`, `opportunity_id`, `use_case_id`, `require_approval` |
| `email_get` | Get email by ID |
| `email_search` | Search by `contact_id`, `status` |

### Email statuses

`draft` → `pending_approval` → `approved` → `sending` → `sent`

Also: `failed`, `rejected`

### CLI

```bash
crmy emails create           # interactive
crmy emails list --status pending_approval
crmy emails get <id>
```

### REST API

```
GET    /api/v1/emails?contact_id=...&status=sent
POST   /api/v1/emails
GET    /api/v1/emails/:id
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

## HITL (Human-in-the-Loop)

Approval workflows for high-impact actions. Agents submit requests; humans approve or reject.

### How it works

1. Agent calls `hitl_submit_request` with action details
2. Request enters `pending` status
3. Human reviews via CLI (`crmy hitl list`) or REST API
4. Human approves or rejects with optional note
5. Agent checks status with `hitl_check_status`

### Auto-approval

Set `auto_approve_after_seconds` to auto-approve if no human responds within the timeout. A background worker checks every 60 seconds.

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
      module: './plugins/slack-notifier.js',
      options: {
        webhookUrl: 'https://hooks.slack.com/services/...',
        channel: '#crm-alerts',
        events: ['opportunity.stage_changed', 'hitl.submitted'],
      },
    },
  ],
};
```

### Sample plugin: Slack notifier

A built-in sample plugin at `packages/server/src/plugins/slack-notifier.ts` posts notifications to Slack on configurable events.

```typescript
import slackNotifier from './plugins/slack-notifier.js';

// The plugin is a factory function:
const plugin = slackNotifier({
  webhookUrl: 'https://hooks.slack.com/services/...',
  channel: '#crm-alerts',
  events: ['opportunity.stage_changed', 'hitl.submitted', 'workflow.notification'],
});
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
      // React to CRM events
      if (event.event_type === 'contact.created') {
        // do something
      }
    },
  };
}
```

---

## REST API Reference

All endpoints require `Authorization: Bearer <jwt-or-api-key>`.

Base URL: `/api/v1`

### Contacts

| Method | Path | Description |
|---|---|---|
| GET | `/contacts` | List/search contacts |
| POST | `/contacts` | Create contact |
| GET | `/contacts/:id` | Get contact |
| PATCH | `/contacts/:id` | Update contact |
| DELETE | `/contacts/:id` | Delete (admin only) |
| GET | `/contacts/:id/timeline` | Activity timeline |

### Accounts

| Method | Path | Description |
|---|---|---|
| GET | `/accounts` | List/search accounts |
| POST | `/accounts` | Create account |
| GET | `/accounts/:id` | Get with contacts + opps |
| PATCH | `/accounts/:id` | Update account |

### Opportunities

| Method | Path | Description |
|---|---|---|
| GET | `/opportunities` | List/search opps |
| POST | `/opportunities` | Create opportunity |
| GET | `/opportunities/:id` | Get with activities |
| PATCH | `/opportunities/:id` | Update or advance stage |

### Activities

| Method | Path | Description |
|---|---|---|
| GET | `/activities` | List/search activities |
| POST | `/activities` | Create activity |
| PATCH | `/activities/:id` | Update activity |

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

### Notes

| Method | Path | Description |
|---|---|---|
| GET | `/notes` | List (requires `object_type` + `object_id`) |
| POST | `/notes` | Create |
| GET | `/notes/:id` | Get with replies |
| PATCH | `/notes/:id` | Update |
| DELETE | `/notes/:id` | Delete with replies |

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

| Method | Path | Description |
|---|---|---|
| GET | `/emails` | List/search emails |
| POST | `/emails` | Create/draft email |
| GET | `/emails/:id` | Get email |

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

### Search

| Method | Path | Description |
|---|---|---|
| GET | `/search` | Cross-entity search (requires `q`) |

---

## MCP Tools Reference

See [mcp-tools.md](mcp-tools.md) for the original v0.1 tool reference. All v0.2 and v0.3 tools follow the same patterns documented above in each feature section.

### MCP connection

**Stdio (Claude Code):**

```bash
claude mcp add crmy -- npx crmy mcp
```

**HTTP (remote):**

```
POST /mcp
Authorization: Bearer <jwt-or-api-key>
Content-Type: application/json
```

Uses the MCP Streamable HTTP transport. Each request creates a new session.

---

## Database & Migrations

### Running migrations

```bash
npx crmy migrate run      # apply pending migrations
npx crmy migrate status   # show migration status
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
