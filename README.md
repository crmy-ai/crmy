# CRMy

Operational customer context for AI agents.

CRMy is a local-first operational state layer that gives agents typed revenue objects, persistent context, scoped tools, and retry-safe writes through MCP, REST, and CLI.

Instead of rebuilding customer state from raw CRM queries, notes, emails, and prior tool calls every run, agents call `briefing_get`, act through structured tools, escalate to humans when judgment is needed, and leave behind auditable, versioned state.

Use CRMy when your agent needs to:

- remember customers across runs
- reason over current and historical customer state
- update revenue objects safely
- pause for human approval or handoff without losing context
- avoid duplicate, stale, or contradictory memory
- recover from retries, failed jobs, and partial workflows

MCP-native. PostgreSQL-backed. Open source.

---

## The problem CRMy solves

Your agent takes an action — sends an email, advances a deal, books a follow-up call. Before it acts, it needs to know:

- Who is this contact? What's their lifecycle stage?
- What happened last week? Last quarter?
- What did prior agent turns learn about this account?
- Are there open assignments on this contact right now?
- Is there a human approval, review, or handoff blocking progress?
- What context is stale and might be wrong?

Assembling that from raw queries is 5-10 API calls, schema knowledge, and brittle glue code. CRMy's `briefing_get` returns it in one shot, then mutating tools update the underlying state with idempotency, optimistic concurrency, audit events, and scoped access.

---

## Quickstart

The fastest local path is npm plus PostgreSQL. You need Node.js 20+ and a Postgres database. If you do not already have Postgres running, start one with Docker:

```bash
docker run --name crmy-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=crmy \
  -p 5432:5432 \
  -d pgvector/pgvector:pg16
```

Then initialize CRMy:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
export CRMY_ADMIN_EMAIL=admin@example.com
export CRMY_ADMIN_PASSWORD=change-me-please-123

npx @crmy/cli init --yes
npx @crmy/cli doctor
npx @crmy/cli server
```

Open:

```text
Web UI   http://localhost:3000/app
REST     http://localhost:3000/api/v1
MCP      http://localhost:3000/mcp
Health   http://localhost:3000/health
```

What `init --yes` does:

1. Connects to PostgreSQL.
2. Creates the `crmy` database if it is missing on local Postgres.
3. Runs migrations.
4. Creates the first owner account.
5. Writes `.crmy.json` with a local API key.
6. Seeds demo data so the examples below work immediately.

CRMy writes config to both `.crmy.json` in the current project and `~/.crmy/config.json`, so `crmy mcp` works even when an agent launches it from another directory. If setup ever feels off, run `npx @crmy/cli doctor` for a guided check.

Prefer interactive setup? Run:

```bash
npx @crmy/cli init
```

Prefer a global install?

```bash
npm install -g @crmy/cli
```

The binary is `crmy`, so `crmy init`, `crmy doctor`, and `crmy server` are equivalent to the `npx @crmy/cli ...` commands above.

### Docker Compose alternative

For a full local stack managed by Compose:

```bash
git clone https://github.com/crmy-ai/crmy.git
cd crmy

export JWT_SECRET=$(openssl rand -hex 32)
export CRMY_ADMIN_EMAIL=admin@example.com
export CRMY_ADMIN_PASSWORD=change-me-please-123
export CRMY_SEED_DEMO=true

docker compose -f docker/docker-compose.yml up -d
```

### Try it

With demo data loaded, try these to see CRMy in action:

```bash
npx @crmy/cli briefing contact:d0000000-0000-4000-c000-000000000101       # Maya Patel at Northstar Labs
npx @crmy/cli briefing account:d0000000-0000-4000-b000-000000000101       # Northstar Labs account context
npx @crmy/cli hitl list                                                   # Pending governed Handoff
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

Once connected, your agent has access to scoped MCP tools for briefings, context, revenue objects, assignments, HITL approvals, workflows, messaging, and operations. Local stdio MCP uses the `.crmy.json` written by `init`; remote HTTP MCP uses scoped API keys.

