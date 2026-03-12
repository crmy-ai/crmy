# crmy.ai

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
- **Plugins**: Extensible plugin system with lifecycle hooks (sample Slack notifier included).
- **Workflows**: Event-driven automation with configurable triggers and actions.
- **PostgreSQL**: Production-grade storage with raw SQL queries.

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
crmy-ai use-cases list              List use cases
crmy-ai use-cases get <id>          Get use case details
crmy-ai use-cases create            Interactive create
crmy-ai use-cases summary           Use case summary
crmy-ai webhooks list               List webhook endpoints
crmy-ai webhooks create             Register new webhook
crmy-ai webhooks delete <id>        Remove webhook
crmy-ai webhooks deliveries         Delivery log
crmy-ai emails list                 List outbound emails
crmy-ai emails create               Draft email (with HITL)
crmy-ai emails get <id>             Get email details
crmy-ai custom-fields list <type>   List custom fields
crmy-ai custom-fields create        Define custom field
crmy-ai custom-fields delete <id>   Remove field definition
crmy-ai notes list <type> <id>      List notes on an object
crmy-ai notes add <type> <id>       Add note (supports --parent, --external, --pin)
crmy-ai notes get <id>              Get note with replies
crmy-ai notes delete <id>           Delete note
crmy-ai workflows list              List automation workflows
crmy-ai workflows get <id>          Get workflow + recent runs
crmy-ai workflows create            Interactive create
crmy-ai workflows delete <id>       Delete workflow
crmy-ai workflows runs <id>         Execution history
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

## Tech: TypeScript · PostgreSQL · MCP · Apache-2.0 License
