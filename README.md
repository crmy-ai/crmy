# CRMy

An agent-first open source CRM with a built-in Context Engine for agent-human GTM coordination. MCP-native. Works with any PostgreSQL.

## Install

```bash
npm install -g crmy
```

Or run directly with npx (no install needed):

```bash
npx crmy init
```

### Prerequisites

- **Node.js** >= 20.0.0
- **PostgreSQL** >= 14 (any provider: local, Supabase, Neon, RDS, etc.)

## Quickstart

### Option A — Local mode (direct database)

```bash
npx crmy init
# Walks you through: connect to PostgreSQL, run migrations, create user, generate API key.
# Config saved to .crmy.json (auto-added to .gitignore).

npx crmy server
# Server ready on :3000 — REST API + MCP + Web UI at /app
```

### Option B — Connect to a remote server

```bash
crmy auth setup https://crm.company.com
crmy login
# Prompts for email + password, stores JWT in ~/.crmy/auth.json
# All subsequent CLI commands use the REST API
```

### Use with Claude Code

```bash
claude mcp add crmy -- npx crmy mcp
```

Then in Claude Code:
> "Create a contact for Sarah Chen at Acme Corp, set her stage to prospect,
>  and log a call we had today about their Q2 budget"

### Self-host with Docker

```bash
docker compose -f docker/docker-compose.yml up -d
```

Starts PostgreSQL + crmy server on port 3000 with auto-migrations.

## Web UI

The web interface is available at `/app` when running the server. Built with React 18 + Vite + Tailwind CSS.

```
http://localhost:3000/app
```

### Pages

| Page | Description |
|------|-------------|
| Dashboard | Stat cards, use case stage strip, recent activity feed |
| Contacts | List, create, detail with activity timeline, context panel, and briefing |
| Accounts | List, create, detail with context panel and briefing |
| Pipeline | Kanban board by opportunity stage |
| Opportunities | Detail view with context panel and briefing |
| Use Cases | List with filters, create form, 360 detail with context panel and briefing |
| Activities | Activity log across all objects |
| **Assignments** | Assignment queue with My Queue / Delegated / All tabs, status filters, and inline actions (accept, start, complete, block, cancel, decline) |
| Analytics | Pipeline by stage, forecast, use case ARR/health distribution |
| HITL Queue | Approve/reject agent actions with payload viewer |
| Settings | Profile, API keys, webhooks, custom fields management |
| Search | Global cross-entity search |

### Use Case 360

The use case detail page provides a complete view:
- **Stage bar** — click to advance with confirmation modal (note required for sunset)
- **Consumption bar** — green/amber/red thresholds at 70%/90%
- **Health badge** — colored by score (green >= 70, amber 40-69, red < 40)
- **Contact management** — add/remove contacts with role assignment
- **Activity timeline** — linked activities and events

## Context Engine (v0.4 + v0.5)

The Context Engine transforms CRMy from a system of record into a **system of action** — a shared workspace where AI agents and humans coordinate GTM workflows through four primitives:

| Primitive | What it captures | Why it matters |
|-----------|-----------------|----------------|
| **Actors** | Who is doing things (human or agent) | First-class identity enables agent-human coordination |
| **Activities** (enhanced) | Everything that happened — with polymorphic subjects and structured payloads | Rich audit trail with `occurred_at`, `detail` JSONB, and `outcome` |
| **Assignments** | Who owns what next — handoffs between agents and humans | Full lifecycle: pending → accepted → in_progress → completed/blocked/cancelled |
| **Context Entries** | Structured knowledge attached to any CRM object | The memory layer with tags, FTS, staleness tracking, and supersede chains |

### v0.5 — Assignments, Context & Coordination

v0.5 adds the coordination and knowledge management layers:

- **Activity Type Registry** — 19 default activity types across 7 categories (outreach, meeting, proposal, contract, internal, lifecycle, handoff). Add custom types per tenant.
- **Context Type Registry** — 12 default context types (note, transcript, summary, research, preference, objection, competitive_intel, relationship_map, meeting_notes, agent_reasoning, decision, action_item). Extensible.
- **Full-text search** on context entries via PostgreSQL `tsvector`/`tsquery` with GIN indexes
- **Context staleness** — entries have optional `valid_until` timestamps; stale entries surface in briefings and the UI
- **Context tags** — JSONB array tags on context entries with GIN index for fast filtering
- **Briefing service** — assembles a complete briefing for any CRM object: record, related objects, activities, open assignments, context entries grouped by type, and staleness warnings
- **Assignment lifecycle** — full state machine: pending → accepted → in_progress → completed, with block/cancel/decline transitions
- **Governor limits** — plan-based rate limiting (solo_agent, pro_agent, team) on actors, activities, assignments, and context entries

### Agent Workflow Example

```
1. Agent logs a meeting activity (activity_create)
2. Agent extracts key takeaways and stores them (context_add ×3, with tags and confidence)
3. Agent assigns follow-up to human rep (assignment_create)
4. Human gets a briefing on the contact (briefing_get) — sees activities, context, stale warnings
5. Human reviews context, sends proposal (assignment_complete)
6. Agent searches context for competitive intel (context_search)
7. Agent reviews stale entries and supersedes outdated ones (context_stale, context_supersede)
```