---

## Systems of Record Overlay

The 0.8 line adds governed connections to enterprise systems of record. CRMy can sync external state into typed customer objects, preserve external record references, surface conflicts, and queue writebacks with preview, policy, audit, and HITL controls.

First-party connector targets:

- HubSpot OAuth app credentials — first certified 0.8 path
- Salesforce REST/OAuth credentials — supported connector framework path pending live certification
- Databricks SQL Warehouse / Delta-backed tables — supported warehouse framework path pending live certification
- Snowflake SQL API tables, views, and approved write procedures — supported warehouse framework path pending live certification

Configure them in **Settings → Systems of Record**. HubSpot uses App ID, Client ID, Client Secret, Sample install URL, and CRMy's generated callback URL; after approval, CRMy exchanges the OAuth code and stores encrypted access and refresh tokens. Salesforce supports encrypted OAuth refresh credentials with `instance_url`, `refresh_token`, `client_id`, and `client_secret`. Warehouse connections use credential JSON for host/account and token metadata. The same settings area lets admins discover external schema, build field mappings, run syncs, resolve conflicts, and create governed writeback requests. Reliability health for connected systems appears under **Reliability**.

CLI and MCP expose the same operator path:

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

Connector credentials are encrypted in PostgreSQL. Set `CRMY_ENCRYPTION_KEY` in production before storing secrets.

Automation safety defaults: external-origin events can trigger normal workflows, but writeback actions must include an explicit payload JSON object. Workflow-created writebacks receive deterministic idempotency keys by default, and sync-originated events cannot write back to the same source unless a mapping explicitly allows it. Sync respects mapping source authority: external-authoritative mappings can update CRMy directly, while CRMy-authoritative, read-only, and approval-required mappings create conflicts instead of overwriting existing records. Databricks and Snowflake writeback previews require admin-defined SQL templates and configured writable fields; use `writeback_config.parameter_order` for deterministic SQL parameter binding.

---

## Get a briefing before every action

Via MCP (natural language):

> Get me a full briefing on contact `<id>` before I reach out.

Via CLI:

```bash
npx @crmy/cli briefing contact:<id>
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

Works on contacts, companies, opportunities, and use cases.

---

## Agent workflow example

```
1. agent: "Get me a full briefing on contact abc."
   ← record + recent activities + open assignments + typed context + stale warnings

2. agent: "Log a discovery call with abc — champion identified, pricing concern raised."
   → activity logged as an observation; extraction pipeline creates reviewable signals

3. human or agent: "Promote the budget approval signal."
   → confirmed as Memory; visible in future briefings and safe for coordinated work

4. agent: "Create an assignment for rep Sarah to send the proposal."
   → appears in the rep's assignment queue

5. human: "Get me a briefing on contact abc."
   ← same context the agent built, plus the open assignment

6. human: "Mark assignment 123 complete — proposal sent."
   → logged to audit trail; context entry written
