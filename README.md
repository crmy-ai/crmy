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

### Prerequisites

- Node.js >= 20
- PostgreSQL >= 14

### 1. Deploy

```bash
# Docker (fastest — starts PostgreSQL + server together)
docker compose -f docker/docker-compose.yml up -d

# Or with npm
npm install -g @crmy/cli
npx @crmy/cli init     # connect to PostgreSQL, run migrations, create admin account
npx @crmy/cli server   # starts on :3000
```

### 2. Connect via MCP

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

Once connected, your agent has access to 80+ MCP tools. No API calls, no auth wiring — just tool calls.

### 3. Get a briefing before every action

Via MCP:

```
briefing_get { subject_type: "contact", subject_id: "<id>" }
```

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

### 4. Write activities after every interaction

Via MCP:

```
activity_create {
  type: "discovery_call",
  subject: "Q2 discovery with Sarah Chen",
  body: "Discussed budget, timeline, and technical fit.",
  contact_id: "...",
  outcome: "Champion identified. Pricing concern raised.",
  occurred_at: "2026-03-24T14:00:00Z"
}
```

Via CLI:

```bash
crmy activities create
```

CRMy auto-extracts context entries from activities when an LLM backend is configured.

### 5. Add context explicitly

Via MCP:

```
context_add {
  subject_type: "contact",
  subject_id: "...",
  context_type: "objection",
  body: "Concerned about procurement timeline — deal may slip to Q3",
  confidence: 0.85,
  valid_until: "2026-04-30",
  tags: ["pricing", "timeline"]
}
```

Via CLI:

```bash
crmy context add
```

Context entries are typed, tagged, versioned (supersede when beliefs change), and full-text searchable.

### 6. Escalate to a human when needed

Via MCP:

```
hitl_submit_request {
  action_type: "send_proposal",
  action_summary: "Send $180K proposal to Sarah Chen at Acme Corp",
  action_payload: { ... },
  auto_approve_after_seconds: 3600
}
```

Via CLI:

```bash
crmy hitl list
crmy hitl approve <id>
```

Poll `hitl_check_status` or check the HITL queue in the web UI. Proceed only on `approved`.

### 7. Register your agent

Agents self-register — no admin setup required. Via MCP:

```
actor_register {
  display_name: "Outreach Agent",
  agent_identifier: "outreach-v1",
  agent_model: "claude-sonnet-4-20250514",
  requested_scopes: ["contacts:read", "activities:write", "context:write", "assignments:create"]
}
```

Via CLI:

```bash
crmy actors register
```

Call again with the same `agent_identifier` and you get the same actor back — idempotent. Admins can adjust scopes from **Settings → Actors**.

---

## Agent workflow example

```
1. agent: briefing_get { subject_type: "contact", subject_id: "abc" }
   ← record + recent activities + open assignments + typed context + stale warnings

2. agent: activity_create { type: "discovery_call", outcome: "Champion identified" }
   → activity logged; extraction pipeline creates context entries automatically

3. agent: context_add { context_type: "objection", body: "...", confidence: 0.9 }
   → stored, tagged, searchable; visible in future briefings

4. agent: assignment_create { title: "Send proposal", assignee_actor_id: "<rep-id>" }
   → appears in the rep's assignment queue

5. human: briefing_get { subject_type: "contact", ... }
   ← same context the agent built, plus the open assignment

6. human: assignment_complete { outcome: "Proposal sent" }
   → logged to audit trail; context entry written
```

---

## Context Engine

Four primitives that form the agent's shared workspace:

| Primitive | What it does |
|-----------|-------------|
| **Actors** | First-class identity for humans and AI agents. Every action is attributed to an actor. Agents self-register — no admin setup. |
| **Activities** | Everything that happened — calls, emails, meetings. Structured `detail` payloads, polymorphic subjects, retroactive `occurred_at` timestamps, and auto-extraction into context entries. |
| **Assignments** | Structured handoffs. Agents create assignments for humans; humans create assignments for agents. Stateful lifecycle: `pending → accepted → in_progress → completed`. |
| **Context Entries** | The memory layer. Typed, tagged, versioned knowledge attached to any CRM object. Supersede stale beliefs. Confidence scores. Full-text search. `valid_until` staleness tracking. |

