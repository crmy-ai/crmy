# CRMy User Guide

Complete documentation for CRMy, an open-source governed context layer for customer-facing agents. Use CRMy when an agent needs to act on customer context but must know what the customer actually said, what is stale or inferred, which actions are safe, and what proof exists. CRMy ingests transcripts, notes, emails, CRM changes, and other customer data; turns them into source-grounded Signals and confirmed Memory; and serves Action Context over MCP, REST, CLI, and the web UI so agents can act with evidence, policy, freshness checks, and receipts. It works connector-free (transcripts, notes, and emails are enough); CRM and warehouse systems of record are an optional upgrade.

New here? Run `npx -y @crmy/cli init --demo` then `npx -y @crmy/cli quickstart` to see the connector-free path end to end, or jump to [Getting Started](#getting-started).

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
19. [Experimental Automation](#experimental-automation)
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

# 2. Initialize with the demo proof state
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
export CRMY_ADMIN_EMAIL=admin@example.com
export CRMY_ADMIN_PASSWORD="$(openssl rand -base64 24)"
printf 'CRMy admin password: %s\n' "$CRMY_ADMIN_PASSWORD"
npx -y @crmy/cli init --demo

# 3. See the connector-free value end to end (the path an agent runs over MCP)
npx -y @crmy/cli quickstart

# 4. Start the server (REST API + MCP + Web UI at /app)
npx -y @crmy/cli server

# 5. Add to Claude Code as an MCP server
claude mcp add crmy -- npx -y @crmy/cli mcp
```

`quickstart` resolves a customer, returns a governed briefing, checks Action Context, and proves lineage — with no CRM connector configured. `npx -y @crmy/cli doctor` runs the same checks as a pass/fail health check, and `npx -y @crmy/cli agent-smoke` is the underlying smoke test.

Prefer prompts? Run `npx -y @crmy/cli init` and choose whether to load demo data when prompted.

Workspace Agent model setup is part of init. Interactive init checks for local Ollama first. If Ollama is unavailable, or you decline it, the wizard lets you choose from the same provider/model catalog used by the web Model Settings page and still supports a custom model ID.

The shared catalog currently includes Anthropic, OpenAI, Azure OpenAI, Google Gemini, Amazon Bedrock, Mistral, LiteLLM Proxy, OpenRouter, Ollama, Databricks AI Gateway, NVIDIA NIM, and other OpenAI-compatible endpoints. Backup provider failover is configured later in **Settings → Model**, not during init.

For non-interactive setup, either run Ollama locally with an installed model before `init --yes --demo`, or set provider variables:

```env
CRMY_AGENT_PROVIDER=openai
CRMY_AGENT_MODEL=gpt-5.2
CRMY_AGENT_API_KEY=sk-...
# CRMY_AGENT_BASE_URL=https://api.openai.com/v1
```

Use the model-backed smoke test to prove the full Source engine:

```bash
npx -y @crmy/cli agent-smoke --with-model
```

Use the local eval harness to score customer-context corpora and active-context
quality gates:

```bash
npx -y @crmy/cli eval list
npx -y @crmy/cli eval list --all
npx -y @crmy/cli eval run --profile contract
npx -y @crmy/cli eval run --profile seeded_context
npx -y @crmy/cli eval run --profile agent_runtime
```

The `contract` profile is the normal local/CI gate. It covers Source
extraction contracts, custom Memory registries, and account-scoped record
resolution without a model, database, or external service. These suites use
golden extraction fixtures and prove parser, promotion, readiness, and
resolution plumbing; they do not prove live extraction quality.

The `seeded_context` profile calls production briefing and Action Context
services against a small fixture DB, then scores retrieval recall, scope leaks,
stale warnings, readiness decisions, unsafe writeback allowance, and source
attribution safety. The `agent_runtime` profile adds runnable tool-choice and
trajectory smoke checks.

To run live extraction quality, configure an eval model and use the live
profile:

```bash
CRMY_EVAL_MODEL_PROVIDER=openai \
CRMY_EVAL_MODEL_BASE_URL=https://api.openai.com/v1 \
CRMY_EVAL_MODEL_NAME=gpt-5.2 \
CRMY_EVAL_MODEL_API_KEY=sk-... \
npx -y @crmy/cli eval run --profile live_model --require-live --output ./eval-runs
```

The live profile does not feed `golden_model_output` to the parser. It seeds an
eval activity DB, calls production `extractContextFromActivity` without
`modelOutputOverride`, and scores the persisted Signals, proposed records,
evidence alignment, extraction attempt telemetry, and Source receipt
status. The eval API key is loaded from the environment and encrypted in memory
for the same `callLLM` path used by tenant model settings; secrets are not
written to eval artifacts.

Without `--require-live`, the live profile exits as skipped when model
credentials are absent. Eval output can be written as native JSON plus JSONL
artifacts for Ragas/LangSmith-style offline analysis.

Semantic retrieval is optional but recommended for serious context work. It lets CRMy find related Signals and Memory by meaning instead of exact keywords. To enable it, use Postgres with the pgvector extension, set `ENABLE_PGVECTOR=true` before running migrations on a fresh database, and configure embedding variables in the server environment:

```env
ENABLE_PGVECTOR=true
EMBEDDING_PROVIDER=openai
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
```

Restart the server after changing these values, then run `crmy doctor` or check **Settings → Database → Semantic retrieval setup**. Model Settings configures the Workspace Agent; embeddings are server settings because they are used by background indexing and semantic search.

### Run the GTM agent demo

`init --demo` seeds the same demo data used by the web app. For CI or another fully headless setup, use `init --yes --demo`; for a clean workspace, use `init --yes --no-demo`. To reload demo data later:

```bash
crmy seed-demo --reset
```

Then follow the core CRMy workflow:

```bash
crmy briefing "account:Northstar Labs"
crmy action-context "account:Northstar Labs" --action customer_outreach
crmy context lineage --subject "account:Northstar Labs"
crmy context sources
crmy context signal-groups
crmy hitl list
```

In the web UI, open `/app` and follow **Sources → Signals → Memory → Handoffs**. The seeded Northstar Labs workflow shows a GTM agent path end to end: messy customer context is processed into Signals, confirmed items become Memory, risky decisions route to Handoffs, and system-of-record writeback remains governed.

For role-scoped QA, demo data also creates sample users:

```text
Admin   sample.admin@crmy.local / crmy-demo-123
Manager sample.manager@crmy.local / crmy-demo-123
Rep     sample.rep@crmy.local / crmy-demo-123
Peer    sample.peer@crmy.local / crmy-demo-123
```

Most CLI commands that work with customer records accept friendly references like `account:Northstar Labs`, `contact:Maya Patel`, `opportunity:Agent Context Rollout`, and `use_case:Production Rollout`. CRMy resolves the record inside your visible scope first. IDs are still expected for operational artifacts such as Handoff requests, source receipts, sync runs, and writeback requests.

### First-run product path

Start with the lifecycle, not the admin surfaces:

1. **Overview** shows the scoped Focus Queue: source issues, Signals to confirm, Handoffs to decide, stale Memory, and deal/account work that needs attention.
2. **Context** is the customer-context lifecycle: **Sources → Signals → Memory**. Lineage is available on demand when you need proof detail.
3. **Context → Sources** explains how context enters CRMy: Add Context, MCP/API, Customer Email, and Customer Activity.
4. **Handoffs** is where humans approve, reject, reassign, or complete governed decisions.
5. **Settings** is for workspace setup. Advanced automation, sequences, webhooks, semantic retrieval, system setup, registries, and reliability tools are opt-in administration surfaces, not first-run requirements.

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
export JWT_SECRET="$(openssl rand -hex 32)"
export CRMY_ENCRYPTION_KEY="$(openssl rand -hex 32)"
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
  -d '{"email":"you@example.com","password":"replace-with-a-unique-12-plus-character-password","name":"Your Name","tenant_name":"My Org"}'
```

**Option C — Environment variables (headless / Docker / CI)**

Set `CRMY_ADMIN_EMAIL`, `CRMY_ADMIN_PASSWORD`, and optionally `CRMY_ADMIN_NAME` in your environment or `docker-compose.yml` before starting the server. On first boot with no existing users, the server will create the admin account automatically:

```yaml
# docker-compose.yml
environment:
  DATABASE_URL: postgres://crmy:crmy@db:5432/crmy
  JWT_SECRET: "${JWT_SECRET:?Set JWT_SECRET with: openssl rand -hex 32}"
  CRMY_ENCRYPTION_KEY: "${CRMY_ENCRYPTION_KEY:?Set CRMY_ENCRYPTION_KEY with: openssl rand -hex 32}"
  CRMY_ADMIN_EMAIL: admin@yourcompany.com
  CRMY_ADMIN_PASSWORD: "${CRMY_ADMIN_PASSWORD:?Set a unique 12+ character admin password before first boot}"
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
git clone https://github.com/crmy-ai/crmy.git
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
  "encryptionKey": "...",
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
| `JWT_SECRET` | Server process | Generated by `crmy init` for local CLI-managed installs | Secret for JWT token signing; set explicitly for production, containers, or direct source server processes |
| `CRMY_ENCRYPTION_KEY` | Production | Generated by `crmy init` and local source dev startup for local installs | Secret for connector credentials, mailbox/calendar OAuth tokens, and Workspace Agent provider keys |
| `PORT` | No | `3000` | HTTP server port |
| `CRMY_TENANT_ID` | No | `default` | Default tenant slug |
| `CRMY_ALLOW_PUBLIC_REGISTRATION` | No | — | Set `true` to keep unauthenticated registration open after initial workspace setup |
| `CRMY_CORS_ORIGINS` | No | — | Comma-separated browser origins allowed to call the API cross-origin |
| `CRMY_PUBLIC_URL` | Hosted/proxied OAuth | request origin / `http://localhost:3000` | Public base URL used to generate mailbox/calendar OAuth redirect URIs behind tunnels, reverse proxies, or hosted domains |
| `CRMY_TRUST_PROXY` | No | — | Set to `1` when CRMy runs behind one trusted reverse proxy |
| `CRMY_API_KEY` | No | — | API key for CLI auth (overrides .crmy.json) |
| `CRMY_SERVER_URL` | No | — | Server URL for remote CLI mode |
| `CRMY_ALLOW_INSECURE_DB_TLS` | No | — | Production escape hatch for self-managed databases that cannot use `sslmode=verify-full`; leave unset unless you intentionally accept unverified DB TLS |
| `CRMY_LIST_TOTAL_MODE` | No | dev: `exact`, production: `estimate` | Controls high-volume list totals. `estimate` returns page-based totals with `total_is_estimate: true` to avoid expensive count scans; `exact` preserves precise counts. |
| `CRMY_AUTH_RATE_LIMIT_WINDOW_MS` | No | `900000` | Shared login/register rate-limit window; stored in PostgreSQL so multi-instance deployments cannot bypass auth throttles |
| `CRMY_AUTH_REGISTER_IP_LIMIT` / `CRMY_AUTH_REGISTER_IDENTITY_LIMIT` | No | `5` / `3` | Registration attempt limits per client IP and hashed email/workspace identity |
| `CRMY_AUTH_LOGIN_IP_LIMIT` / `CRMY_AUTH_LOGIN_IDENTITY_LIMIT` | No | `10` / `20` | Login attempt limits per client IP and hashed account identity |
| `CRMY_RATE_LIMIT_HASH_SECRET` | No | encryption key / JWT secret | Optional HMAC secret for hashing unauthenticated rate-limit identities before storage |
| `CRMY_RATE_LIMIT_BUCKET_RETENTION_HOURS` | No | `24` | Background cleanup retention for authenticated and unauthenticated rate-limit buckets |
| `CRMY_PROCESS_ROLE` | No | `all` | Runtime role. `all` keeps local installs simple; `web` serves HTTP/MCP/UI without periodic workers; `worker` runs periodic background jobs without binding an HTTP port. |
| `CRMY_MIGRATION_MODE` | No | dev: `auto`, production: `validate` | Startup migration behavior. `auto` applies pending migrations on startup, `validate` fails startup when migrations are pending, and `skip` bypasses startup checks. Hosted deployments should run `crmy migrate run` as a one-shot job before starting web/worker roles. |
| `LLM_TIMEOUT_MS` | No | `60000` | Hard timeout for general background LLM calls |
| `AGENT_STREAM_TIMEOUT_MS` | No | `60000` | Hard timeout for streaming Workspace Agent provider calls |
| `CONTEXT_EXTRACTION_LLM_TIMEOUT_MS` | No | `90000` | Hard timeout for Sources → Signals extraction |
| `CONTEXT_EXTRACTION_RECOVERY_TIMEOUT_MS` | No | `45000` | Fallback extraction timeout after an empty valid response |
| `CONTEXT_EXTRACTION_REPAIR_TIMEOUT_MS` | No | `30000` | JSON repair timeout after malformed model output |
| `RAW_CONTEXT_SUBJECT_MATCH_TIMEOUT_MS` | No | `15000` | Hard timeout for automatic Source record matching |
| `CRMY_DEPLOYMENT_MODE` | No | `single_instance` | Set `multi_instance` only when each app has `CRMY_INSTANCE_ID` and sticky MCP routing |
| `CRMY_INSTANCE_ID` | Multi-instance | — | Stable unique id for this app process; required for durable MCP session ownership |
| `CRMY_MCP_SESSION_MODE` | Multi-instance | — | Must be `sticky` for multi-instance deployments; route by `mcp-session-id` |
| `CRMY_BROWSER_COOKIE_AUTH` / `VITE_CRMY_BROWSER_COOKIE_AUTH` | Hosted browser auth | — | Set both to `true` for hosted browser sessions so JWTs are carried in HttpOnly cookies instead of `localStorage`; required for `CRMY_DEPLOYMENT_MODE=multi_instance` unless explicitly overridden |
| `CRMY_ALLOW_BROWSER_BEARER_AUTH` | No | — | Private-deployment escape hatch that allows multi-instance browser bearer-token auth; do not use for hosted SaaS |
| `CRMY_MCP_SESSION_TTL_SECONDS` | No | `1800` | Durable MCP session expiry window |
| `CRMY_MCP_STALE_INSTANCE_SECONDS` | No | `120` | Expire sessions owned by app instances that stop heartbeating |
| `SOURCE_SYNC_FETCH_TIMEOUT_MS` | No | `30000` | Mailbox/calendar provider HTTP timeout |
| `CRMY_CONTEXT_DROP_FETCH_TIMEOUT_MS` | No | `SOURCE_SYNC_FETCH_TIMEOUT_MS` / `30000` | Transcript-drop S3-compatible fetch timeout |
| `CRMY_CONTEXT_DROP_MAX_S3_LIST_PAGES` | No | `10` | Safety cap for one S3-compatible transcript-drop sync. Narrow prefixes or raise deliberately for very large buckets. |
| `CRMY_ALLOW_CUSTOM_CONTEXT_DROP_ENDPOINTS` | No | — | Production escape hatch for custom S3-compatible endpoints. Leave unset for hosted SaaS unless egress is explicitly trusted. |
| `CRMY_ALLOW_PRIVATE_CONTEXT_DROP_ENDPOINTS` | No | — | Self-hosted escape hatch for local/private S3-compatible endpoints such as MinIO. Do not enable in hosted SaaS. |
| `CRMY_ALLOW_PRIVATE_MCP_CONNECTORS` | No | — | Self-hosted escape hatch for MCP Knowledge connectors that intentionally target local/private-network MCP servers. Do not enable in hosted SaaS. |
| `CRMY_MANAGED_OAUTH_APPS_ENABLED` | Hosted SaaS | — | Enables CRMy-managed Google/Microsoft OAuth apps as the default Context Connectors app source |
| `CRMY_MANAGED_GOOGLE_CLIENT_ID` / `CRMY_MANAGED_GOOGLE_CLIENT_SECRET` | Hosted SaaS | — | CRMy-managed Google OAuth app used for hosted mailbox and calendar consent when no tenant-owned override exists |
| `CRMY_MANAGED_MICROSOFT_CLIENT_ID` / `CRMY_MANAGED_MICROSOFT_CLIENT_SECRET` | Hosted SaaS | — | CRMy-managed Microsoft OAuth app used for hosted mailbox and calendar consent when no tenant-owned override exists |
| `CRMY_MANAGED_MICROSOFT_TENANT_ID` | Hosted SaaS | `common` | Microsoft tenant for the CRMy-managed Microsoft OAuth app |
| `GOOGLE_MAIL_CLIENT_ID` / `GOOGLE_MAIL_CLIENT_SECRET` | Self-hosted mailbox OAuth | — | Google OAuth app credentials for Gmail Mailbox Context and sender identity |
| `GOOGLE_MAIL_REDIRECT_URI` | Mailbox OAuth | `/api/v1/mailbox/oauth/google/callback` | Override Google mailbox OAuth callback URL |
| `MICROSOFT_MAIL_CLIENT_ID` / `MICROSOFT_MAIL_CLIENT_SECRET` | Self-hosted mailbox OAuth | — | Microsoft Entra app credentials for Outlook Mailbox Context and sender identity |
| `MICROSOFT_MAIL_REDIRECT_URI` | Mailbox OAuth | `/api/v1/mailbox/oauth/microsoft/callback` | Override Microsoft mailbox OAuth callback URL |
| `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` | Self-hosted calendar OAuth | — | Google OAuth app credentials for Customer Activity calendar context |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Calendar OAuth | `/api/v1/calendar/oauth/google/callback` | Override Google Calendar OAuth callback URL |
| `MICROSOFT_CALENDAR_CLIENT_ID` / `MICROSOFT_CALENDAR_CLIENT_SECRET` | Self-hosted calendar OAuth | — | Microsoft Entra app credentials for Customer Activity calendar context |
| `MICROSOFT_CALENDAR_REDIRECT_URI` | Calendar OAuth | `/api/v1/calendar/oauth/microsoft/callback` | Override Microsoft Calendar OAuth callback URL |
| `MICROSOFT_TENANT_ID` | Microsoft OAuth | `common` | Microsoft tenant for OAuth authorization |
| `CONNECTOR_FETCH_TIMEOUT_MS` | No | `30000` | Systems-of-record connector HTTP timeout |
| `SLACK_SEND_TIMEOUT_MS` | No | `10000` | Slack webhook delivery timeout |

For hosted deployments, run at least one `CRMY_PROCESS_ROLE=worker` process. Workers own periodic recovery work, including pending webhook deliveries and webhook delivery creation for persisted events that were emitted by web processes before an in-process subscriber could run.

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
- `*` — full access for trusted operator credentials only. Do not use this for normal agents.

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
| `*` | Everything; reserved for explicitly trusted operator credentials |

**How scopes are enforced:**

- Human login JWTs resolve the current user and actor from the database. Owner/admin roles receive the setup and operator scopes needed for first-run administration; member and manager roles receive normal read/write defaults and still respect object-level visibility.
- API keys carry explicit scopes. If a key is bound to an actor, the effective scope set is the intersection of the key scopes and that actor's active scopes.
- MCP sessions filter the tool manifest before an agent sees it, then requests have their scopes checked against `TOOL_SCOPES` again before any tool handler runs.
- If a required scope is missing, the server returns HTTP 403 with a message identifying exactly which scope was needed.

See the [Scope Enforcement](#scope-enforcement) section for the complete reference.

#### Agent Self-Registration

Agents can submit a self-registration request with an existing authenticated CRMy token. Self-registered agents start read-only, inactive, and pending review; an owner/admin activates the actor and grants the workflow-specific scopes from Settings → Actors.

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

Response includes the created (or existing) pending actor record and a bound read-only API key:

```json
{
  "actor": { "id": "...", "display_name": "Outreach Agent", ... },
  "api_key": {
    "id": "...",
    "label": "Outreach Agent auto",
    "key": "crmy_...",
    "scopes": ["read"]
  }
}
```

The operation is idempotent — calling it twice with the same `agent_identifier` returns the existing actor (no duplicate). `requested_scopes` documents what the agent is asking for; it is not granted automatically. An admin can activate the agent and expand scopes from the Settings → Actors panel.

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

Admins and owners see the Command Center for the context engine. A compact flow shows **Sources → Signals → Memory → Handoffs** so operators can see setup status, source volume, reviewable Signals, Current Memory, and pending governed decisions. A second **Memory Health** tab keeps stale and contradictory Memory review close to the command center.

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

Meeting and activity capture for customer context. Tabs cover **Meetings**, **Needs Context**, **Calls & Notes**, **All Activity**, and **Meeting Sources**. Calendar meetings can link to customer records, show missing transcript/notes status, and route directly into Add Context for Signal extraction. Transcript and note drops are surfaced as meeting context: admins configure source drops from **Meeting Sources**. Regular users see linked transcript review items for records they can access; fully unmatched source objects stay admin-reviewable until they are linked safely.

#### Customer Email (`/app/emails`)

Customer-facing inbox and governed outbound drafting. Tabs cover **Mailbox Context**, **Needs Review**, **Outbound Actions**, and **Mailboxes & Senders**. CRMy filters internal email noise, links customer messages to revenue records, saves useful messages as Sources, and routes agent-generated drafts through visible sender identity and review.

#### Handoffs (`/app/handoffs`)

Action-oriented queue for human decisions and delegated work. Tabs cover **Needs Attention**, **Delegated**, and **All**. Handoff detail drawers show the decision packet, linked record, evidence, policy reason, reviewer/assignee, due/SLA, reassignment controls, and Approve/Reject/Resolve actions.

#### Workspace Agent (`/app/agent`)

Scoped GTM workbench for asking questions, retrieving Active Context, using CRMy tools, attaching temporary context, and saving source material as Sources. The agent runs with the current human user's visibility, not admin bypass permissions. Turns are persisted with streamed events, worker leases, and heartbeats so users can navigate away and return while long-running work continues or is recovered by another worker. When a tool supports idempotency, CRMy attaches a stable operation key for the turn so replayed agent work does not duplicate the same write. On recovery, already-persisted successful tool results are reused instead of executed again. Successful write/action tools are summarized back into the turn so the final response can clearly state what changed.

#### Actors (`/app/settings/actors`)

Admin-only actor and user management for humans, agents, scopes, API keys, registrations, and work-app coverage. Human actors show binary mailbox/calendar/sender badges first; expanded details show the connected email address, provider, connection date, last sync, latest message/event, processed volume, Sources, Signals, Memory, and any sync or sender issue. Admins can pause a mailbox/calendar without deleting OAuth tokens, or disconnect it when the actor needs to reauthorize.

#### Context (`/app/context`)

The Context page is the dedicated workspace for the customer-context lifecycle. Sources is the user-facing label for raw observations and source material. The primary tabs are:

- **Sources tab**: source volume and recent processing outcomes across activities, calendar events, inbound/outbound emails, Add Context imports, Systems of Record sync runs, MCP/REST/CLI context writes, and future source types. Source rows link to Lineage so users can trace Sources into Signals, Memory, Handoffs, and actions.
- **Signals tab**: inferred customer claims that need confirmation, dismissal, more evidence, or Handoff review before agents rely on them
- **Memory tab**: confirmed operational customer context agents retrieve into Active Context through briefings and search
- **Lineage tab**: source-to-action timeline showing how Sources produced Signals, confirmed Memory, handoffs, writebacks, and audit history
- **Sources action**: secondary link for choosing how context enters CRMy: Add Context, MCP/API, Customer Email, and Customer Activity
- **Graph action**: secondary link for record-centered exploration of related records, Current Memory, recent activity, and open handoffs
- **Dual search modes**: keyword (full-text, client-side) and **semantic** (pgvector similarity). The toggle sits inline in the search bar. If semantic retrieval is not ready after a semantic search, the results area explains that CRMy is showing keyword matches. Admins see a direct link to Database Settings; non-admin users are prompted to ask an admin.
- **Database connection editing**: local setup can test a Postgres URL and write `.env.db`; hosted/production deployments show the current connection and semantic status but keep connection changes in server environment configuration.
- **Filter** by subject type (contact, account, opportunity, use case) and context type
- **Needs Review toggle** to surface Current Memory past its `valid_until` date
- Confidence score pills, review-date highlighting, and `is_current` badges
- Inline **"Mark reviewed"** action for Memory that has been reverified
- **Add Context dialog**:
  - **Paste text tab**: paste transcripts, emails, meeting notes, support updates, or research; subjects are auto-detected and shown as colored chips
  - **Upload file tab**: drag-and-drop or browse for PDF, DOCX, TXT, or Markdown; text is extracted server-side and subjects detected automatically; file name, size, and a text preview are shown before confirming
  - Both tabs allow adding or removing detected subjects and providing a source label
  - Submit records a Source, preserves selected subject links, and runs extraction so useful claims become Signals or Memory according to readiness rules

#### Context Graph (`/app/context?tab=graph`) {#context-graph}

Context Graph is a record-centered explorer, not the full Memory lifecycle view. Select a customer record to explore related records, Current Memory, recent activity, and open handoffs. Use **Context → Lineage** when you need to trace Sources through Signals, Memory, Handoffs, writebacks, and audit receipts.

Click any graph node to open a detail drawer with key fields, content preview, and links back to the underlying record or context item.

#### Settings (`/app/settings`)

Role-aware settings:
- **Profile**: name, email, role, and personal appearance preferences
- **API Keys**: create new keys (shown once), list existing, revoke
- **Admin-only setup**: Model Settings, Systems of Record, source filters, Actors, Webhooks, Custom Fields, Registries, Action Policies, Automation Experiments, Reliability, and Audit Log
- **Tenant identity**: read-only workspace/tenant details for admins

#### Workspace Agent settings (`/app/settings/model`)

Controls the agent that performs background intelligence tasks for your tenant.

**Section 1 — Enable**: master on/off switch.

**Section 2 — Provider & Model**: select Anthropic, OpenAI, Azure OpenAI, Google Gemini, Amazon Bedrock, Mistral, LiteLLM Proxy, OpenRouter, Ollama, Databricks AI Gateway, NVIDIA NIM, or another OpenAI-compatible endpoint. Enter the API key or gateway token when required (stored encrypted, shown only as a hint after saving). Model pricing is estimated per-turn based on `max_tokens_per_turn`.

**Backup provider**: optional failover model used only when the primary provider call fails. Configure and test it after the primary provider is working. Backup provider failures do not bypass scoped permissions or write policies.

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
- **Sources** are incoming source material before extraction: calls, emails, transcripts, notes, systems-of-record updates, documents, and MCP/REST/CLI inputs.
- **Signals** are inferred, evidence-backed claims from Sources. Confirmed Signals become Memory; uncertain or risky Signals stay separate or route to Handoffs.

The normal flow is:

```text
Sources -> Signals -> Memory -> Active Context -> Handoffs / writeback
```

Agents should retrieve Memory into Active Context with `briefing_get`, `context_search`, or semantic search before making recommendations or preparing writes. Lineage explains where Memory came from; Active Context is what the model is using right now.

### MCP-First Architecture

All customer-context operations are defined as **MCP tools**. REST exposes the same actor-scoped tool surface, and the CLI is a thin wrapper over those tools. Friendly CLI commands cover setup, demos, Source ingestion, activity/email review, systems, knowledge, and operational QA; experimental workflow and sequence commands remain opt-in. `crmy tools list`, `crmy tools describe <tool_name>`, and `crmy tools call <tool_name>` provide direct access to the full visible MCP tool set. UI-first admin wizards such as mailbox/calendar OAuth and provider setup remain REST/UI surfaces because they involve redirects or secrets.

Use high-level tools for most revenue agents: `briefing_get`, `customer_record_resolve`, `crm_search`, `context_ingest_auto`, `context_ingest`, `activity_create`, Signal promotion/handoff tools, compound actions, assignments, and HITL. Use `context_ingest_auto` for messy transcripts, emails, notes, and research; use `customer_record_resolve` when an agent needs to resolve a customer record before briefing or action. Reserve `context_add`, setup, mapping, operations, workflow administration, compatibility lookup tools, and systems-of-record tools for operator agents or human admins with explicit scopes.

**Four ways to interact:**

1. **MCP (stdio)** — `crmy mcp` starts an MCP server over stdio for Claude Code
2. **MCP (HTTP)** — `POST /mcp` endpoint for remote MCP clients (Streamable HTTP transport)
3. **REST API** — `GET/POST/PATCH/DELETE /api/v1/*` endpoints for traditional integrations
4. **CLI** — `crmy <command>` for friendly terminal workflows, or `crmy tools describe <tool_name>` and `crmy tools call <tool_name>` for direct access to any visible MCP tool

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
| `contact_delete` | Archive a contact while preserving evidence and lineage anchors. Admin/owner role required. |

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
| `account_create` | Create an account. Required: `name`. Optional: `domain`, `additional_domains`, `industry`, `employee_count`, `annual_revenue`, `currency_code`, `website`, `parent_id`, `aliases`, `tags`, `custom_fields` |
| `account_get` | Get an account with its contacts and open opportunities |
| `account_search` | Search with filters: `query`, `industry`, `owner_id`, `min_revenue`, `tags`. Query matches name, primary/additional domains, and any alias. |
| `account_update` | Patch any fields. Supports `aliases` and `additional_domains` arrays. |
| `account_set_health_score` | Set score (0-100) with `rationale` |
| `account_get_hierarchy` | Get parent/child tree |
| `account_merge` | Merge a duplicate account into a primary account. Moves contacts, opportunities, activities, context, email, calendar links, and domains, then archives the duplicate. Admin/owner role required. |
| `account_split_domains` | Move one or more domains from an account to another account. Can also move matching contacts, email, meetings, and opportunity links. Admin/owner role required. |
| `account_delete` | Archive an account while preserving evidence and lineage anchors. Admin/owner role required. |

### Domain collisions and cleanup

Account domains are globally unique inside a tenant because CRMy uses them to associate mailbox and calendar context with the right customer. If a user adds a primary or additional domain that already belongs to another account, CRMy returns a conflict with the domain, owning account id/name, and current owner domain so the user can open the right record instead of guessing.

Admins can repair collisions in two ways:

- **Move domains** when a company record has extra domains that belong to another account. Use the account drawer's Account Governance section, `POST /api/v1/accounts/:id/split-domains`, or `account_split_domains`.
- **Merge accounts** when the collision reveals duplicate customer records. Use the account drawer's Account Governance section, `POST /api/v1/accounts/:id/merge`, or `account_merge`.

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
POST   /api/v1/accounts/:id/split-domains { target_account_id, domains, move_matching_records? } (admin/owner only)
POST   /api/v1/accounts/:id/merge         { secondary_id } (admin/owner only)
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
| `opportunity_delete` | Archive an opportunity while preserving evidence and lineage anchors. Admin/owner role required. |
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

Customer Activity is the meeting/call/note context feed. Calendar meetings, phone calls, in-person meetings, notes, and manually logged interactions can become Source when they include a transcript, debrief, or summary. The activity model supports polymorphic subjects (any customer record), structured `detail` payloads, `occurred_at` timestamps for retroactive logging, and `outcome` tracking.

Calendar capture is optional. Meeting transcripts and call notes can still feed context through **Add Context**, `activity_add_context`, `calendar_event_add_context`, or `context_ingest_auto`.

Calendar and meeting association uses the same account-first Subject Graph resolver as Source extraction. CRMy still uses deterministic attendee email and account-domain matching first, including account **Additional Domains**, but opportunity and use-case links are only added when the resolver can identify them inside the matched account scope. Ambiguous child records stay reviewable instead of being guessed.

Availability suggestions are action-boundary context, not raw calendar memory. Agents can call `availability_suggest_times` with a customer record, date range, duration, timezone, and optional internal actor IDs. CRMy checks connected internal actor calendars through provider free/busy, ranks windows with customer timing preferences from Memory, and returns clear caveats. It does not expose raw calendar event details, does not confirm customer availability unless that person explicitly exists as a connected calendar actor, and does not create or send calendar invites.

### Transcript & Notes Drops

Transcript drops are admin-managed storage connections for teams that already export meeting transcripts, call notes, summaries, or source notes into a bucket or folder. The first supported providers are:

- **S3-compatible bucket**: bucket, prefix, region, optional endpoint/path-style mode, include/exclude globs, encrypted read/list credentials. Hosted production blocks custom/private endpoints by default; use AWS S3 without `endpoint`, or enable the custom/private endpoint escape hatches only for trusted self-hosted deployments.
- **Local folder**: local/self-hosted only, restricted to `CRMY_LOCAL_SOURCE_ROOTS`; disabled in hosted production unless `CRMY_ENABLE_LOCAL_CONTEXT_DROPS=true`.

Dropped files follow the same context path as manually added meeting notes:

`Source Object -> Meeting Artifact / Customer Activity -> Sources -> Signals -> Memory -> Lineage / Handoff`

Supported formats are `.txt`, `.md`, `.vtt`, `.srt`, `.json`, `.docx`, and `.pdf`. VTT/SRT/JSON are normalized before extraction. Files larger than `CRMY_CONTEXT_DROP_MAX_OBJECT_BYTES` enter review with a friendly reason instead of being downloaded or processed silently. S3 downloads use a hard timeout and active sync/reprocess jobs are deduped, so retries do not create duplicate work. Long transcripts are chunked, but each chunk carries the parent source hash so one long transcript does not count as multiple independent sources.

Sidecar metadata is optional but recommended. Put a JSON file beside the transcript with the same basename:

```json
{
  "title": "Northstar renewal review",
  "meeting_start": "2026-06-20T17:00:00Z",
  "meeting_end": "2026-06-20T17:45:00Z",
  "organizer_email": "cody@example.com",
  "attendees": ["alex@northstarlabs.com"],
  "source_url": "https://example.com/transcript",
  "account_id": "<optional-account-id>",
  "calendar_event_id": "<optional-calendar-event-id>",
  "source_authorship": "customer_or_external",
  "customer_authored": true
}
```

Matching order is explicit IDs first, then provider calendar IDs, meeting time plus attendee overlap, contact email/account domains including Additional Domains, then Subject Graph resolution from the title, attendees, excerpt, and hints. Unmatched or ambiguous files appear in **Customer Activity -> Needs Context** and create a Handoff so a human can link, ignore, or reprocess them. Reviewers see the source object, match reason, candidate records, excerpt, and downstream lineage links.

A repeatable synthetic fixture lives in [`examples/transcript-drop`](../examples/transcript-drop/README.md). Use it for local-folder smoke tests or upload the same basename pair to an S3-compatible test bucket to verify discovery, sidecar matching, review, processing, and lineage without real customer content.

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
| `activity_add_context` | Add debrief notes, transcript, or summary to an existing activity and process it as a Source |
| `activity_complete` | Mark as completed with optional timestamp and note |
| `activity_update` | Patch `subject`, `body`, `status`, `due_at` |
| `activity_get_timeline` | Get timeline for any subject object |
| `availability_suggest_times` | Suggest meeting windows from connected internal calendar free/busy plus customer timing preferences from Memory. Returns caveats and does not create invites |
| `calendar_connection_list` | List calendar connections and meeting-capture health |
| `calendar_event_search` | Search customer meetings by validation and processing state |
| `calendar_event_get` | Get one meeting and linked artifacts |
| `calendar_event_process` | Process a ready meeting as a Source |
| `calendar_connection_start` | Start Google or Microsoft calendar OAuth from MCP/CLI and return a browser `auth_url` for the current human-linked actor |
| `calendar_event_add_context` | Add transcript/notes/summary to a meeting and process it |
| `meeting_classification_list` | List tenant meeting classifications |
| `context_source_connection_list/create/update/delete/sync` | Admin tools for transcript/raw-note storage drops |
| `context_source_object_list/get/resolve/reprocess/ignore` | Review, link, process, or skip transcript/raw-note source objects |

### CLI

```bash
crmy activities list --subject "account:Northstar Labs"
crmy activities meetings
crmy activities meeting <id>
crmy activities add-context <id> --file transcript.txt --type transcript
crmy activities process <id>
crmy activities connections
crmy activities connect-calendar google --scope owned_accounts
crmy activities transcript-sources
crmy activities transcript-source create-local --name "Local transcripts" --path /tmp/crmy-transcripts
crmy activities transcript-source create-s3 --name "Meeting transcripts" --bucket crmy-transcripts --region us-east-1 --access-key-id ... --secret-access-key ...
crmy activities transcript-source sync <id>  # manual refresh/retry; creation queues the first sync
crmy activities transcripts --status needs_review
crmy activities transcript resolve <id> --account <account-id>
crmy activities classifications
crmy tools call availability_suggest_times '{"account_id":"<account-id>","duration_minutes":30,"timezone":"America/Los_Angeles","limit":3}'
```

### REST API

```
GET    /api/v1/activities?contact_id=...&type=call
POST   /api/v1/activities
PATCH  /api/v1/activities/:id
POST   /api/v1/activities/:id/context
GET    /api/v1/calendar/connections
POST   /api/v1/calendar/connections/:provider/start
PATCH  /api/v1/calendar/connections/:id/status
POST   /api/v1/calendar/connections/:id/sync
GET    /api/v1/calendar-events
GET    /api/v1/calendar-events/:id
POST   /api/v1/calendar-events/:id/process
POST   /api/v1/calendar-events/:id/artifacts
GET    /api/v1/context-source-connections
POST   /api/v1/context-source-connections
PATCH  /api/v1/context-source-connections/:id
DELETE /api/v1/context-source-connections/:id
POST   /api/v1/context-source-connections/:id/sync
GET    /api/v1/context-source-objects
GET    /api/v1/context-source-objects/:id
POST   /api/v1/context-source-objects/:id/resolve
POST   /api/v1/context-source-objects/:id/reprocess
POST   /api/v1/context-source-objects/:id/ignore
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

The Context Engine turns Source into reviewable Signals and Current Memory attached to customer records. Context entries are structured, typed, searchable, and carry metadata for agent consumption:

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

`context_ingest` takes Source (transcript, email, meeting notes) for a known record and runs the full extraction pipeline, creating an activity as provenance and returning a processing receipt plus the Signals and Memory produced:

```
context_ingest {
  subject_type: "opportunity",
  subject_id: "...",
  document: "<full meeting transcript>",
  source_label: "Q2 kickoff call"
}
```

Returns `{ extracted_count, memory_created, signals_created, skipped, signals, memory_entries, context_entries, activity_id, source, processing_receipt }`. `context_entries` is retained for broad clients; agents should use `signals`, `memory_entries`, and `processing_receipt.next_action` to decide whether to review, promote, retry, or brief.

### Signals and Memory

CRMy separates messy Sources from Current Memory:

- **Sources** are raw source material: calls, emails, notes, transcripts, calendar meetings, CRM/warehouse changes, REST/API payloads, MCP submissions, and manual Add Context flows. Source metadata can represent Slack, support, product usage, documents, and custom systems when those systems feed CRMy through API, MCP, or adapters.
- **Signals** are inferred context extracted from Sources. They include confidence and evidence, but they are not confirmed truth.
- CRMy combines related Signals into one evidence-backed claim so multiple sources can support, strengthen, or contradict the same inference.
- **Memory** is Current typed operational context. Briefings and normal context search return Memory by default.

Source support levels:

| Level | Sources | Current behavior |
|---|---|---|
| First-class ingestion | Add Context, REST, MCP, CLI, Customer Email, Customer Activity/calendar, systems-of-record sync | Creates Source receipts, Signals, Memory candidates, and lineage/audit metadata. |
| Metadata-supported sources | Support records, product usage, Slack, documents, research packets, custom source types | Can be represented in source/evidence metadata when fed through first-class ingestion paths. |
| Future first-class adapters | Inbound Slack, support desk, product telemetry, document repositories | Planned adapter surface; not currently built-in inbound connectors. |

Every Signal and important Memory entry should read as a **claim with evidence**. The claim is the entry body. Evidence records source type, source ID/reference, source URL when available, source label, speaker or author, snippet, observed timestamp, captured timestamp, support confidence, rationale, and optional verification metadata. This lets an agent explain, for example, “Budget approval is a risk” together with the meeting excerpt and date that support the claim.

Extraction stays tolerant of messy customer context. CRMy can keep an incomplete but useful Signal, then mark what it needs before it becomes Memory. Readiness language is intentionally operational: **Ready for Memory**, **Needs more detail**, **Needs supporting evidence**, **Needs review before agents can act**, or **Could affect forecast, approval required**. Internally, context type registries define the typed details that make a Signal actionable; developer/API docs may call these JSON schemas, but the product concept is typed Memory readiness.

Corroborated Signals should be promoted before they are used to coordinate work, influence forecast, update external systems, assign tasks, or guide customer engagement. Use `context_signal_group_promote` for grouped/corroborated claims, `context_signal_promote` for a single reviewed Signal, and the reject tools when a claim should stay out of Memory.

Signal auto-promotion is intentionally narrow. A Signal can auto-promote only when extraction auto-promotion is enabled, supporting evidence exists, the claim is not speculative, typed Memory readiness is complete enough for its context type, the group score meets the configured confirmation threshold, no unresolved conflict or duplicate-source inflation blocks the group, and policy allows promotion for the current actor without approval. If any gate fails, the Signal remains reviewable and can be repaired with `context_signal_group_complete_details`, strengthened with more evidence, sent to Handoff, rejected, or confirmed manually when allowed.

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
    { "entity_type": "account", "id": "...", "name": "Northstar Labs", "confidence": "high", "entries_created": 3, "memory_created": 2, "signals_created": 1, "activity_id": "...", "processing_receipt": { "status": "needs_review", "next_action": "Review Signals and confirm ready items as Memory." } },
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

Each raw input also creates or updates a Source processing record with the source type, source reference, linked subject, processing stage, status, extracted Signal count, Memory count, skipped count, and failure reason when available. This gives operators and agents one place to understand whether a transcript, email, system update, MCP write, or import produced useful Signals and Memory.

Use `context_extract { activity_id }` to manually re-run extraction on any activity.

### Catch-up diff

`context_diff` shows what changed about a subject since a timestamp — useful for daily agent check-ins:

```
context_diff {
  subject_type: "account",
  subject_id: "...",
  since: "7d",   // or "24h", "30m", or ISO timestamp
  limit: 50      // max entries per bucket; default 50, max 100
}
```

Returns:
- `new_entries` — context created since the timestamp
- `superseded_entries` — entries that were replaced (the old, now-inactive versions)
- `newly_stale` — entries whose `valid_until` fell within the window
- `resolved_entries` — entries that were reviewed (confirmed accurate) in the window
- `summary` — counts of each returned category and per-bucket `truncated` flags

If a `summary.truncated` bucket is true, narrow the time window or fetch specific entries before treating the diff as complete.

### MCP tools

| Tool | Description |
|---|---|
| `context_ingest_auto` | Ingest a Source and automatically resolve mentioned entities — **no subject IDs needed**. Configurable `confidence_threshold`; optional `subjects` lets an app/agent pin a known record. Recommended for agents processing transcripts, emails, notes, and research. |
| `context_ingest` | Ingest a Source and auto-extract structured Signals for a known subject. Requires explicit `subject_type` + `subject_id`. Returns a Source processing receipt. |
| `context_source_list` | List Source processing records with source, status, stage, Signal count, Memory count, skipped count, and failure reason. |
| `context_source_get` | Inspect one Source processing record. |
| `context_add` | Advanced direct write for Current Memory or an evidence-backed Signal. Required: `subject_type`, `subject_id`, `context_type`, `body`. Optional: `memory_status`, `confidence`, typed `evidence`, `tags`, `valid_until`, `structured_data`, `source_activity_id`. Signals require evidence; `rejected` and `superseded` are lifecycle states managed by review tools. |
| `context_get` | Get by ID (includes superseded entry if applicable) |
| `context_list` | List entries for an object. Filter by `memory_status`, `context_type`, `tags`, `is_current`, `authored_by`, `structured_data_filter` |
| `context_search` | Full-text search across Memory by default. Pass `memory_status: "signal"` to search Signals. |
| `context_signal_group_list` | List corroborated Signal claims with aggregate confidence, support count, source count, status, and conflict state. |
| `context_signal_group_get` | Inspect one corroborated Signal with supporting/conflicting evidence. |
| `context_lineage_get` | Trace Sources through Signals, Memory, Handoffs, writebacks, and audit events. |
| `context_signal_group_complete_details` | Add missing typed Signal detail, such as stakeholder role or deal-risk severity, and recompute readiness. This updates only unconfirmed Signal structured data; it does not edit CRM records or promote Memory. |
| `context_signal_group_promote` | Confirm a corroborated Signal into Current Memory. |
| `context_signal_handoff` | Route a Signal to Handoff when policy, conflict, or risk requires human review before promotion. |
| `context_signal_group_reject` | Dismiss a corroborated Signal while preserving evidence for audit. |
| `context_signal_promote` | Promote a reviewed Signal into Current Memory |
| `context_signal_reject` | Reject a Signal while preserving evidence for audit |
| `context_supersede` | Replace an entry with updated content |
| `context_review` | Mark an entry as reviewed (confirm still accurate) |
| `context_stale` | List Current Memory past `valid_until` that needs review |
| `context_diff` | Bounded catch-up diff since a timestamp: new, superseded, stale, resolved, and truncation flags |
| `context_extract` | Re-run the extraction pipeline on a specific activity (backfill or retry) |
| `context_stale_assign` | Trigger the Memory Health review loop on-demand for the current tenant |
| `context_semantic_search` | Semantic (vector) similarity search using pgvector. Falls back gracefully with `fallback_available: true` if pgvector or embeddings are not configured. Requires a pgvector-capable database, `ENABLE_PGVECTOR=true`, and server-side `EMBEDDING_PROVIDER` settings. |
| `context_embed_backfill` | Generate embeddings for context entries that have not yet been embedded. Use `dry_run: true` first to see pending count. |

`context_lineage_get` also returns an `outcomes` rollup. Use it after sends, approvals, writebacks, assignment completion, or workflow/sequence steps to see completed outcomes, pending human or system work, failed side effects, and recommended follow-up before the next agent acts. Agents that are unsure which tool path to take can call `tool_guide` with `workflow: "post_action_follow_up"` to get this path directly.

### CLI

```bash
crmy context ingest --file discovery-call.txt --auto
crmy context sources --status needs_review
crmy context reprocess-source <source-id>
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

Friendly CLI commands cover common operator and demo workflows. For full parity with MCP and REST, use `crmy tools list`, `crmy tools describe <tool_name>`, and `crmy tools call <tool_name>` to inspect and invoke any tool visible to the current actor.

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
POST   /api/v1/context/signal-groups/:id/complete-details
POST   /api/v1/action-context
```

The generated OpenAPI contract lives at `docs/openapi.json` and is served by the API at `/api/v1/openapi.json`. Regenerate it only when REST paths, shared schemas, or OpenAPI source definitions change:

```bash
npm run generate:openapi --workspace=packages/server
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
  "briefing": {
    "subject": { "...": "..." },
    "subject_type": "account",
    "related_objects": { "contacts": [ ... ], "opportunities": [ ... ] },
    "activities": [ ... ],
    "open_assignments": [ ... ],
    "context_entries": {
      "objection": [ ... ],
      "next_step": [ ... ]
    },
    "signals": {
      "risk": [ ... ]
    },
    "signal_groups": [ ... ],
    "staleness_warnings": [
      { "id": "...", "context_type": "research", "valid_until": "2026-01-01", "body": "..." }
    ]
  }
}
```

Optional fields include `signals`, `signal_groups`, `active_sequences`, `contradiction_warnings`, `adjacent_context`, `token_estimate`, `truncated`, and `dropped_entries`.

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

Pass `token_budget` (integer, minimum 100) or `token_budget_profile` to get a priority-ranked, budget-constrained context pack that fits within a caller-specified token estimate. This applies across direct and adjacent/account-wide Memory entries, then returns selected entries under `context_entries` or `adjacent_context` based on their subject. This is the primary mechanism for loading the right context into an LLM without overflow.

Profiles keep common agent calls simple:

| Profile | Use when | Approx budget |
|---|---|---:|
| `tiny` | routing, classification, lightweight agent task checks | 900 |
| `standard` | ordinary briefing and customer outreach prep | 2200 |
| `deep` | account/deal reviews that need broader context | 6000 |
| `evidence_heavy` | Memory promotion, external writeback, or high-risk changes | 4000 |

```
briefing_get {
  subject_type: "account",
  subject_id: "...",
  context_radius: "account_wide",
  token_budget_profile: "standard",
  evidence_mode: "summary"
}
```

How it works:

1. Each context entry is scored from confidence, type priority, evidence support, and freshness decay. When called through Action Context, proposed action type adds ranking boosts.
2. Entries are sorted by score descending (most important, freshest first)
3. Entries are greedily packed until the budget is exhausted; the last entry that partially fits has its body truncated
4. The response includes `token_estimate` (actual tokens used), `truncated: true` if any body was cut, and `context_packing` with effective profile, budget, evidence mode, and ranking strategy

When no `token_budget` or `token_budget_profile` is given, `briefing_get` returns all matching entries without budget packing. `action_context_get` may infer a profile from `proposed_action` when that helps keep the action packet small. Calls without an effective budget omit `token_estimate`, `truncated`, and `dropped_entries`, but still include `context_packing` so callers know which evidence mode and ranking strategy were used.

`evidence_mode` controls how much proof travels in the first packet:

- `summary` returns compact evidence references and short snippets. This is the default.
- `full` returns complete evidence payloads when the agent must inspect proof in detail.
- `none` omits evidence arrays for cheapest context scanning. Use Lineage or `context_get` later when proof is needed.

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

Use `customer_record_resolve` when an agent needs to resolve a customer record before briefing or action. It uses the same account-first resolver as Source extraction and returns account scope, ambiguity receipts, and proposed child records.

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
| `calendar_connection_start` | `activities:write` |
| `availability_suggest_times` | `activities:read`, `context:read` |
| `activity_create`, `activity_update`, `activity_complete` | `activities:write` |
| `activity_add_context`, `calendar_event_process`, `calendar_event_add_context` | `activities:write`, `context:write` |
| `assignment_get`, `assignment_list` | `assignments:read` |
| `assignment_create`, `assignment_update`, `assignment_accept`, `assignment_complete`, `assignment_decline`, `assignment_start`, `assignment_block`, `assignment_cancel` | `assignments:write` |
| `use_case_get`, `use_case_search`, `use_case_list_contacts`, `use_case_get_timeline`, `use_case_summary` | `accounts:read` |
| `use_case_create`, `use_case_update`, `use_case_delete`, `use_case_advance_stage`, `use_case_update_consumption`, `use_case_set_health`, `use_case_unlink_contact` | `accounts:write` |
| `use_case_link_contact` | `accounts:write`, `contacts:read` |
| `context_get`, `context_search`, `context_list`, `context_source_list`, `context_source_get`, `context_signal_group_list`, `context_signal_group_get`, `context_stale`, `context_diff`, `briefing_get`, `action_context_get` | `context:read` |
| `action_context_request_human_unblock` | `context:read`, `agent:write`, `hitl:write`, `assignments:write` |
| `context_add`, `context_signal_promote`, `context_signal_reject`, `context_supersede`, `context_review`, `context_extract`, `context_ingest`, `context_ingest_auto`, `context_bulk_mark_stale`, `context_embed_backfill`, `context_stale_assign`, `context_review_batch`, `context_resolve_contradiction`, `context_consolidate` | `context:write` |
| `context_signal_group_promote`, `context_signal_group_complete_details`, `context_signal_handoff`, `context_signal_group_reject`, `context_source_reprocess` | `context:write` |
| `context_detect_contradictions`, `context_semantic_search`, `context_lineage_get`, `customer_record_resolve` | `context:read` |
| `context_contradiction_assign` | `context:read`, `assignments:write` |
| `email_get`, `email_search`, `email_message_search`, `email_message_get`, `mailbox_connection_list`, `email_draft_preview` | `activities:read` plus `context:read` for draft preview |
| `mailbox_connection_start` | `activities:write` |
| `email_create`, `email_draft_save`, `email_message_ignore` | `activities:write` |
| `email_ingest`, `email_message_process`, `email_message_link` | `activities:write`, `context:write` |
| `hitl_check_status`, `hitl_list_pending` | `hitl:read` |
| `hitl_submit_request`, `hitl_resolve` | `hitl:write` |
| `hitl_rule_create`, `hitl_rule_list`, `hitl_rule_delete` | `hitl:admin` plus owner/admin role |
| `actor_get`, `actor_list`, `actor_expertise`, `agent_find_specialist`, `crm_search`, `tenant_get_stats` | `read` |
| `actor_register`, `actor_update`, `agent_register_specialization`, `agent_set_availability` | `write` |
| `ops_status_get`, `ops_data_quality_get`, `ops_audit_get`, `ops_privacy_export` | `read` plus admin/owner visibility |
| `ops_job_recover`, `ops_data_quality_repair`, `ops_pii_redact`, `ops_privacy_delete`, `ops_retention_apply` | `write` plus admin/owner visibility |
| `webhook_*` | `webhooks:read` or `webhooks:write` |
| `workflow_*` | `workflows:read` or `workflows:write` |
| `custom_field_*` | `read` or `write` (general) |
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
| `use_case_delete` | Archive while preserving evidence and lineage anchors |
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

## Experimental Automation

Event-driven automation is available as an experimental admin surface. Workflows trigger on CRMy events and execute governed actions, but they are not part of the default product path.

This is an admin capability, now reached from **Settings → Automation Experiments** or the compatible `/app/automations` route. It should not be part of the first-run user path or a production-critical action path until a team validates the rules in its own workspace. Most users should start from Overview, Context, Handoffs, customer records, and Workspace Agent before testing action rules or sequences.

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

CRMy signs outbound webhook deliveries with the `X-CRMy-Signature` header using HMAC-SHA256 over the raw JSON body. A signing secret is generated automatically when the endpoint is created. Copy it after creation, reveal it intentionally when configuring the receiving service, or rotate it from Settings when it may have been exposed. Rotation invalidates the previous secret immediately. This outbound webhook secret is separate from the inbound email webhook secret in **Settings -> Context Connectors -> Inbound Webhook**.

### MCP tools

| Tool | Description |
|---|---|
| `webhook_create` | Register an endpoint. Required: `url`, `events` (array of event types). Returns the generated signing secret once |
| `webhook_get` | Get endpoint details with masked signing-secret state |
| `webhook_reveal_secret` | Reveal the full signing secret for receiver setup or repair |
| `webhook_rotate_secret` | Regenerate the signing secret. The previous secret stops working immediately |
| `webhook_update` | Update `url`, `events`, `active`, `description` |
| `webhook_delete` | Remove endpoint |
| `webhook_list` | List endpoints. Filter by `active` |
| `webhook_list_deliveries` | List delivery attempts. Filter by `endpoint_id`, `status` |

### CLI

```bash
crmy webhooks create
crmy webhooks list --active
crmy webhooks secret <id>
crmy webhooks rotate-secret <id>
crmy webhooks deliveries --endpoint <id> --status failed
crmy webhooks delete <id>
```

### REST API

```
GET    /api/v1/webhooks
POST   /api/v1/webhooks            { url, events: ["contact.created", ...] }
GET    /api/v1/webhooks/:id
POST   /api/v1/webhooks/:id/secret/reveal
POST   /api/v1/webhooks/:id/secret/rotate
PATCH  /api/v1/webhooks/:id        { active: false }
DELETE /api/v1/webhooks/:id
GET    /api/v1/webhooks/:id/deliveries
```

---

## Customer Email

Customer Email has two explicit surfaces:

- **Mailbox Context** reads connected customer mailboxes, links useful threads to customer records, saves them as Sources, and extracts Signals and Memory.
- **Outbound Actions** drafts, approves, provider-drafts, and sends customer email through a visible sender identity.

Connect a mailbox when you want customer threads auto-matched to customer records and processed into Signals and Memory. Emails can also feed context through **Add Context** or MCP `context_ingest_auto` without connecting a mailbox.

Email association uses deterministic contact email, reply-chain, and account-domain matching first, including account **Additional Domains**, then enriches the link with the same account-first Subject Graph resolver used by Source. This lets CRMy match an opportunity or use case mentioned in an email under the right account while leaving ambiguous references in review.

### How it works

1. **Connect a mailbox** — users connect Gmail or Microsoft 365 from `/app/emails` so customer-facing messages can sync into CRMy.
2. **Filter before storage** — admin source filters skip internal-only, automated, spam/trash, newsletter, and excluded-domain messages before extraction by default.
3. **Match customer records** — CRMy links messages using known contact email, account primary/additional domains, reply/thread hints, and Subject Graph account-scoped opportunity/use-case matching.
4. **Process useful messages** — linked customer messages can become Source, producing Signals, Memory, or review items.
5. **Draft safely** — users can generate or edit customer replies from Memory, Signals, recent email context, and linked records. Agent-generated drafts land in **Outbound Actions** first.
6. **Send with a known identity** — CRMy uses the actor's send-enabled default mailbox when available, then the actor's only send-enabled mailbox, then the tenant fallback/shared provider. If no sender exists, users can save a draft but cannot approve or send.
7. **Record sent email as account context** — once provider delivery succeeds, CRMy records the sent email as Account Activity and Source with `source_authorship: crmy` and `customer_authored: false`. Agents can see what your team promised or asked without mistaking your words for the customer's words. In Source and Lineage this appears as seller-authored context; customer replies appear as customer-authored evidence when synced back.
8. **Process replies back into context** — replies synced through the actor mailbox match by provider thread/conversation first, then message headers, then customer-record fallback. Customer replies are processed as customer-authored context when they arrive through Mailbox Context or an inbound webhook.

### Mailbox and source filters

Mailbox OAuth setup is UI-first because it involves user redirects and provider consent. Admins control source filters in Settings so CRMy does not waste processing on internal mail or spam-like sources.

Current mailbox connectors:

| Provider | Status | Notes |
|---|---|---|
| Gmail / Google Workspace | Built-in | User mailbox OAuth and sync jobs |
| Microsoft 365 / Outlook | Built-in | User mailbox OAuth and sync jobs |
| Inbound webhook providers | Advanced | Requires explicit tenant ID and `x-webhook-signature` HMAC using the tenant inbound secret |

### Mailbox senders and fallback provider

Mailbox setup has two independent choices:

- **Use this mailbox for customer context** enables customer thread sync and processing.
- **Use this mailbox to send approved drafts** enables the mailbox as the actor sender identity. Gmail and Outlook provider-draft creation is available when the mailbox is authorized with draft/write scopes.

Existing mailbox connections remain context-only until reauthorized with send/draft scopes. **Settings -> Context Connectors -> Shared Sender** configures the tenant fallback/shared email provider. It is used when a customer draft has no actor mailbox sender, and it also sends sequence or system-generated emails such as invites and password resets. Current customer-draft routing does not expose a per-draft override to force the shared provider when a ready actor mailbox sender is available.

#### Configure Gmail or Outlook mailbox OAuth

There are two setup paths:

- **Admin path:** open **Settings -> Context Connectors -> OAuth**, choose **Google Workspace** or **Microsoft 365**, and verify the selected provider's first-connection preflight. Hosted SaaS tenants use the CRMy-managed provider app by default. Enterprise tenants can save a tenant-owned OAuth app override when they need their own consent screen, security review, verified publisher, or domain app restrictions. Self-hosted installs use environment-managed OAuth app credentials. The page shows the active app source, copyable redirect URIs, setup blockers, guided setup steps, missing setup details, and requested scopes. Do not ask the first actor to connect until mailbox and calendar show ready in the preflight panel. It never shows OAuth secrets or tokens after save. Admins monitor which actors have connected mailbox, sender, and calendar access from **Settings -> Actors**.
- **User path:** open **Customer Email -> Mailboxes & Senders** to connect a mailbox, or **Customer Activity -> Meeting Sources** to connect a calendar. Users working from Claude, Codex, or the CLI can also call `mailbox_connection_start` / `calendar_connection_start` or run `crmy emails connect <provider>` / `crmy activities connect-calendar <provider>`. If OAuth is ready, CRMy returns a provider `auth_url`; the user opens that URL in a browser, finishes provider consent, then returns to MCP/CLI and lists connections to confirm `status=connected`. If OAuth is missing, users can request admin setup and admins can jump directly to the OAuth readiness page.

OAuth app source precedence is tenant-owned app, then CRMy-managed hosted app, then self-hosted environment app. Tenant-owned secrets are encrypted and stored as write-only credentials; list and readiness responses only show whether a secret exists. Each mailbox/calendar connection records the OAuth client that issued its tokens so refresh uses the same app later; if an admin removes or changes that app, affected users should reauthorize their mailbox or calendar. Self-hosted/local users can ignore tenant-owned app settings and use `.env` credentials.

Mailbox setup:

1. Choose the app source:
   - Hosted SaaS default: use the CRMy-managed Google/Microsoft app shown as ready in Context Connectors.
   - Enterprise override: save a tenant-owned app in **Context Connectors -> OAuth** and add the CRMy redirect URL in that provider app.
   - Self-hosted/local: create a provider OAuth app and add the CRMy redirect URL.
     Google uses `https://your-crmy-host/api/v1/mailbox/oauth/google/callback`; Microsoft uses `https://your-crmy-host/api/v1/mailbox/oauth/microsoft/callback`; local development uses `http://localhost:3000` with the same paths.
2. For self-hosted installs, set the app credentials in `.env`:
   - Google: `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET`, optional `GOOGLE_MAIL_REDIRECT_URI`
   - Microsoft: `MICROSOFT_MAIL_CLIENT_ID`, `MICROSOFT_MAIL_CLIENT_SECRET`, optional `MICROSOFT_MAIL_REDIRECT_URI`, optional `MICROSOFT_TENANT_ID`
3. Restart CRMy if you changed deployment environment variables. Tenant-owned app settings take effect immediately after save.
4. Open `/app/emails`, choose **Mailboxes & Senders**, and connect Gmail or Outlook.
5. Choose the mailbox permissions:
   - **Use this mailbox for customer context** requests read access and enables Mailbox Context sync.
   - **Use this mailbox to send approved drafts** requests send access and makes this mailbox eligible as the actor sender.
   - **Create Gmail/Outlook provider drafts when supported** requests draft/write access so CRMy can push reviewed drafts to the provider draft folder.
6. Choose the ingest scope:
   - **Only my accounts** stores and processes synced messages only when CRMy can match them to accounts owned by the connected actor.
   - **All accounts I can access** stores and processes synced messages when CRMy can match them to any account visible to that actor. For managers, this follows CRMy's visible-team/book access model.
7. If CRMy can discover verified send-as aliases, choose the visible **Send as** identity on the same Mailboxes & Senders card. Alias discovery is best-effort so the first connection can still succeed; Gmail and Outlook use the authenticated mailbox address when alias discovery is unavailable.

CRMy validates the scopes returned by the provider callback. If the provider does not grant send or draft/write permission, the mailbox remains connected for context but is not marked send-ready. Reauthorize the mailbox with the relevant toggle enabled after updating provider consent.

Calendar setup uses the same admin/user split and the same app-source precedence. Hosted tenants can use the CRMy-managed app immediately when enabled, enterprise tenants can use the same tenant-owned Google/Microsoft override, and self-hosted installs configure `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` or `MICROSOFT_CALENDAR_CLIENT_ID` / `MICROSOFT_CALENDAR_CLIENT_SECRET`. The calendar redirect paths are `/api/v1/calendar/oauth/google/callback` and `/api/v1/calendar/oauth/microsoft/callback`. Users then connect their own calendar from **Customer Activity -> Meeting Sources**. Calendar OAuth is read-only, verifies the provider account email before saving, and feeds customer meeting context; calendar writeback is not enabled.

Calendar ingest scope controls what synced meetings become CRMy records:

- **Meetings with my accounts** stores and processes meetings only when attendees match accounts owned by the connected actor.
- **Accounts I can access** stores and processes meetings when attendees match any account visible to that actor.
- **All external meetings** stores external meetings that pass source filters even before CRMy can match a customer record, leaving unmatched items reviewable in Customer Activity.

Mailbox and calendar matching use account primary domain plus **Additional Domains**. Add domains such as acquired brands, regional domains, or product-specific domains on the Account record so customer email and meeting attendees match the right account without overloading account aliases.

Troubleshooting:

- **OAuth app not ready:** hosted admins should verify the CRMy-managed app is enabled, enterprise admins should verify the tenant-owned client ID/secret are saved, and self-hosted admins should check the missing env var names in **Context Connectors -> OAuth**. CRMy records a setup request with the server-provided setup blockers instead of sending users to a broken provider redirect.
- **Redirect URI mismatch:** Google and Microsoft require an exact string match. For local development, use the `http://localhost:3000/.../callback` URI shown in **Context Connectors -> OAuth** even if your browser is on `127.0.0.1`; CRMy normalizes loopback redirects to `localhost`. When CRMy is behind a tunnel, reverse proxy, or hosted domain, set `CRMY_PUBLIC_URL=https://your-crmy-host`, copy the exact redirect URI shown in **Context Connectors -> OAuth** into the provider app, then retry consent.
- **Connected context-only but now needs send/drafts:** reauthorize the mailbox from **Mailboxes & Senders** with the send or provider-draft toggle enabled.
- **Who has connected mail/calendar:** admins can review mailbox, sender, and calendar coverage badges and expanded details in **Settings -> Actors**, including connected email, connection date, last sync, latest message/event, processed volume, Sources, Signals, Memory, and latest issue.

Before enabling live provider support for a production tenant, run the [provider certification checklist](provider-certification-0.9.4.md). Automated tests verify CRMy behavior; the certification checklist verifies real Google/Microsoft consent, sync, draft, send, reply, calendar, free/busy, and failure behavior for each OAuth app source.

Requested scopes:

| Provider | Context | Send | Provider drafts |
|---|---|---|---|
| Google Workspace / Gmail | `openid email profile`, `gmail.readonly` | `gmail.send` | `gmail.compose` |
| Microsoft 365 / Outlook | `openid email profile offline_access`, `User.Read`, `Mail.Read` | `Mail.Send` | `Mail.ReadWrite` |

Sender resolution order for drafts and sends:

1. Actor's send-enabled default mailbox.
2. Actor's only send-enabled mailbox.
3. Tenant fallback/shared provider configured in **Settings -> Context Connectors -> Shared Sender**.
4. No sender: CRMy draft only; approval and send are disabled.

Sent outbound email becomes part of the customer timeline after delivery. CRMy marks that source as CRMy/seller-authored context, so briefings can use it for commitments, asks, follow-up actions, and reply-chain history without treating it as customer-authored truth.

Replies sync back only through connected mailboxes or inbound webhooks. For mailbox replies, CRMy matches provider thread/conversation first, then message headers, then customer-record fallback.

Operational recovery lives in **Reliability** (`/app/operations`). If delivery is uncertain, provider draft creation fails, or mailbox sync needs operator attention, the email drawer and Reliability queue show retry/reconcile actions with user-facing status instead of hiding the failure.

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
| `mailbox_connection_list` | List mailbox connections, context/sender capabilities, and processing summary visible to the current user |
| `mailbox_connection_start` | Start Gmail or Outlook OAuth from MCP/CLI and return a browser `auth_url` for the current human-linked actor |
| `email_message_search` | Search customer email messages from mailbox sync, inbound webhooks, manual ingest, and outbound sends |
| `email_message_get` | Get one canonical email message |
| `email_message_link` | Link or relink a message to a customer record before processing |
| `email_message_process` | Process a linked customer message as a Source |
| `email_message_ignore` | Ignore a message so it no longer needs review |
| `email_draft_preview` | Generate a customer email draft preview from Memory, Signals, source email, linked records, and selected sender identity |
| `email_draft_save` | Save an edited/generated draft, request approval, push a provider draft when supported, or explicitly send when allowed |
| `email_create` | Legacy governed outbound email creation. Required: `to_address`, `subject`. Optional: `body_html`, `body_text`, `contact_id`, `account_id`, `opportunity_id`, `use_case_id`, `require_approval` |
| `email_get` | Get email by ID |
| `email_search` | Search by `contact_id`, `status` |
| `email_provider_set` | Configure the tenant fallback/shared email provider (SMTP, etc.) |
| `email_provider_get` | Get fallback/shared email provider config (passwords redacted) |

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

### Mailbox and calendar controls

Admins can see actor connection coverage in **Settings → Actors**. The first view is intentionally binary: email connected, calendar connected, and sender active/paused. Expanding an actor shows provider details, last sync, latest issue, and actions.

- **Deactivate** pauses CRMy use of that mailbox or calendar while preserving the OAuth connection. A paused mailbox is not read and is not used as a sender. A paused calendar is not read and is not used for availability.
- **Activate** restores the prior capabilities when OAuth tokens are still available. If credentials were removed or scopes are missing, CRMy asks the user to reconnect through OAuth.
- **Disconnect** deletes the connection and stored OAuth tokens. Reconnecting requires provider consent again.

Individual users can manage their own mailbox from **Customer Email → Mailboxes & Senders** and their own calendar from **Customer Activity → Meeting Sources**.

Connection cards show each source's ingest scope and sync stats, including items skipped because they were outside the selected account scope. These skips are expected when a mailbox or calendar sees customer-like conversations that do not belong to the connected actor's selected book.

### CLI

```bash
crmy emails create           # interactive
crmy emails list --status pending_approval
crmy emails get <id>
crmy emails connections
crmy emails connect google --scope owned_accounts
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
GET    /api/v1/emails/sender
GET    /api/v1/emails/:id
GET    /api/v1/mailbox/connections
POST   /api/v1/mailbox/connections/:provider/start
PATCH  /api/v1/mailbox/connections/:id/status
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

## Experimental Sequences

Sequences are an experimental governed-orchestration surface for teams testing outbound engagement patterns. They are not positioned as a replacement for a sales-engagement platform, and they are not part of the default Core Profile.

### How it works

1. **Create a sequence** - define steps with `delay_days`, `subject`, and email body
2. **Enroll contacts** - use `sequence_enroll` to start a contact on the sequence
3. **Automatic sending** - the background worker sends each step's email when the delay elapses, then advances to the next step
4. **Completion** - once all steps are sent, the enrollment is marked `completed`

### MCP tools

| Tool | Description |
|---|---|
| `sequence_create` | Create a multi-channel sequence with steps |
| `sequence_get` | Get sequence by ID |
| `sequence_update` | Update name, description, steps, settings, or active status |
| `sequence_delete` | Delete a sequence and cancel active enrollments |
| `sequence_list` | List sequences with optional active and tag filters |
| `sequence_enroll` | Enroll a contact in a sequence |
| `sequence_unenroll` | Cancel an active enrollment |
| `sequence_pause` | Pause an active enrollment |
| `sequence_resume` | Resume a paused enrollment |
| `sequence_enrollment_list` | List enrollments by sequence, contact, or status |
| `sequence_analytics` | Summarize sequence performance |

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
GET    /api/v1/sequences
POST   /api/v1/sequences
GET    /api/v1/sequences/:id
PATCH  /api/v1/sequences/:id
DELETE /api/v1/sequences/:id
POST   /api/v1/sequences/:id/enroll
GET    /api/v1/sequences/enrollments
POST   /api/v1/sequences/enrollments/:id/unenroll
POST   /api/v1/sequences/enrollments/:id/pause
POST   /api/v1/sequences/enrollments/:id/resume
GET    /api/v1/sequences/:id/analytics
POST   /api/v1/sequences/draft-preview
```

Older `/api/v1/email-sequences/*` routes remain available for compatibility, but experimental integrations should use `/api/v1/sequences/*` and the canonical `sequence_*` MCP tools.

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
GET    /api/v1/messaging-channels
POST   /api/v1/messaging-channels
GET    /api/v1/messaging-channels/:id
PATCH  /api/v1/messaging-channels/:id
DELETE /api/v1/messaging-channels/:id
```

Use MCP tools or workflow actions for `message_send`, `message_delivery_get`, and `message_delivery_search`; dedicated REST routes for send and delivery search are not exposed yet.

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

CRMy is the policy boundary between agent inference and operational change. Agents can infer Signals, draft recommendations, search, summarize, ingest Source, and prepare work freely. Actions that affect customers, forecast, assignments, Current Memory, or systems of record pass through scopes, Action Policies, review when required, and audit receipts.

Action Context is the tool agents should use before preparing meaningful customer action. It is not a blanket approval requirement. It gives the agent one compact packet with Memory, Signals, stale or conflicting context, source authority, allowed actions, warnings, expected proof, and review requirements when risk demands them.

The portable preflight contract is versioned as `contract_version: "crmy.action_context.v1"` and is the same packet across MCP `action_context_get`, REST `POST /api/v1/action-context`, CLI `crmy action-context --json`, and Workspace Agent internal calls. The stable v1 fields are `operating_mode`, `readiness`, `policy`, `source_posture`, `allowed_actions`, `human_unblock`, `proof`, `next_tools`, and `context_packing`. The richer `briefing`, `checks`, and `action_packet` fields remain available for detailed UI and debugging flows.

Every response includes `action_packet`, an agent-facing decision packet:

- `use_as_truth`: confirmed Current Memory the agent can rely on.
- `use_with_caution`: unconfirmed Signals, ready Signal groups, or source-authority details that may guide work but should be caveated.
- `do_not_use_as_truth`: stale Memory, unresolved Signal groups, contradictions, blocking assignments, policy blocks, or permission boundaries.
- `evidence_to_cite`: the best evidence-backed items to quote or cite when explaining the recommendation.
- `source_posture`: whether the packet is mainly backed by customer-authored evidence, CRMy/seller-authored context, systems of record, internal notes/meetings, mixed sources, or weak/unknown evidence. Seller-authored context can guide follow-up but should not be treated as customer-authored evidence.
- `recommended_actions`: the next operational steps an agent can take now, including whether the step affects a customer/system, whether review is required, and which tool to call next.
- `action_boundaries`: allowed actions, warnings, blocked conditions, and review-required reasons.
- `human_unblock`: the smallest human question CRMy can identify when review is required.
- `next_tools`: recommended CRMy tools for the next step.

Use the result in three practical modes:

| Mode | Agent behavior | Typical use |
|---|---|---|
| `inform` | Proceed with better context. | Briefing, search, summarization, internal notes, draft preparation, Add Context, reviewable Signal creation. |
| `warn` | Proceed, but call out stale, inferred, conflicting, or low-confidence context. | Drafting outreach from unconfirmed Signals, recommending a next step with stale Memory, preparing a record update preview. |
| `require_review` | Stop before execution and route to Handoff or policy review. | Automatic customer send, sequence send, workflow-triggered outreach, forecast/stage/amount/owner changes, external writeback, external commitments, out-of-scope records, or using unconfirmed Signals as fact. |

Warnings do not automatically become Handoffs. `required_handoffs` should mean the action cannot execute without review; non-blocking issues stay visible in `guidance.warning_reasons` and `checks`.

When the packet says review is required, agents can create the human decision directly with `action_context_request_human_unblock`. It records a handoff snapshot first, then creates either a HITL approval request or an assignment with the Action Context packet, proof, and agent reasoning attached. This is the preferred bridge from “CRMy says stop” to “a human has the exact thing to review.”

CLI users can retrieve the same packet without dropping to the generic tool bridge:

```bash
crmy action-context "account:Northstar Labs" --action customer_outreach
crmy action-context "opportunity:Agent Context Rollout" --action external_writeback --object-type opportunity --fields stage,amount --json
crmy action-context unblock "account:Northstar Labs" --action customer_outreach --type approval --priority high
```

Built-in Action Policies protect high-risk actions before custom rules run:

- Forecast category changes require approval for non-user actors.
- Signal promotion requires evidence and may require approval when confidence is low.
- External writebacks evaluate object write scope, source authority, allowed fields, writeback mode, idempotency, and target system policy.
- Workflow field updates create approval requests instead of directly mutating sensitive fields.
- Workflow-triggered outreach and sequence sends can carry Action Context proof and route to Handoff when readiness, policy, or risk requires review.

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
| `action_context_request_human_unblock` | Create a HITL approval or assignment from Action Context review guidance, preserving the action packet and handoff snapshot |
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

Systems of Record connect CRMy to the enterprise sources that already hold customer state. The connector framework supports HubSpot, Salesforce, Databricks, and Snowflake through one governed model.

CRMy is the audited decision layer on top of those systems, not a parallel source of field truth. When mapped SoR fields conflict, CRMy flags the conflict and defers to review instead of overwriting the system of record; agents can still inspect the same Action Context contract connector-free or through a mocked/live connector path.

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
- `crmy init` generates a local stored-secret encryption key automatically. The local source dev server also generates and appends one to `.env` when `JWT_SECRET` exists but no encryption key is configured. Set `CRMY_ENCRYPTION_KEY` explicitly in production before storing connector, mailbox/calendar OAuth, or model-provider secrets.
- REST, MCP, and CLI responses redact credential fields.
- External writes require configured mappings and writeback modes. Arbitrary agent-generated SQL writes are not allowed.
- Sync respects mapping source authority. External-authoritative mappings can update CRMy directly; CRMy-authoritative, read-only, and approval-required mappings create conflicts instead of overwriting existing records. Bidirectional mappings update only when CRMy has not diverged from the last synced value.
- Databricks and Snowflake writeback previews block requests unless the mapping has an admin-defined `writeback_config.sql_template` and the payload only uses configured writable fields. Add `writeback_config.parameter_order` when SQL parameters must bind in a specific order.
- `context_entry` mappings are reserved. They create reviewable sync conflicts until connector/system author actors are available, rather than silently writing memory.

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

As of 0.9.5, CRMy has first-class local eval profiles for contract corpora, live-model extraction quality, seeded retrieval quality, Action Context decisions, source attribution, deterministic connector parity, tool choice, and agent trajectory smoke coverage. Governed Knowledge retrieval is also available for safe company, product, pricing, security, implementation, roadmap, and competitive Trusted Facts: admins can review source-backed facts, agents can retrieve approved citations, and briefings/Action Context/email drafts can include them without mixing them into customer Memory. Live multi-provider connector certification and source-adapter automation for Trusted Facts remain roadmap. See the [CRMy 0.9.3 Eval Harness Plan](eval-harness-0.9.3-plan.md) and [Governed Knowledge Retrieval Plan](governed-product-knowledge-retrieval.md).

Read the full roadmap: [CRMy 0.8-1.0 Roadmap: Enterprise Systems-Of-Record Overlay](roadmap-0.8-1.0.md). For hosted multi-instance production requirements, see the [CRMy 1.0 Multi-Instance Runtime Plan](multi-instance-runtime-plan.md).

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

For more control, add CRMy to `~/.codex/config.toml` or a project-scoped `.codex/config.toml`:

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
Use the CRMy MCP tools to resolve the customer record "Northstar Labs", get a briefing, get Action Context for customer outreach, list Signals that need attention, check lineage outcomes, and tell me the safest next action with the evidence you used.
```

Hermes Agent prompt:

```text
Use mcp_crmy_customer_record_resolve to resolve "Northstar Labs", call mcp_crmy_briefing_get, call mcp_crmy_action_context_get for customer outreach, call mcp_crmy_context_signal_group_list for Signals needing attention, then call mcp_crmy_context_lineage_get to check outcomes. Tell me the safest next action with the evidence you used.
```

**HTTP (remote agents):**

```
POST /mcp
Authorization: Bearer <jwt-or-api-key>
Content-Type: application/json
```

Uses the MCP Streamable HTTP transport. Initialization creates an `mcp-session-id`; later GET, POST, and DELETE requests can reuse that session as long as they authenticate as the same actor and scope set. Idle sessions are evicted automatically. In multi-instance deployments, CRMy records session ownership durably and requires sticky routing by `mcp-session-id`; wrong-instance requests return a clear reinitialize/sticky-routing error instead of creating an unsafe replacement session.

### Full tool list

| Category | Tools |
|---|---|
| Briefing | `briefing_get`, `action_context_get`, `action_context_request_human_unblock` |
| Context | `context_ingest_auto`, `context_ingest`, `context_source_list`, `context_source_get`, `context_source_reprocess`, `context_add`, `context_get`, `context_find`, `context_list`, `context_lineage_get`, `context_signal_group_list`, `context_signal_group_get`, `context_signal_group_complete_details`, `context_signal_group_promote`, `context_signal_handoff`, `context_signal_group_reject`, `context_signal_promote`, `context_signal_reject`, `context_supersede`, `context_search`, `context_semantic_search`, `context_review`, `context_review_batch`, `context_bulk_mark_stale`, `context_stale`, `context_diff`, `context_extract`, `context_stale_assign`, `context_detect_contradictions`, `context_contradiction_assign`, `context_resolve_contradiction`, `context_consolidate`, `context_embed_backfill` |
| Agent Handoffs | `agent_capture_handoff`, `agent_resume_handoff` |
| Actors | `actor_register`, `actor_get`, `actor_list`, `actor_update`, `actor_whoami`, `actor_expertise`, `agent_register_specialization`, `agent_find_specialist`, `agent_set_availability` |
| Assignments | `assignment_create`, `assignment_get`, `assignment_list`, `assignment_update`, `assignment_accept`, `assignment_complete`, `assignment_decline`, `assignment_start`, `assignment_block`, `assignment_cancel` |
| HITL | `hitl_submit_request`, `hitl_check_status`, `hitl_list_pending`, `hitl_resolve` |
| Activities and Calendar | `activity_create`, `activity_get`, `activity_search`, `activity_add_context`, `activity_complete`, `activity_update`, `activity_get_timeline`, `availability_suggest_times`, `calendar_connection_list`, `calendar_connection_start`, `calendar_event_search`, `calendar_event_get`, `calendar_event_process`, `calendar_event_add_context`, `meeting_classification_list` |
| Contacts | `contact_create`, `contact_get`, `contact_search`, `contact_update`, `contact_set_lifecycle`, `contact_get_timeline`, `contact_get_opportunities`, `contact_score`, `contact_merge`, `contact_delete` |
| Accounts | `account_create`, `account_get`, `account_search`, `account_update`, `account_set_health_score`, `account_get_hierarchy`, `account_merge`, `account_split_domains`, `account_health_report`, `account_delete` |
| Opportunities | `opportunity_create`, `opportunity_get`, `opportunity_search`, `opportunity_advance_stage`, `opportunity_update`, `opportunity_health_score`, `opportunity_delete` |
| Messaging | `message_channel_create`, `message_channel_update`, `message_channel_get`, `message_channel_delete`, `message_channel_list`, `message_send`, `message_delivery_get`, `message_delivery_search` |
| Use Cases | `use_case_create`, `use_case_get`, `use_case_search`, `use_case_update`, `use_case_delete`, `use_case_advance_stage`, `use_case_update_consumption`, `use_case_set_health`, `use_case_link_contact`, `use_case_unlink_contact`, `use_case_list_contacts`, `use_case_get_timeline`, `use_case_summary` |
| Registries | `activity_type_list`, `activity_type_add`, `activity_type_remove`, `context_type_list`, `context_type_add`, `context_type_remove` |
| Workflows | `workflow_create`, `workflow_get`, `workflow_update`, `workflow_delete`, `workflow_list`, `workflow_run_list`, `workflow_test`, `workflow_clone`, `workflow_trigger`, `workflow_run_replay`, `workflow_template_list` |
| Webhooks | `webhook_create`, `webhook_get`, `webhook_reveal_secret`, `webhook_rotate_secret`, `webhook_update`, `webhook_delete`, `webhook_list`, `webhook_list_deliveries` |
| Emails | `email_create`, `email_get`, `email_search`, `mailbox_connection_list`, `mailbox_connection_start`, `email_message_search`, `email_message_get`, `email_message_link`, `email_message_process`, `email_message_ignore`, `email_draft_preview`, `email_draft_save`, `email_ingest`, `email_provider_set`, `email_provider_get` |
| Experimental Sequences | `sequence_create`, `sequence_get`, `sequence_update`, `sequence_delete`, `sequence_list`, `sequence_enroll`, `sequence_unenroll`, `sequence_pause`, `sequence_resume`, `sequence_advance`, `sequence_enrollment_get`, `sequence_enrollment_context`, `sequence_enrollment_list`, `sequence_draft_step`, `sequence_analytics`, `sequence_clone` |
| Custom Fields | `custom_field_create`, `custom_field_update`, `custom_field_delete`, `custom_field_list` |
| Record Resolution | `customer_record_resolve` |
| Compatibility | `entity_resolve` |
| Analytics | `crm_search`, `pipeline_summary`, `pipeline_forecast`, `account_health_report`, `tenant_get_stats` |
| Record Drafts | `record_draft_preview` |
| Operations | `ops_status_get`, `ops_job_recover`, `ops_data_quality_get`, `ops_data_quality_repair`, `ops_audit_get`, `ops_privacy_export`, `ops_pii_redact`, `ops_privacy_delete`, `ops_retention_apply` |
| Meta | `schema_get`, `tool_guide`, `guide_search` |

---

## REST API Reference

Most endpoints require `Authorization: Bearer <jwt-or-api-key>`. Authentication setup endpoints such as login and first-user registration are intentionally unauthenticated.

Base URL for REST resources: `/api/v1`. Auth endpoints are mounted separately at `/auth`.

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register a new user + tenant |
| POST | `/auth/login` | Login, receive JWT |
| GET | `/auth/setup/:token` | Inspect an invite or password-reset setup token |
| POST | `/auth/setup/:token` | Complete invite or password-reset setup |
| GET | `/auth/api-keys` | List API keys |
| POST | `/auth/api-keys` | Create API key |
| PATCH | `/auth/api-keys/:id` | Rotate, deactivate, or update API key metadata |
| DELETE | `/auth/api-keys/:id` | Revoke API key |
| PATCH | `/auth/profile` | Update the authenticated user's profile |
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
| POST | `/context/:id/promote` | Promote a reviewed Signal into Memory |
| POST | `/context/:id/reject` | Reject a Signal while preserving audit |
| POST | `/context/:id/supersede` | Supersede with updated content |
| POST | `/context/:id/review` | Mark as reviewed |
| POST | `/context/review-batch` | Mark multiple entries reviewed |
| POST | `/context/mark-stale` | Mark multiple entries stale |
| POST | `/context/consolidate` | Consolidate duplicate or overlapping Memory |
| GET | `/context/stale` | List stale entries |
| GET | `/context/search` | Full-text search |
| GET | `/context/semantic-search` | pgvector similarity search (`?q=`, `?subject_type=`, `?limit=`) |
| GET | `/context/contradictions` | Detect contradictory Current Memory |
| POST | `/context/contradictions/assign` | Create review assignments for contradictions |
| POST | `/context/contradictions/resolve` | Resolve a contradiction with audit trail |
| GET | `/context/sources` | List Source processing receipts |
| GET | `/context/sources/:id` | Get one Source receipt |
| POST | `/context/sources/:id/reprocess` | Retry or reprocess a Source |
| GET | `/context/signal-groups` | List grouped Signals and readiness state |
| GET | `/context/signal-groups/:id` | Inspect a Signal group with evidence |
| POST | `/context/signal-groups/:id/promote` | Confirm a Signal as Memory |
| POST | `/context/signal-groups/:id/handoff` | Send a Signal to Handoff review |
| POST | `/context/signal-groups/:id/complete-details` | Add missing typed Signal details before promotion |
| POST | `/context/signal-groups/:id/reject` | Dismiss a Signal while preserving audit |
| GET | `/context/lineage` | Trace Sources through Signals, Memory, Handoffs, writebacks, and audit |
| POST | `/context/detect-subjects` | Detect customer records mentioned in text (`{ text }`) |
| POST | `/context/ingest` | Ingest context for a known subject (structured form) |
| POST | `/context/ingest-auto` | Ingest a Source and resolve or pin subjects automatically |
| POST | `/context/ingest-file` | Extract text from a file and detect subjects. Requires context write access. Full extracted text is returned only with `include_text: true`. |

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
| POST | `/workflows/:id/test` | Dry-run a workflow |
| POST | `/workflows/:id/clone` | Clone a workflow |
| POST | `/workflows/:id/trigger` | Trigger a workflow manually |
| POST | `/workflows/test-draft` | Validate a workflow draft without saving it |
| POST | `/workflows/draft-content-preview` | Preview generated workflow content |

### Webhooks

| Method | Path | Description |
|---|---|---|
| GET | `/webhooks` | List endpoints |
| POST | `/webhooks` | Register endpoint |
| GET | `/webhooks/:id` | Get endpoint with masked signing-secret state |
| POST | `/webhooks/:id/secret/reveal` | Reveal the full signing secret for receiver setup |
| POST | `/webhooks/:id/secret/rotate` | Regenerate the signing secret; the previous secret stops working immediately |
| PATCH | `/webhooks/:id` | Update |
| DELETE | `/webhooks/:id` | Remove |
| GET | `/webhooks/:id/deliveries` | Delivery log |

### Emails

Customer Email is the mailbox-facing Source layer. Connect Gmail, Outlook, or an inbound webhook so CRMy can capture customer-facing messages, filter internal-only email by default, associate conversations to accounts/contacts/opportunities/use cases, and process useful messages into Signals and Memory. Inbound webhook posts must include an explicit `tenant_id` query parameter or `x-crmy-tenant-id` header plus a valid `x-webhook-signature` HMAC.

| Method | Path | Description |
|---|---|---|
| GET | `/emails` | List/search governed outbound email drafts and send history |
| POST | `/emails` | Draft a governed follow-up email |
| GET | `/emails/sender` | Resolve the current actor sender identity for outbound drafts and sends |
| GET | `/emails/:id` | Get outbound email |
| POST | `/emails/:id/provider-draft/retry` | Retry provider draft creation for an editable outbound email |
| POST | `/emails/:id/delivery-resolution` | Retry, mark sent, or mark failed for failed or delivery-uncertain outbound email |
| GET | `/mailbox/connections` | List mailbox connections, context/sender capabilities, and customer-email processing summary |
| POST | `/mailbox/connections/:provider/start` | Start a Gmail or Outlook mailbox connection with context/sender permission choices |
| PATCH | `/mailbox/connections/:id/status` | Activate or deactivate a mailbox connection without deleting OAuth credentials |
| POST | `/mailbox/connections/:id/sync` | Queue a mailbox sync job |
| POST | `/mailbox/connections/:id/aliases/refresh` | Refresh verified sender aliases for a Gmail or Outlook mailbox |
| PATCH | `/mailbox/connections/:id/sender` | Choose the verified sender alias used by outbound drafts from that mailbox |
| GET | `/email-messages` | List canonical customer email messages |
| GET | `/email-messages/:id` | Get customer email message, linked records, and processing receipt |
| PATCH | `/email-messages/:id/classification` | Mark a message as customer, mixed, internal, automated, or unknown |
| PATCH | `/email-messages/:id` | Update classification and linked customer records |
| POST | `/email-messages/:id/process` | Process an email as a Source |
| POST | `/email-messages/:id/ignore` | Hide a message from review queues |
| POST | `/emails/draft-preview` | Generate an editable customer email draft preview |
| POST | `/emails/drafts` | Save a CRMy draft, request approval, push a provider draft when supported, or explicit send when allowed |
| POST | `/availability/suggest-times` | Suggest meeting windows from connected internal calendar free/busy and customer timing preferences |
| GET | `/admin/oauth-readiness` | Admin-only Google/Microsoft mailbox and calendar OAuth readiness without secret values |
| GET/PUT/DELETE | `/admin/oauth-apps/:provider` | Admin-only tenant-owned Google/Microsoft OAuth app overrides; secrets are write-only |
| GET | `/admin/actor-connections` | Admin-only actor mailbox sender and calendar connection coverage |

### Messaging Channels

| Method | Path | Description |
|---|---|---|
| GET | `/messaging-channels` | List channels |
| POST | `/messaging-channels` | Create channel |
| GET | `/messaging-channels/:id` | Get channel |
| PATCH | `/messaging-channels/:id` | Update channel |
| DELETE | `/messaging-channels/:id` | Delete channel |

Message send and delivery inspection are exposed through MCP tools (`message_send`, `message_delivery_get`, and `message_delivery_search`) and workflow actions; there are not dedicated REST routes for those operations yet.

### Sequences

| Method | Path | Description |
|---|---|---|
| GET | `/sequences` | List customer engagement sequences |
| POST | `/sequences` | Create a sequence |
| GET | `/sequences/:id` | Get sequence details |
| PATCH | `/sequences/:id` | Update sequence metadata, steps, settings, or active status |
| DELETE | `/sequences/:id` | Delete a sequence |
| POST | `/sequences/:id/enroll` | Enroll a contact in a sequence |
| GET | `/sequences/enrollments` | List enrollments |
| POST | `/sequences/enrollments/:id/unenroll` | Cancel an active enrollment |
| POST | `/sequences/enrollments/:id/pause` | Pause an active enrollment |
| POST | `/sequences/enrollments/:id/resume` | Resume a paused enrollment |
| GET | `/sequences/:id/analytics` | Sequence performance analytics |
| POST | `/sequences/draft-preview` | Generate an unsaved AI draft preview for a sequence step |
| GET | `/sequences/enrollments/:enrollmentId/activities` | List activities created by an enrollment |
| GET | `/sequences/enrollments/:enrollmentId/context` | List context generated by an enrollment |

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

Migrations run automatically during `crmy init` and during local/non-production server startup by default. In production, server startup defaults to `CRMY_MIGRATION_MODE=validate`: web and worker processes fail fast when migrations are pending instead of trying to mutate schema during deploy. Run `crmy migrate run` as a one-shot migration job first, then start the app/worker roles. Set `CRMY_MIGRATION_MODE=auto` only for local or deliberately single-instance self-hosted deployments; use `skip` only when another release gate already verifies schema state.

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