```

### Human-in-the-loop handoffs

CRMy gives agents a clear escalation path when automation should stop and a human should step in.

Agents can create assignments, submit HITL approval requests, capture handoff snapshots, route work to humans or specialist agents, and later resume from the same customer context. That matters for enterprise workflows where approvals, exception handling, and auditability are part of the product experience rather than afterthoughts.

### Action policy boundary

CRMy is the policy boundary between what agents can infer and what agents are allowed to change. Agents can freely extract Signals from Raw Context, draft recommendations, and prepare work, but coordinated action passes through scopes, evidence checks, Action Policies, HITL approvals, and systems-of-record writeback policy.

Built-in policies now protect high-impact operations: forecast category changes require approval for non-user actors, Signal promotion requires evidence and sufficient confidence, external writebacks evaluate mapping authority before request or execution, and workflow field updates create approval requests instead of silently changing sensitive fields.

---

## Context Engine

Four primitives that form the agent's shared workspace:

| Primitive | What it does |
|-----------|-------------|
| **Actors** | First-class identity for humans and AI agents. Every action is attributed to an actor. Agents self-register — no admin setup. Query `actor_expertise` to route reviews to the person who knows most about a company. |
| **Activities** | Raw Context: everything CRMy receives before it becomes Signals or Memory — calls, emails, meetings, notes, transcripts, external changes, support/product signals, MCP/REST/CLI writes, and documents. Structured `detail` payloads, polymorphic subjects, retroactive `occurred_at` timestamps, and auto-extraction into Signals. Bulk-ingest raw documents with `context_ingest`. |
| **Assignments** | Structured handoffs. Agents create assignments for humans; humans create assignments for agents. Stateful lifecycle: `pending → accepted → in_progress → completed`. Stale context entries automatically generate review assignments, and handoff snapshots preserve context for the next actor. |
| **Signals** | Inferred, evidence-backed context extracted from Raw Context. Signals include confidence, source evidence, and review state. They are useful for discovery, but they are not Current Memory and should not drive writeback, forecast, task assignment, or customer-facing action without promotion or approval. |
| **Memory** | Confirmed typed operational context attached to any customer record. Memory is tagged, versioned, auditable, searchable, and safe for agents, workflows, handoffs, and governed writeback. `context_radius` expands briefings to adjacent entities. Token-budget-aware packing fits Memory into any LLM context window. |

Every important Signal or Memory entry is a **claim with evidence**. Evidence records source type, source reference, excerpt, speaker or author when known, observed timestamp, support confidence, rationale, verification metadata, and audit lineage. Agents can say not only “budget approval is a risk,” but “budget approval is a risk based on this meeting excerpt, from this speaker, on this date.”

Memory has a lifecycle because GTM facts decay. CRMy keeps Memory **Current**, flags it when it **Needs Review**, preserves old claims as **Superseded**, and keeps dismissed Signals out of operational Memory. Briefings warn agents about Memory that needs review and contradictions before they act, so aging CRM notes do not quietly become bad decisions.

### Semantic search (optional)

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

## MCP Tools

CRMy has a broad tool catalog because it supports everyday agent work, admin setup, operations, Automations, Sequences, and systems-of-record connectors. Agents should not receive that catalog as one flat toolbox.

The MCP server uses **scoped exposure**:

- **Default revenue agents** should use high-level tools first: `briefing_get`, `entity_resolve`, `crm_search`, `context_ingest_auto`, `context_signal_group_list`, `context_signal_group_promote`, `activity_create`, compound actions, assignments, and HITL. Reserve `context_add` for advanced direct Memory or evidence-backed Signal writes.
- **Signals are evidence-backed by design.** Inferred context starts as `memory_status="signal"` with source evidence. CRMy combines related Signals so calls, emails, system changes, support notes, product signals, or MCP writes can reinforce or challenge the same claim.
- **Evidence is a Memory primitive.** Context entries store typed evidence references with source, snippet, speaker, observed timestamp, confidence, rationale, and verification metadata so agents can show the proof behind important claims.
- **Memory Health is explicit.** Current Memory can become Needs Review when `valid_until` passes, can be reconfirmed with `context_review`, or can be superseded when fresher evidence arrives.
- **Raw Context has a processing trail.** Inputs are tracked with source type, reference, stage, status, extracted Signal count, Memory count, skipped count, and failure reason so operators can see why messy context did or did not become usable agent memory.
- **Promotion is the trust boundary.** Promote corroborated Signals to Memory when evidence is strong enough, or use `context_signal_promote` for a single reviewed Signal. Dismiss with the reject tools while preserving evidence for audit.
- **Action Policies are the execution boundary.** CRMy evaluates action, object type, sensitive fields, actor type, confidence, evidence, and system-of-record authority before agents change operational state.
- **Operator and integration agents** can receive Systems of Record, workflow, messaging, operations, and admin tools only when their actor/API key scopes explicitly allow them.
- **Systems of Record scopes are never granted by the generic `read` or `write` shortcuts.** Use explicit `systems:read`, `systems:write`, or `systems:admin`.
- **External writeback tools require both `systems:write` and the relevant object write scope** before a request can be previewed, reviewed, or executed.
- **The tool manifest is filtered per actor** before the agent sees it, and every tool call is checked again before execution.

| Category | Tools |
|---|---|
| **Briefing** | `briefing_get` — with `context_radius` (direct/adjacent/account_wide), `token_budget`, and `dropped_entries` in response |
| **Context** | `context_ingest_auto`, `context_ingest`, `context_raw_source_list`, `context_raw_source_get`, `context_add`, `context_get`, `context_list`, `context_signal_group_list`, `context_signal_group_get`, `context_signal_group_promote`, `context_signal_group_reject`, `context_signal_promote`, `context_signal_reject`, `context_supersede`, `context_search`, `context_semantic_search`, `context_review`, `context_review_batch` ★, `context_stale`, `context_bulk_mark_stale` ★, `context_diff`, `context_extract`, `context_stale_assign`, `context_embed_backfill` |
| **Actors** | `actor_register`, `actor_get`, `actor_list`, `actor_update`, `actor_whoami`, `actor_expertise`, `agent_register_specialization`, `agent_find_specialist`, `agent_set_availability` |
| **Assignments** | `assignment_create`, `assignment_get`, `assignment_list`, `assignment_update`, `assignment_accept`, `assignment_complete`, `assignment_decline`, `assignment_start`, `assignment_block`, `assignment_cancel` |
| **HITL** | `hitl_submit_request`, `hitl_check_status`, `hitl_list_pending`, `hitl_resolve`, `hitl_rule_create`, `hitl_rule_list`, `hitl_rule_delete` |
| **Agent Handoff** | `agent_capture_handoff`, `agent_resume_handoff` |
| Activities | `activity_create`, `activity_get`, `activity_search`, `activity_complete`, `activity_update`, `activity_get_timeline` |
| Contacts | `contact_create`, `contact_get`, `contact_search`, `contact_update`, `contact_set_lifecycle`, `contact_get_timeline`, `contact_get_opportunities`, `contact_score`, `contact_merge`, `contact_delete` |
| Companies | `account_create`, `account_get`, `account_search`, `account_update`, `account_set_health_score`, `account_get_hierarchy`, `account_health_report`, `account_merge`, `account_delete` |
| Opportunities | `opportunity_create`, `opportunity_get`, `opportunity_search`, `opportunity_advance_stage`, `opportunity_update`, `opportunity_health_score`, `opportunity_delete` |
| Messaging | `message_channel_create`, `message_channel_update`, `message_channel_get`, `message_channel_delete`, `message_channel_list`, `message_send`, `message_delivery_get`, `message_delivery_search` |
| Analytics | `pipeline_summary`, `pipeline_forecast`, `crm_search`, `account_health_report`, `tenant_get_stats` |
| Use Cases | `use_case_create`, `use_case_get`, `use_case_search`, `use_case_update`, `use_case_delete`, `use_case_advance_stage`, `use_case_update_consumption`, `use_case_set_health`, `use_case_link_contact`, `use_case_unlink_contact`, `use_case_list_contacts`, `use_case_get_timeline`, `use_case_summary` |
| Registries | `activity_type_list`, `activity_type_add`, `activity_type_remove`, `context_type_list`, `context_type_add`, `context_type_remove` |
| Workflows | `workflow_create`, `workflow_get`, `workflow_update`, `workflow_delete`, `workflow_list`, `workflow_run_list`, `workflow_test`, `workflow_clone`, `workflow_trigger`, `workflow_run_replay`, `workflow_template_list` ★ |
| Systems of Record | `sor_system_create`, `sor_system_update`, `sor_system_delete`, `sor_system_list`, `sor_system_get`, `sor_system_test`, `sor_discover`, `sor_mapping_upsert`, `sor_mapping_delete`, `sor_mapping_list`, `sor_sync_run`, `sor_sync_status`, `sor_conflict_list`, `sor_conflict_resolve`, `sor_writeback_preview`, `sor_writeback_request`, `sor_writeback_review`, `sor_writeback_execute`, `sor_writeback_status` |
| Webhooks | `webhook_create`, `webhook_get`, `webhook_update`, `webhook_delete`, `webhook_list`, `webhook_list_deliveries` |
| Emails | `email_create`, `email_get`, `email_search`, `email_provider_set`, `email_provider_get` |
| Sequences | `sequence_create`, `sequence_get`, `sequence_update`, `sequence_delete`, `sequence_list`, `sequence_enroll`, `sequence_unenroll`, `sequence_pause`, `sequence_resume`, `sequence_advance`, `sequence_enrollment_get`, `sequence_enrollment_context`, `sequence_enrollment_list`, `sequence_draft_step`, `sequence_analytics`, `sequence_clone` |
| Custom Fields | `custom_field_create`, `custom_field_update`, `custom_field_delete`, `custom_field_list` |
| Operations | `ops_status_get`, `ops_job_recover`, `ops_data_quality_get`, `ops_data_quality_repair`, `ops_audit_get`, `ops_privacy_export`, `ops_pii_redact`, `ops_privacy_delete`, `ops_retention_apply` ★ |
| Meta | `schema_get`, `entity_resolve`, `guide_search` |

★ Added in the 0.7 release line

---

## CLI Reference

```
Setup & Diagnostics
  crmy init [--yes]                      Interactive setup wizard (DB, migrations, admin)
  crmy doctor [--port 3000]              8-point diagnostic check
  crmy server [--port 3000]              Start HTTP server + Web UI
  crmy mcp                               Start stdio MCP server (for Claude Code)
  crmy seed-demo [--reset]               Seed lifecycle demo data (same as Web UI)