---

## MCP Tools (80+)

| Category | Tools |
|---|---|
| **Briefing** | `briefing_get` |
| **Context** | `context_add`, `context_get`, `context_list`, `context_supersede`, `context_search`, `context_review`, `context_stale` |
| **Actors** | `actor_register`, `actor_get`, `actor_list`, `actor_update`, `actor_whoami` |
| **Assignments** | `assignment_create`, `assignment_get`, `assignment_list`, `assignment_update`, `assignment_accept`, `assignment_complete`, `assignment_decline`, `assignment_start`, `assignment_block`, `assignment_cancel` |
| **HITL** | `hitl_submit_request`, `hitl_check_status`, `hitl_list_pending`, `hitl_resolve` |
| Activities | `activity_create`, `activity_get`, `activity_search`, `activity_complete`, `activity_update`, `activity_get_timeline` |
| Contacts | `contact_create`, `contact_get`, `contact_search`, `contact_update`, `contact_set_lifecycle`, `contact_log_activity`, `contact_get_timeline`, `contact_delete` |
| Accounts | `account_create`, `account_get`, `account_search`, `account_update`, `account_set_health_score`, `account_get_hierarchy`, `account_delete` |
| Opportunities | `opportunity_create`, `opportunity_get`, `opportunity_search`, `opportunity_advance_stage`, `opportunity_update`, `opportunity_delete`, `pipeline_summary` |
| Use Cases | `use_case_create`, `use_case_get`, `use_case_search`, `use_case_update`, `use_case_delete`, `use_case_advance_stage`, `use_case_update_consumption`, `use_case_set_health`, `use_case_link_contact`, `use_case_unlink_contact`, `use_case_list_contacts`, `use_case_get_timeline`, `use_case_summary` |
| Registries | `activity_type_list`, `activity_type_add`, `activity_type_remove`, `context_type_list`, `context_type_add`, `context_type_remove` |
| Notes | `note_create`, `note_get`, `note_update`, `note_delete`, `note_list` |
| Workflows | `workflow_create`, `workflow_get`, `workflow_update`, `workflow_delete`, `workflow_list`, `workflow_run_list` |
| Webhooks | `webhook_create`, `webhook_get`, `webhook_update`, `webhook_delete`, `webhook_list`, `webhook_list_deliveries` |
| Emails | `email_create`, `email_get`, `email_search` |
| Custom Fields | `custom_field_create`, `custom_field_update`, `custom_field_delete`, `custom_field_list` |
| Analytics | `crm_search`, `pipeline_forecast`, `account_health_report` |
| Meta | `schema_get`, `tenant_get_stats` |

---

## CLI Reference

