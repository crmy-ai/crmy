# crmy.ai

The agent-first open source CRM. MCP-native. Works with any PostgreSQL.

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

### 1. Initialize

```bash
npx crmy init
```

Walks you through: connect to PostgreSQL, run migrations, create your user, generate an API key. Config is saved to `.crmy.json` (auto-added to `.gitignore`).

### 2. Use with Claude Code

```bash
claude mcp add crmy -- npx crmy mcp
```

Then in Claude Code:
> "Create a contact for Sarah Chen at Acme Corp, set her stage to prospect,
>  and log a call we had today about their Q2 budget"

### 3. Start the HTTP server

```bash
npx crmy server
# Server ready on :3000 with MCP + REST endpoints
```

### 4. Self-host with Docker

```bash
docker compose -f docker/docker-compose.yml up -d
```

Starts PostgreSQL + crmy server on port 3000 with auto-migrations.

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
  cli/      crmy        Local CLI + stdio MCP server
docker/                    Dockerfile + docker-compose.yml
scripts/                   Migration runner
```

### Design Decisions

- **MCP-first**: All CRM operations are MCP tools. REST API and CLI are thin wrappers.
- **Raw SQL**: No ORM. Every query is readable and auditable.
- **Event sourcing**: Every mutation writes an append-only event row for full audit trail.
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
| `CRMY_API_KEY` | No | — | API key for CLI authentication |

## MCP Tools (50+)

| Category | Tools |
|---|---|
| Contacts | `contact_create`, `contact_get`, `contact_search`, `contact_update`, `contact_set_lifecycle`, `contact_log_activity`, `contact_get_timeline` |
| Accounts | `account_create`, `account_get`, `account_search`, `account_update`, `account_set_health_score`, `account_get_hierarchy` |
| Opportunities | `opportunity_create`, `opportunity_get`, `opportunity_search`, `opportunity_advance_stage`, `opportunity_update`, `pipeline_summary` |
| Activities | `activity_create`, `activity_get`, `activity_search`, `activity_complete`, `activity_update` |
| Use Cases | `use_case_create`, `use_case_get`, `use_case_search`, `use_case_update`, `use_case_delete`, `use_case_advance_stage`, `use_case_update_consumption`, `use_case_set_health`, `use_case_link_contact`, `use_case_unlink_contact`, `use_case_list_contacts`, `use_case_get_timeline`, `use_case_summary` |
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
crmy init                        Interactive setup
crmy server [--port 3000]        Start HTTP server
crmy mcp                         Start stdio MCP server
crmy contacts list [--q <query>] List contacts
crmy contacts create             Interactive create
crmy contacts get <id>           Get contact details
crmy accounts list               List accounts
crmy accounts get <id>           Get account + contacts + opps
crmy opps list [--stage <s>]     List opportunities
crmy opps advance <id> <stage>   Advance opportunity stage
crmy use-cases list              List use cases
crmy use-cases get <id>          Get use case details
crmy use-cases create            Interactive create
crmy use-cases summary           Use case summary
crmy webhooks list               List webhook endpoints
crmy webhooks create             Register new webhook
crmy webhooks delete <id>        Remove webhook
crmy webhooks deliveries         Delivery log
crmy emails list                 List outbound emails
crmy emails create               Draft email (with HITL)
crmy emails get <id>             Get email details
crmy custom-fields list <type>   List custom fields
crmy custom-fields create        Define custom field
crmy custom-fields delete <id>   Remove field definition
crmy notes list <type> <id>      List notes on an object
crmy notes add <type> <id>       Add note (--parent, --external, --pin)
crmy notes get <id>              Get note with replies
crmy notes delete <id>           Delete note
crmy workflows list              List automation workflows
crmy workflows get <id>          Get workflow + recent runs
crmy workflows create            Interactive create
crmy workflows delete <id>       Delete workflow
crmy workflows runs <id>         Execution history
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