### Key Design Decisions

- **Polymorphic subjects**: Activities, assignments, and context entries attach to any CRM object via `subject_type` + `subject_id`
- **`activity_type` is a text field**: Agents can invent new activity types without schema changes
- **`occurred_at` vs `created_at`**: Agents may log activities retroactively; the timeline shows when it happened, not when it was logged
- **Context `confidence` field**: Agents signal certainty (1.0 for transcripts, 0.6 for sentiment analysis) so downstream consumers can weight decisions
- **Supersede, don't delete**: Old context entries are marked `is_current = false` for audit trail; new entries point back via `supersedes_id`
- **Type registries**: Activity types and context types are discoverable via registry tables, seeded with defaults, and extensible per tenant
- **Briefings**: One API call assembles everything an agent or human needs before engaging with a CRM object

## Authentication

CRMy supports three authentication methods:

### JWT Login

```bash
# From the CLI
crmy auth setup http://localhost:3000
crmy login

# From the Web UI
# Visit /app/login — email + password
```

### API Keys

```bash
# Create via CLI (after init)
# Key is generated during `crmy init` and stored in .crmy.json

# Create via REST
POST /auth/api-keys  { "label": "my-agent", "scopes": ["*"] }
# Returns the key once — store it securely

# Use in requests
Authorization: Bearer crmy_<key>
```

### Environment Variables

```bash
export CRMY_SERVER_URL=http://localhost:3000
export CRMY_API_KEY=crmy_abc123...
crmy contacts list   # uses REST API with API key
```

## Develop from source

```bash
git clone https://github.com/codycharris/crmy.git
cd crmy
npm install
npm run build
npm run dev     # starts server with tsx watch
```

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

### Design Decisions

- **MCP-first**: All CRM operations are MCP tools. REST API and CLI are thin wrappers.
- **Raw SQL**: No ORM. Every query is readable and auditable.
- **Event sourcing**: Every mutation writes an append-only event row for full audit trail.
- **Context Engine**: Actors (who), Activities (what happened), Assignments (coordination), and Context Entries (memory) form a shared workspace where AI agents and humans run GTM together.
- **HITL**: Agents request human approval before high-impact actions.
- **Plugins**: Extensible plugin system with lifecycle hooks.
- **Workflows**: Event-driven automation with configurable triggers and actions.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Secret for signing JWT tokens |
| `PORT` | No | `3000` | HTTP server port |
| `CRMY_TENANT_ID` | No | `default` | Default tenant slug |
| `CRMY_API_KEY` | No | — | API key for CLI/agent authentication |
| `CRMY_SERVER_URL` | No | — | Server URL for remote CLI mode |

## MCP Tools (80+)

| Category | Tools |
|---|---|
| Contacts | `contact_create`, `contact_get`, `contact_search`, `contact_update`, `contact_set_lifecycle`, `contact_log_activity`, `contact_get_timeline` |
| Accounts | `account_create`, `account_get`, `account_search`, `account_update`, `account_set_health_score`, `account_get_hierarchy` |
| Opportunities | `opportunity_create`, `opportunity_get`, `opportunity_search`, `opportunity_advance_stage`, `opportunity_update`, `pipeline_summary` |
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

Accounts
crmy accounts list               List accounts
crmy accounts get <id>           Get account + contacts + opps

Opportunities
crmy opps list [--stage <s>]     List opportunities
crmy opps advance <id> <stage>   Advance opportunity stage

Use Cases
crmy use-cases list              List use cases
crmy use-cases get <id>          Get use case details
crmy use-cases create            Interactive create
crmy use-cases summary           Use case summary

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

Actors (v0.4)
crmy actors list [--type <t>]    List actors (humans & agents)
crmy actors register             Interactive actor registration
crmy actors get <id>             Get actor details
crmy actors whoami               Show current actor identity

Assignments (v0.4+v0.5)
crmy assignments list [--mine]   List assignments
crmy assignments create          Interactive create
crmy assignments get <id>        Get assignment details
crmy assignments accept <id>     Accept a pending assignment
crmy assignments start <id>      Start working on an assignment
crmy assignments complete <id>   Complete an assignment
crmy assignments decline <id>    Decline an assignment
crmy assignments block <id>      Mark an assignment as blocked
crmy assignments cancel <id>     Cancel an assignment

Context (v0.4+v0.5)
crmy context list [--subject-type <t>] [--subject-id <id>]
crmy context add                 Add context about a CRM object
crmy context get <id>            Get context entry
crmy context supersede <id>      Supersede with updated content
crmy context search <query>      Full-text search across context
crmy context review <id>         Mark entry as still accurate
crmy context stale               List stale entries needing review

Briefing (v0.5)
crmy briefing <type:UUID>        Get a full briefing for an object

Activity Types (v0.5)
crmy activity-types list         List registered activity types
crmy activity-types add <name>   Add a custom activity type
crmy activity-types remove <name> Remove a custom activity type

Context Types (v0.5)
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

## Documentation

See the [complete user guide](docs/guide.md) for detailed documentation covering all features, REST API reference, plugin development, workflow configuration, and more.

## License

Apache-2.0
