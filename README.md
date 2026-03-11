# CRMy.ai

The agent-first open source CRM. MCP-native. Works with any PostgreSQL.

## Quickstart (30 seconds)

```bash
npx crmy-ai init
```

## Use with Claude Code

```bash
claude mcp add crmy -- npx crmy-ai mcp
```

Then in Claude Code:
> "Create a contact for Sarah Chen at Acme Corp, set her stage to prospect,
>  and log a call we had today about their Q2 budget"

## Self-host with Docker

```bash
docker compose -f docker/docker-compose.yml up -d
```

## Architecture

- **@crmy/shared** — TypeScript types, Zod schemas, validation
- **@crmy/server** — Express + PostgreSQL + MCP Streamable HTTP endpoint
- **crmy-ai (CLI)** — Local CLI + stdio MCP server for Claude Code

### Key Design Decisions

- **MCP-first**: All CRM operations are defined as MCP tools. REST API and CLI are thin wrappers around the same tool handlers.
- **Raw SQL**: No ORM. Every query is readable and auditable.
- **Event sourcing**: Every mutation writes an append-only event row for full audit trail.
- **HITL**: Agents can request human approval before high-impact actions.
- **PostgreSQL only (v0.1)**: SQLite planned for v0.2.

## MCP Tools (25+)

| Category | Tools |
|---|---|
| Contacts | `contact_create`, `contact_get`, `contact_search`, `contact_update`, `contact_set_lifecycle`, `contact_log_activity`, `contact_get_timeline` |
| Accounts | `account_create`, `account_get`, `account_search`, `account_update`, `account_set_health_score`, `account_get_hierarchy` |
| Opportunities | `opportunity_create`, `opportunity_get`, `opportunity_search`, `opportunity_advance_stage`, `opportunity_update`, `pipeline_summary` |
| Activities | `activity_create`, `activity_get`, `activity_search`, `activity_complete`, `activity_update` |
| Analytics | `crm_search`, `pipeline_forecast`, `account_health_report` |
| HITL | `hitl_submit_request`, `hitl_check_status`, `hitl_list_pending`, `hitl_resolve` |
| Meta | `schema_get`, `tenant_get_stats` |

## CLI Commands

```
crmy-ai init                        Interactive setup
crmy-ai server [--port 3000]        Start HTTP server
crmy-ai mcp                         Start stdio MCP server
crmy-ai contacts list [--q <query>] List contacts
crmy-ai contacts create             Interactive create
crmy-ai contacts get <id>           Get contact details
crmy-ai accounts list               List accounts
crmy-ai accounts get <id>           Get account + contacts + opps
crmy-ai opps list [--stage <s>]     List opportunities
crmy-ai opps advance <id> <stage>   Advance opportunity stage
crmy-ai pipeline                    Pipeline summary
crmy-ai search <query>              Cross-entity search
crmy-ai hitl list                   Pending HITL requests
crmy-ai hitl approve <id>           Approve request
crmy-ai hitl reject <id> [--note]   Reject request
crmy-ai events [--object <id>]      Audit log
crmy-ai config show                 Show config
crmy-ai migrate run                 Run migrations
crmy-ai migrate status              Migration status
```

## REST API

All endpoints under `/api/v1/` require `Authorization: Bearer <jwt-or-api-key>`.

See the [full API reference](docs/mcp-tools.md) for details.

## Tech: TypeScript · PostgreSQL · MCP · MIT License