Authentication
  crmy login                             Sign in (shortcut)
  crmy auth setup [url]                  Configure server URL
  crmy auth login                        Sign in (stores JWT)
  crmy auth status                       Show auth state + token expiry
  crmy auth logout                       Clear stored credentials
  crmy reset-password --email <email>    Reset a local user's password in PostgreSQL

Contacts
  crmy contacts list [--q <query>]       List contacts
  crmy contacts create                   Interactive create
  crmy contacts get <id>                 Get contact details
  crmy contacts delete <id>              Delete (admin/owner only)

Companies
  crmy accounts list                     List companies
  crmy accounts create                   Interactive create
  crmy accounts get <id>                 Get company + contacts + opps
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

Systems of Record
  crmy systems list                      List HubSpot/Salesforce/warehouse connections
  crmy systems test <id>                 Test encrypted credentials and connectivity
  crmy systems discover <id>             Discover objects or fields
  crmy systems mappings                  List configured object mappings
  crmy systems upsert-mapping            Create or update a governed object mapping
  crmy systems sync <id>                 Run a governed sync
  crmy systems conflicts                 List sync conflicts
  crmy systems resolve-conflict <id>     Resolve a source/local conflict
  crmy systems writebacks                List governed external writebacks
  crmy systems preview-writeback <id>    Preview policy, diff, and warnings
  crmy systems request-writeback <id>    Create a governed writeback request
  crmy systems review-writeback <id>     Approve or reject a writeback
  crmy systems execute-writeback <id>    Execute an approved external writeback

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
  crmy context ingest [--file <path>]    Add Raw Context and extract Signals/Memory
  crmy context raw-sources               List Raw Context processing receipts
  crmy context signals                   List Signals that need review
  crmy context promote <id>              Promote a Signal to Memory
  crmy context reject <id>               Reject a Signal
  crmy context list [--subject <type:id>]
  crmy context add                       Advanced direct Memory/Signal write
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
  crmy context list                      List Memory and Signals
  crmy context add                       Add Memory or a reviewed Signal
  crmy custom-fields list                List custom field definitions
  crmy activity-types list               List activity type registry
  crmy context-types list                List context type registry