```
Setup & Server
npx @crmy/cli init                       Interactive setup (DB, migrations, admin account)
npx @crmy/cli server [--port 3000]       Start HTTP server + Web UI
npx @crmy/cli mcp                        Start stdio MCP server

Authentication
crmy auth setup [url]                    Configure server URL
crmy auth login                          Sign in (stores JWT)
crmy auth status                         Show auth state + token expiry
crmy auth logout                         Clear stored credentials

Contacts
crmy contacts list [--q <query>]         List contacts
crmy contacts create                     Interactive create
crmy contacts get <id>                   Get contact details
crmy contacts delete <id>                Delete (admin/owner only)

Accounts
crmy accounts list                       List accounts
crmy accounts create                     Interactive create
crmy accounts get <id>                   Get account + contacts + opps
crmy accounts delete <id>                Delete (admin/owner only)

Opportunities
crmy opps list [--stage <s>]             List opportunities
crmy opps get <id>                       Get opportunity details
crmy opps create                         Interactive create
crmy opps advance <id> <stage>           Advance opportunity stage
crmy opps delete <id>                    Delete (admin/owner only)

Use Cases
crmy use-cases list                      List use cases
crmy use-cases get <id>                  Get use case details
crmy use-cases create                    Interactive create
crmy use-cases summary                   Use case summary
crmy use-cases delete <id>               Delete (admin/owner only)

Actors
crmy actors list [--type <t>]            List actors (humans & agents)
crmy actors register                     Interactive actor registration
crmy actors get <id>                     Get actor details
crmy actors whoami                       Show current actor identity

Assignments
crmy assignments list [--mine]           List assignments
crmy assignments create                  Interactive create
crmy assignments get <id>                Get assignment details
crmy assignments accept <id>             Accept a pending assignment
crmy assignments start <id>              Start working on an assignment
crmy assignments complete <id>           Complete an assignment
crmy assignments decline <id>            Decline an assignment
crmy assignments block <id>              Mark as blocked
crmy assignments cancel <id>             Cancel an assignment

Context
crmy context list [--subject-type <t>] [--subject-id <id>]
crmy context add                         Add context about a CRM object
crmy context get <id>                    Get context entry
crmy context supersede <id>              Supersede with updated content
crmy context search <query>              Full-text search across context
crmy context review <id>                 Mark entry as still accurate
crmy context stale                       List stale entries needing review

Briefing
crmy briefing <type:UUID>                Get a full briefing for an object

HITL
crmy hitl list                           Pending HITL requests
crmy hitl approve <id>                   Approve request
crmy hitl reject <id> [--note]           Reject request

Workflows
crmy workflows list                      List automation workflows
crmy workflows get <id>                  Get workflow + recent runs
crmy workflows create                    Interactive create
crmy workflows delete <id>               Delete workflow
crmy workflows runs <id>                 Execution history

Webhooks
crmy webhooks list                       List webhook endpoints
crmy webhooks create                     Register new webhook
crmy webhooks delete <id>                Remove webhook
crmy webhooks deliveries                 Delivery log

Other
crmy pipeline                            Pipeline summary
crmy search <query>                      Cross-entity search
crmy events [--object <id>]              Audit log
crmy config show                         Show config
crmy migrate run                         Run migrations
crmy migrate status                      Migration status
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

API key scopes are checked before every tool handler. JWT users (human login) bypass scoping and always have full access.

---

## Architecture

```
packages/
  shared/   @crmy/shared   TypeScript types, Zod schemas
  server/   @crmy/server   Express + PostgreSQL + MCP Streamable HTTP
  cli/      @crmy/cli      Local CLI + stdio MCP server
  web/      @crmy/web      React SPA at /app
docker/                    Dockerfile + docker-compose.yml
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
| `JWT_SECRET` | Yes | — | JWT signing secret |
| `PORT` | No | `3000` | HTTP port |
| `CRMY_TENANT_ID` | No | `default` | Tenant slug |
| `CRMY_API_KEY` | No | — | API key for CLI auth |
| `CRMY_SERVER_URL` | No | — | Remote server URL for CLI |

---

## Web UI

Available at `/app` when the server is running. Useful for human review, HITL approvals, and managing agents — not the primary interface for agent builders.

| Page | What it does |
|------|-------------|
| Dashboard | Pipeline stats, recent activity feed |
| Contacts / Accounts / Pipeline | Standard CRM views |
| Use Cases | Consumption-based workload tracking (discovery → poc → production → scaling → sunset) |
| Assignments | Work queue with My Queue / Delegated / All tabs |
| HITL Queue | Approve or reject pending agent action requests |
| Settings | API keys, actors, webhooks, custom fields |

Docker default credentials: `admin@crmy.ai` / `admin` — change after first login.

---

## Develop from source

```bash
git clone https://github.com/codycharris/crmy.git
cd crmy
npm install
npm run build
npm run dev     # starts server with tsx watch
```

---

## Documentation

See [docs/guide.md](docs/guide.md) for the complete developer reference: agent builder quickstart, Context Engine deep dive, REST API reference, scope enforcement, governor limits, plugin development, workflow configuration, and more.

## License

Apache-2.0
