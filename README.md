# CRMy

An agent-first open source CRM with a built-in Context Engine for agent-human GTM coordination. MCP-native. Works with any PostgreSQL.

---

## Before you start

You need two things installed on your machine before setting up CRMy:

### 1. Node.js (version 20 or newer)

Check if you have it:
```bash
node --version
```

If not installed, download it from [nodejs.org](https://nodejs.org) — pick the **LTS** version.

### 2. PostgreSQL (version 14 or newer)

CRMy stores all data in a PostgreSQL database. You have a few options:

| Option | Best for | Notes |
|--------|----------|-------|
| **Local install** | Development | [postgresql.org/download](https://www.postgresql.org/download/) |
| **Docker** | Quick local setup | `docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16` |
| **Supabase** | Cloud, free tier available | [supabase.com](https://supabase.com) — free PostgreSQL in the cloud |
| **Neon** | Cloud, serverless | [neon.tech](https://neon.tech) — free tier available |

Once PostgreSQL is running, you'll need a connection string that looks like:
```
postgresql://username:password@localhost:5432/crmy
```

---

## Install

```bash
npm install -g @crmy/core
```

Or run without installing (downloads automatically each time):
```bash
npx crmy init
```

---

## Getting started

### Step 1 — Run setup

```bash
npx crmy init
```

This walks you through an interactive setup:
- Connects to your PostgreSQL database (you'll paste your connection string)
- Creates all the tables CRMy needs (migrations run automatically)
- Creates your first user account (email + password)
- Generates an API key stored in `.crmy.json`

### Step 2 — Start the server

```bash
npx crmy server
```

The server starts on port 3000. You'll see:
```
CRMy server running on http://localhost:3000
Web UI: http://localhost:3000/app
```

### Step 3 — Open the web interface

Visit **[http://localhost:3000/app](http://localhost:3000/app)** in your browser.

Log in with the email and password you set in Step 1.

You'll land on the Dashboard. From there you can:
- Add contacts, accounts, and opportunities
- View the pipeline board
- Check the HITL approval queue
- Manage settings, API keys, and actors

### Step 4 — Connect to Claude Code (optional)

To give Claude access to your CRM via MCP tools:

```bash
claude mcp add crmy -- npx crmy mcp
```

Then in Claude Code, you can say things like:
> "Create a contact for Sarah Chen at Acme Corp, set her stage to prospect, and log a call we had today about their Q2 budget"

Claude will use the CRMy MCP tools to create the contact and log the activity directly in your CRM.

---

## Docker (fastest option)

If you have Docker installed, this starts everything — PostgreSQL and the CRMy server — with one command:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Then open [http://localhost:3000/app](http://localhost:3000/app).

Default credentials when using Docker:
- **Email**: `admin@crmy.ai`
- **Password**: `admin`

Change these after first login in Settings → Profile.

---

## Connect to a remote server

If someone else is running a CRMy server and you want to connect your CLI to it:

```bash
# Tell the CLI where the server is
crmy auth setup https://crm.yourcompany.com

# Log in with your email + password
crmy login

# Now CLI commands go to that server
crmy contacts list
```

---

## Web UI overview

The web interface is available at `/app` when the server is running.

| Page | What it does |
|------|-------------|
| **Dashboard** | Stat cards (pipeline, deals, use cases, pending approvals), stage strip, recent activity |
| **Contacts** | List, search, create, and view contacts with activity timelines |
| **Accounts** | Companies with health scores, contacts, opportunities, and use cases |
| **Pipeline** | Kanban board for tracking deals through stages |
| **Use Cases** | Track consumption-based workloads (discovery → poc → production → scaling → sunset) |
| **Assignments** | Queue of work items with My Queue / Delegated / All tabs |
| **Analytics** | Pipeline by stage, forecast, use case health distribution |
| **HITL Queue** | Approve or reject agent actions before they execute |
| **Settings** | API keys, webhooks, custom fields, and the Actors panel |

---

## Context Engine

The Context Engine is what makes CRMy agent-first — a shared workspace where AI agents and humans coordinate GTM workflows.

Four building blocks:

| Primitive | What it captures |
|-----------|-----------------|
| **Actors** | Who is doing things — humans and AI agents as first-class identities |
| **Activities** | Everything that happened, with structured payloads, retroactive timestamps, and outcome tracking |
| **Assignments** | Structured handoffs — "agent A should do X about contact Y by Thursday" |
| **Context Entries** | The memory layer — typed, searchable, tagged knowledge attached to any CRM object |

### Agent workflow example

```
1. Agent logs a discovery call (activity_create)
2. Agent stores key takeaways as context entries (context_add × 3, with tags and confidence scores)
3. Agent assigns follow-up to a human rep (assignment_create)
4. Human gets a full briefing on the contact (briefing_get)
   — sees record, related objects, activities, open assignments, context grouped by type, stale warnings
5. Human sends the proposal and completes the assignment (assignment_complete)
6. Agent searches context for competitor mentions later (context_search)
```

---

## Authentication

### Log in via web or CLI

```bash
# Web UI: visit /app/login
# CLI:
crmy auth setup http://localhost:3000
crmy login
```

### API keys

Create API keys for agents and integrations:

```bash
# During init, a key is auto-generated in .crmy.json
# Create additional keys via REST:
POST /auth/api-keys  { "label": "my-agent", "scopes": ["contacts:read", "activities:write"] }
```

The key is shown **once** — copy and store it securely. Use it in API calls:
```
Authorization: Bearer crmy_abc123...
```

### Scope-limited keys

API keys can be restricted to specific capabilities:

| Scope | What it allows |
|-------|---------------|
| `*` | Everything (full access) |
| `read` | Read all resources |
| `write` | Write all resources |
| `contacts:read` | Read contacts only |
| `contacts:write` | Create/update contacts |
| `activities:write` | Log activities |
| `context:read` / `context:write` | Read/write context entries |
| *(and more — see [docs/guide.md](docs/guide.md))* | |

A key with `["contacts:read", "activities:write"]` can read contacts and log activities, but cannot create new contacts or access other resources.

### Agent self-registration

Agents can register themselves without admin setup:

```
POST /auth/register-agent
Authorization: Bearer <any-valid-key>

{
  "display_name": "Outreach Agent",
  "agent_identifier": "outreach-v2",
  "agent_model": "claude-sonnet-4-20250514",
  "requested_scopes": ["contacts:read", "activities:write"]
}
```

Returns the actor record and a bound API key. Calling this again with the same `agent_identifier` returns the existing actor — no duplicates. Admins can adjust scopes from **Settings → Actors**.

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

## Architecture

```
packages/
  shared/   @crmy/shared   TypeScript types, Zod schemas, validation
  server/   @crmy/server   Express + PostgreSQL + MCP Streamable HTTP
  cli/      crmy           Local CLI + stdio MCP server
  web/      @crmy/web      React SPA (served at /app by Express)
docker/                    Dockerfile + docker-compose.yml
scripts/                   Migration runner
```

### Key design decisions

- **MCP-first** — All CRM operations are MCP tools. REST API and CLI are thin wrappers around the same handlers.
- **Raw SQL** — No ORM. Every query is readable and auditable.
- **Event sourcing** — Every mutation appends to an `events` table. Full audit trail.
- **Scope enforcement** — API key scopes checked before every tool handler. JWT users (humans) bypass scoping and always have full access.
- **Governor limits** — Plan-based quotas on actors, activities, assignments, and context entries. Prevents runaway agents.
- **Context Engine** — Actors (who), Activities (what happened), Assignments (coordination), and Context Entries (memory) form a shared workspace for agent-human GTM workflows.
- **HITL** — Agents request human approval before high-impact actions.
- **Plugins** — Extensible plugin system with lifecycle hooks.
- **Workflows** — Event-driven automation with configurable triggers and actions.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Secret for signing JWT tokens |
| `PORT` | No | `3000` | HTTP server port |
| `CRMY_TENANT_ID` | No | `default` | Default tenant slug |
| `CRMY_API_KEY` | No | — | API key for CLI/agent authentication |
| `CRMY_SERVER_URL` | No | — | Server URL for remote CLI mode |

---

## MCP Tools (80+)

| Category | Tools |
|---|---|
| Contacts | `contact_create`, `contact_get`, `contact_search`, `contact_update`, `contact_set_lifecycle`, `contact_log_activity`, `contact_get_timeline`, `contact_delete` |
| Accounts | `account_create`, `account_get`, `account_search`, `account_update`, `account_set_health_score`, `account_get_hierarchy`, `account_delete` |
| Opportunities | `opportunity_create`, `opportunity_get`, `opportunity_search`, `opportunity_advance_stage`, `opportunity_update`, `opportunity_delete`, `pipeline_summary` |
| Activities | `activity_create`, `activity_get`, `activity_search`, `activity_complete`, `activity_update`, `activity_get_timeline` |
| Use Cases | `use_case_create`, `use_case_get`, `use_case_search`, `use_case_update`, `use_case_delete`, `use_case_advance_stage`, `use_case_update_consumption`, `use_case_set_health`, `use_case_link_contact`, `use_case_unlink_contact`, `use_case_list_contacts`, `use_case_get_timeline`, `use_case_summary` |
| **Actors** | `actor_register`, `actor_get`, `actor_list`, `actor_update`, `actor_whoami` |
| **Assignments** | `assignment_create`, `assignment_get`, `assignment_list`, `assignment_update`, `assignment_accept`, `assignment_complete`, `assignment_decline`, `assignment_start`, `assignment_block`, `assignment_cancel` |
| **Context** | `context_add`, `context_get`, `context_list`, `context_supersede`, `context_search`, `context_review`, `context_stale` |
| **Briefing** | `briefing_get` |
| **Registries** | `activity_type_list`, `activity_type_add`, `activity_type_remove`, `context_type_list`, `context_type_add`, `context_type_remove` |
| Notes | `note_create`, `note_get`, `note_update`, `note_delete`, `note_list` |
| Workflows | `workflow_create`, `workflow_get`, `workflow_update`, `workflow_delete`, `workflow_list`, `workflow_run_list` |
| Webhooks | `webhook_create`, `webhook_get`, `webhook_update`, `webhook_delete`, `webhook_list`, `webhook_list_deliveries` |
| Emails | `email_create`, `email_get`, `email_search` |
| Custom Fields | `custom_field_create`, `custom_field_update`, `custom_field_delete`, `custom_field_list` |
| Analytics | `crm_search`, `pipeline_forecast`, `account_health_report` |
| HITL | `hitl_submit_request`, `hitl_check_status`, `hitl_list_pending`, `hitl_resolve` |
| Meta | `schema_get`, `tenant_get_stats` |

---

## CLI Reference

```
Authentication
crmy auth setup [url]            Configure server URL
crmy auth login                  Sign in (or use `crmy login`)
crmy auth status                 Show auth state + token expiry
crmy auth logout                 Clear stored credentials
crmy login                       Shortcut for `crmy auth login`

Setup & Server
crmy init                        Interactive local setup
crmy server [--port 3000]        Start HTTP server + Web UI
crmy mcp                         Start stdio MCP server

Contacts
crmy contacts list [--q <query>] List contacts
crmy contacts create             Interactive create
crmy contacts get <id>           Get contact details
crmy contacts delete <id>        Delete contact (admin/owner only, confirms)

Accounts
crmy accounts list               List accounts
crmy accounts create             Interactive create
crmy accounts get <id>           Get account + contacts + opps
crmy accounts delete <id>        Delete account (admin/owner only, confirms)

Opportunities
crmy opps list [--stage <s>]     List opportunities
crmy opps get <id>               Get opportunity details
crmy opps create                 Interactive create
crmy opps advance <id> <stage>   Advance opportunity stage
crmy opps delete <id>            Delete opportunity (admin/owner only, confirms)

Use Cases
crmy use-cases list              List use cases
crmy use-cases get <id>          Get use case details
crmy use-cases create            Interactive create
crmy use-cases summary           Use case summary
crmy use-cases delete <id>       Delete use case (admin/owner only, confirms)

Webhooks
crmy webhooks list               List webhook endpoints
crmy webhooks create             Register new webhook
crmy webhooks delete <id>        Remove webhook
crmy webhooks deliveries         Delivery log

Email
crmy emails list                 List outbound emails
crmy emails create               Draft email (with HITL)
crmy emails get <id>             Get email details

Custom Fields
crmy custom-fields list <type>   List custom fields
crmy custom-fields create        Define custom field
crmy custom-fields delete <id>   Remove field definition

Notes
crmy notes list <type> <id>      List notes on an object
crmy notes add <type> <id>       Add note (--parent, --external, --pin)
crmy notes get <id>              Get note with replies
crmy notes delete <id>           Delete note

Workflows
crmy workflows list              List automation workflows
crmy workflows get <id>          Get workflow + recent runs
crmy workflows create            Interactive create
crmy workflows delete <id>       Delete workflow
crmy workflows runs <id>         Execution history

Actors
crmy actors list [--type <t>]    List actors (humans & agents)
crmy actors register             Interactive actor registration
crmy actors get <id>             Get actor details
crmy actors whoami               Show current actor identity

Assignments
crmy assignments list [--mine]   List assignments
crmy assignments create          Interactive create
crmy assignments get <id>        Get assignment details
crmy assignments accept <id>     Accept a pending assignment
crmy assignments start <id>      Start working on an assignment
crmy assignments complete <id>   Complete an assignment
crmy assignments decline <id>    Decline an assignment
crmy assignments block <id>      Mark an assignment as blocked
crmy assignments cancel <id>     Cancel an assignment

Context
crmy context list [--subject-type <t>] [--subject-id <id>]
crmy context add                 Add context about a CRM object
crmy context get <id>            Get context entry
crmy context supersede <id>      Supersede with updated content
crmy context search <query>      Full-text search across context
crmy context review <id>         Mark entry as still accurate
crmy context stale               List stale entries needing review

Briefing
crmy briefing <type:UUID>        Get a full briefing for an object

Activity Types
crmy activity-types list         List registered activity types
crmy activity-types add <name>   Add a custom activity type
crmy activity-types remove <name> Remove a custom activity type

Context Types
crmy context-types list          List registered context types
crmy context-types add <name>    Add a custom context type
crmy context-types remove <name> Remove a custom context type

Other
crmy pipeline                    Pipeline summary
crmy search <query>              Cross-entity search
crmy hitl list                   Pending HITL requests
crmy hitl approve <id>           Approve request
crmy hitl reject <id> [--note]   Reject request
crmy events [--object <id>]      Audit log
crmy config show                 Show config
crmy migrate run                 Run migrations
crmy migrate status              Migration status
```

---

## Documentation

See the [complete user guide](docs/guide.md) for detailed documentation covering all features, the Context Engine, scope enforcement, governor limits, REST API reference, plugin development, workflow configuration, and more.

## License

Apache-2.0