```

---

## Web UI

Available at `/app` when the server is running. The web UI provides full CRUD for typed revenue objects, context governance, handoffs, actors, and agent settings.

**Sidebar navigation:**

| Section | Pages |
|---------|-------|
| **Agent Hub** | Memory Hub (dashboard), Approvals (HITL), Agents, Context, Workflows, Handoffs (assignments) |
| **Customer State** | Contacts, Companies, Opportunities, Use Cases, Activities, Emails |
| **System** | Settings (Profile, Appearance, API Keys, Webhooks, Custom Fields, Actors, Registries, Workspace Agent, Database) |

**Key features:**
- **Memory Hub** — command-center flow showing Raw Context → Signals → Memory → Actions, plus next-step attention items and activity
- **Contact/Company drawers** — Detail, Brief, and Graph tabs; Brief surfaces a full structured briefing inline; Graph opens a full-page Obsidian-style memory graph
- **Memory Graph** — dark canvas visualization showing entity nodes, context clusters, related records, activities, and assignments in a concentric radial layout; sidebar for category filtering; click any node to open a detail Sheet drawer
- **Context page** — inspect Raw Context, review Signals, browse Current Memory, and run Memory Health checks; inline keyword/semantic search toggle; semantic fallback to keyword when pgvector is unavailable; **Add Context** flow for pasted notes, transcripts, emails, or files; 15 MB upload guard with clear error
- **Context import** — paste text or upload a file (PDF, DOCX, TXT, MD); subjects are auto-detected from the document using entity resolution; extracted Raw Context becomes Signals until promoted to Memory
- **Assignments** — My Queue / Delegated / All tabs with status-based filtering
- **HITL Approvals** — approve or reject pending agent action requests; sequence step cards show full email preview + enrollment progress with **Approve & Send** / **Decline & Skip** actions
- **Workflows** — create event-driven automations; start from 8 built-in GTM templates; per-action log drill-down in run history; variable syntax validated before save; crash-isolated editor sections
- **Sequences** — email sequence management; enrollment status filters (All / Active / Paused / Completed); Resume button for paused enrollments awaiting HITL approval
- **Emails** — compose, view, and track outbound emails with approval flow
- **Settings → Registries** — manage custom context types and activity types
- **Settings → Actors** — view and configure registered agents
- **Settings → Workspace Agent** — enable auto-extraction of context from activities; configure provider, model, and capability flags
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

Typed revenue objects, context, assignments, workflows, webhooks, email, actors, and admin surfaces have REST endpoints at `/api/v1/*`. MCP remains the complete agent-facing tool surface; use REST for integrations that cannot run MCP or for custom web tooling.

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
| `assignments:read` / `assignments:write` | Assignment lifecycle |
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
docs/roadmap-0.8-1.0.md    Enterprise systems-of-record roadmap
```

### Design decisions

- **MCP-first** — All CRM operations are MCP tools. REST API and CLI are thin wrappers around the same handlers.
- **Raw SQL** — No ORM. Every query is readable and auditable.
- **Event sourcing** — Every mutation appends to an `events` table. Full audit trail, never overwritten.
- **Scope enforcement** — API key scopes checked before every handler. Every MCP tool must be explicitly mapped to required scopes unless intentionally public.
- **Deterministic writes** — Mutating agent operations support idempotency, optimistic concurrency, transactions for compound writes, and mutation receipts.
- **Operational governance** — Admin tools expose queue health, audited recovery actions, data-quality checks/repairs, audit retrieval, privacy export/redaction/delete previews, and tenant retention cleanup.
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
npx @crmy/cli server     # starts the API, Web UI, and MCP HTTP endpoint on :3000
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
DATABASE_URL=postgresql://localhost:5432/crmy crmy seed-demo

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

- [**Post-Meeting Agent**](docs/recipes/post-meeting-agent.md) — Process call transcripts into structured customer context
- [**Outreach Agent**](docs/recipes/outreach-agent.md) — Briefing-driven outreach with HITL approval flow
- [**Pipeline Review Agent**](docs/recipes/pipeline-review-agent.md) — Weekly pipeline forecast, Memory Health review, and at-risk deal identification
- [**Renewal Risk Agent**](docs/recipes/renewal-risk-agent.md) — Account-wide risk review with semantic memory search and HITL escalation
- [**Context Governance Agent**](docs/recipes/context-governance-agent.md) — Stale review, contradiction detection, and context consolidation
- [**Public Signal Research Agent**](docs/recipes/public-signal-research-agent.md) - Source-linked public X/Twitter research with TweetClaw

---

## Roadmap

CRMy's 0.8-1.0 roadmap focuses on becoming the enterprise context and execution layer between AI agents and revenue systems of record. See [CRMy 0.8-1.0 Roadmap: Enterprise Systems-Of-Record Overlay](docs/roadmap-0.8-1.0.md) for the plan across Salesforce, HubSpot, Databricks, Snowflake, governed writeback, Automations, Sequences, HITL, and durable agent execution.

---

## What's in 0.8.0

0.8.0 introduces the Systems of Record overlay: governed connections to CRM and warehouse sources, typed-object sync, source metadata for Automations and Sequences, conflict review, and approval-safe external writeback.

- **Systems of Record settings** — connect HubSpot, Salesforce, Databricks, or Snowflake with encrypted credentials, setup guidance, schema discovery, mappings, sync runs, conflicts, and writebacks. HubSpot is the first certified 0.8 connector path; Salesforce and warehouse adapters share the same governed framework and require live environment validation before production rollout.
- **Governed connector framework** — adapters validate config, test connectivity, discover schema, pull changes, preview writes, execute approved writes, and redact secrets from errors.
- **Typed sync into CRMy** — external contacts, companies, deals, activities, and warehouse rows map into typed CRMy records while preserving external references and watermarks. Context-entry mappings are reserved for a follow-up connector-author flow and currently surface as sync conflicts instead of silently creating memory.
- **Automation and sequence integration** — sync events carry origin, system, record, changed-field, confidence, conflict, and sync-mode metadata; replayed sync events are audit-safe and do not re-run workflows by default.
- **Writeback safety** — external writes require mappings, allowed fields, writeback modes, idempotency, previews, policy results, HITL-compatible approval, execution receipts, and audit events.
- **Operator UX polish** — Systems of Record setup is source-agnostic, advanced controls are collapsible, empty states guide the next step, and CLI/MCP docs explain scoped tool exposure.

## Historical release notes

### v0.7 enterprise durability for agent state

CRMy's local-first context layer now has the safety rails expected for repeated enterprise agent runs:

- **Authenticated MCP sessions** — no anonymous fallback; constructed actors need explicit scopes.
- **Idempotent mutations** — retry-safe operation keys prevent duplicate writes after agent or network retries.
- **Optimistic concurrency** — core revenue objects expose `row_version` and support expected-version guards.
- **Transactional compound actions** — multi-record tools such as deal advancement and outreach commit or roll back as a unit.
- **Mutation receipts** — writes return actor, event, object, version, and side-effect metadata so agents can reason about what actually changed.
- **Context convergence** — duplicate/similarity/conflict checks before `context_add`, atomic supersession, contradiction assignment, and workflow replay lineage.
- **Operator controls** — `ops_status_get`, `ops_job_recover`, data-quality checks/repairs, audit retrieval, privacy export/redaction/delete, and retention cleanup.
- **CI durability workflow** — `.github/workflows/enterprise-durability.yml` runs unit durability checks and migrated-Postgres integration tests.

### v0.7 enterprise-grade context & memory

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

### v0.7 context import and Memory Graph

#### Context import — zero-friction ingestion

Context is the core value of CRMy. The 0.7 release line made adding it easier:

- **Model-backed subject detection** — paste any text and CRMy uses the configured Workspace Agent to identify likely contacts and companies, then grounds those candidates with entity resolution. No manual subject selection required when records can be confidently matched.
- **File upload** — drag and drop PDF, DOCX, TXT, or Markdown files. Text is extracted server-side (`pdf-parse` + `mammoth`) and subjects are detected automatically from the content.
- **Smart clipboard paste** — when you open the import dialog with an empty body, CRMy checks your clipboard. If it contains >100 characters, a banner offers to use it immediately.
- **MCP tool: `context_ingest_auto`** — for agents and CLI workflows, this tool ingests a document and resolves subjects automatically with the Workspace Agent plus entity resolution. No subject IDs needed. Pass a `confidence_threshold` to control how aggressively it links to customer records.

```
context_ingest_auto {
  document: "<full meeting transcript>",
  source_label: "Discovery call 2026-04-09",
  confidence_threshold: 0.6    // default
}
→ { subjects_resolved: [...], entries_created: 3 }
```

- **Auto-extract from activities** — configurable in Settings → Workspace Agent (`auto_extract_context` toggle). When enabled, the extraction pipeline runs automatically on every new activity.

#### Memory Graph — full redesign

The entity memory graph (`/contacts/:id/graph`, `/companies/:id/graph`) is now an Obsidian-style dark canvas visualization:

- **6 node types**: entity center, related objects, context type clusters, individual context entries, activities, and assignments
- **5-zone concentric radial layout**: related records on the right arc, context clusters on the left, leaf entries orbiting their cluster, activities and assignments in the lower arcs
- **Sidebar filter panel**: toggle context, related, activities, and assignments on/off without rebuilding the layout
- **Node detail Sheet**: clicking any node opens a full-width slide-in drawer with complete entry details — readable font sizes, full body text, tags, confidence indicators
- **MiniMap**: functional top-right minimap showing colored nodes for orientation

#### UI simplifications

- **Companies list**: removed the initials circle avatar — companies are organizations, not people
- **Context page**: keyword/semantic search toggle moved inline with the search bar
- **Dashboard**: Overview now summarizes Raw Context, Signals, Memory, and governed Handoffs; full Memory browsing moved to the dedicated Context page
- **BriefingPanel**: larger fonts, colored activity-type icons, activity count pill
- **ContextPanel**: larger fonts and more readable entry cards throughout
- **Navigation**: fixed horizontal scroll on collapsed left nav

---

### v0.6 developer experience

- **`crmy init` wizard** — auto-creates database, offers pgvector opt-in, seeds demo data, shows API key
- **`crmy init --yes`** — fully non-interactive setup for CI/Docker
- **`crmy doctor`** — 8-point diagnostic (Node version, DB, migrations, users, pgvector, port, JWT)
- **`crmy seed-demo`** — lifecycle demo data with stable UUIDs (Raw Context, Signals, Memory, Handoff, account, contact, opportunity, use case, activity, assignment)
- **Per-migration progress** — spinner updates per file during migrations
- **Node.js version gate** — clear error on Node < 20 instead of cryptic ESM failures

### MCP tools
- **Scoped MCP tool surface** with rewritten descriptions optimized for LLM tool selection
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
- **Render.com blueprint** — `render.yaml` with auto-provisioned DB and JWT secret
- **Docker Compose** — pgvector-ready Postgres, health checks, env var configuration
- **JWT secret enforcement** — server rejects known-bad secrets in production

### Documentation
- **6 agent recipe tutorials** with full MCP tool call sequences
- **CONTRIBUTING.md** — architecture overview, local dev setup, conventions
- **`.env.example`** — comprehensive reference for all environment variables

---

## License

Apache-2.0
