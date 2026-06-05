# CRMy

**Customer memory for AI sales agents.**

Before an AI sales agent sends a follow-up, prepares a meeting brief, updates an opportunity, reviews a renewal, or writes back to a system of record, it needs trusted customer context.

It needs to know what is true, what is stale, what is inferred, what requires approval, and which system owns the record.

#### CRMy gives agents one trusted customer briefing before they act.

A `briefing_get` call returns typed customer context across accounts, contacts, opportunities, activities, risks, commitments, next steps, evidence, stale warnings, and open handoffs.

MCP-native, with CLI, REST API, and Web UI access. PostgreSQL-backed. Open source.

If you are building agents that need operational customer memory, **star CRMy** and keep reading.

---

CRMy does not replace your systems of record. Your CRM, warehouse, support desk, mailbox, calendar, and other tools remain where work happens and state is stored.

CRMy makes that state agent-operable.

It turns messy customer context into typed operational Memory, gives agents scoped tools, and governs the path from recommendation to human review to system-of-record writeback.

```text
Raw Context -> Signals -> Memory -> Handoffs / Writeback
```

Before an agent acts on a customer, CRMy can tell it what is known, what is stale, what is inferred, what is approved, what action is allowed, what system owns the record, and what proof or audit trail will exist afterward.


## Why CRMy?

Most GTM agents can draft, summarize, and call APIs. They still struggle with the operational questions that matter before action:

- What do we actually know about this account or deal?
- Which claims came from evidence, and which are only inferred?
- What changed since the last call, email, sync, or agent run?
- Which Memory is stale, contradicted, or missing support?
- Is this actor/agent allowed to see or change this record?
- Does this action need approval before it touches our system of record?
- What receipt proves what happened afterward?

CRMy gives agents that operating layer.

## Who This Is For

CRMy is for builders creating sales, CS, RevOps, support, or GTM (AI) agents that need to work with humans and revenue systems safely.

Use it when your agent needs to know account state, inspect evidence, remember durable customer context, respect user scope, request approval, or prepare governed CRM/writeback actions.

## What CRMy Is Not

- Not a CRM replacement. Salesforce, HubSpot, warehouses, and support desks stay the systems of record.
- Not generic chatbot memory. CRMy stores typed, evidence-backed GTM Memory with lifecycle, ownership, freshness, and audit.
- Not a workflow toy. Agents can prepare action, but CRMy keeps policy, Handoffs, writeback receipts, and human review in the path.
- Not a sales methodology lock-in. Registries and Memory types are extensible, so teams can model their own GTM language.

## Three Pillars

### 1. Observe Freely

Ingest customer context from calls, meetings, emails, notes, CRM changes, Slack, support cases, product usage, docs, REST, CLI, and MCP.

Raw Context stays messy. CRMy resolves visible customer records, extracts evidence-backed Signals, and keeps receipts for what was processed, skipped, matched, or failed.

The same account-first resolver powers Raw Context, customer email, calendar/activity capture, and agent record lookup, so opportunities and use cases are matched inside the right account instead of guessed globally.

### 2. Remember Operationally

Store typed GTM Memory for accounts, contacts, opportunities, use cases, stakeholders, risks, objections, commitments, next steps, buying process, success criteria, and forecast signals.

Memory is persistent, scoped, searchable, versioned, auditable, and designed for agent action. Signals remain separate until they are trusted enough to become Memory.

### 3. Act Safely

Brief agents before action, route sensitive decisions through Handoffs, enforce user and team scope, preview writebacks, apply policy, and emit audit receipts.

Agents can prepare work freely. CRMy decides what can be written, what needs approval, and what must stay reviewable.

## Core Concepts

| Concept | What it means |
|---|---|
| **Raw Context** | Source material before extraction: transcripts, emails, notes, calendar meetings, CRM changes, docs, support/product signals, and agent inputs. |
| **Signals** | Inferred claims with evidence, confidence, source lineage, and readiness. Signals can be confirmed, dismissed, or sent to review. |
| **Memory** | Confirmed operational customer context agents can rely on across sessions and workflows. |
| **Active Context** | The temporary working set an agent can see right now: prompt, conversation, bound record, retrieved briefing, tool results, and loaded files. |
| **Handoffs** | Human review for approvals, escalations, uncertain Signals, and governed decisions. |
| **Writeback** | Policy-checked updates to systems of record through preview, approval, idempotency, audit, and execution receipts. |

## Architecture

```mermaid
flowchart LR
  sources["Calls, emails, CRM, calendar, support, product, docs, MCP"]
  raw["Raw Context"]
  signals["Signals\ninferred + evidence-backed"]
  memory["Memory\nconfirmed + typed"]
  active["Active Context\nbriefing_get + search"]
  agent["Agent action"]
  handoff["Handoffs\napproval + review"]
  writeback["System-of-record writeback"]
  audit["Audit + Lineage"]

  sources --> raw --> signals
  signals -->|trusted enough| memory
  signals -->|uncertain or sensitive| handoff
  memory --> active --> agent
  agent -->|needs approval| handoff
  handoff --> writeback
  writeback --> audit
  raw --> audit
  signals --> audit
  memory --> audit
```

## What You Can Build

Use CRMy when you want agents that can:

- brief themselves on an account, contact, opportunity, or use case before acting
- turn meeting transcripts and emails into actionable Signals
- combine evidence across sources before creating Memory
- identify risks, blockers, next steps, stakeholder roles, and buying-process gaps
- draft customer follow-ups from Memory and recent context
- route sensitive decisions to a human with evidence attached
- prepare CRM or warehouse updates without bypassing policy
- operate with member, manager, and admin visibility boundaries
- expose the same capabilities through Web UI, REST, CLI, and MCP

## The Core Context Engine

CRMy's main value is the context engine underneath the app:

```text
Raw Context -> Subject Graph -> Signals -> Memory -> Briefing -> Handoff / Writeback -> Proof
```

That engine keeps customer context useful without pretending messy source material is instantly true. It resolves customer scope, extracts evidence-backed Signals, separates inferred claims from confirmed Memory, retrieves the right context into an agent briefing, and governs action through Handoffs, writeback policy, receipts, audit, and Lineage.

The most important community contributions are real-world tests of this loop: messy transcripts, customer emails, calendar meetings, CRM/warehouse sync, custom systems of record, writeback previews, approval flows, and agent harnesses. See [Context Engine](docs/context-engine.md) and [Contributing](CONTRIBUTING.md) for where testing helps most.

## Quickstart

You need Node.js 20+ and PostgreSQL. For local development, pgvector is recommended but not required.

Start Postgres:

```bash
docker run --name crmy-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=crmy \
  -p 5432:5432 \
  -d pgvector/pgvector:pg16
```

Initialize CRMy:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
export CRMY_ADMIN_EMAIL=admin@example.com
export CRMY_ADMIN_PASSWORD=change-me-please-123

npx -y @crmy/cli init --yes
npx -y @crmy/cli doctor
npx -y @crmy/cli server
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
2. Creates the local database when needed.
3. Runs migrations.
4. Creates the first owner account.
5. Writes local CLI and MCP config.
6. Configures the Workspace Agent automatically when local Ollama is running with an installed model.
7. Seeds demo data so the examples below work immediately.

To configure a provider during non-interactive init, set:

```bash
export CRMY_AGENT_PROVIDER=openai        # also supports azure_openai, google_gemini, aws_bedrock, mistral, litellm, databricks, nvidia_nim
export CRMY_AGENT_MODEL=gpt-5.2
export CRMY_AGENT_API_KEY=sk-...         # not required for Ollama
# export CRMY_AGENT_BASE_URL=https://api.openai.com/v1
```

Supported Workspace Agent providers are centrally maintained and shared by the web UI and CLI: Anthropic, OpenAI, Azure OpenAI, Google Gemini, Amazon Bedrock, Mistral, LiteLLM Proxy, OpenRouter, Ollama, Databricks AI Gateway, NVIDIA NIM, and other OpenAI-compatible endpoints.

Interactive `crmy init` detects Ollama first. If Ollama is unavailable, or you choose not to use it, the wizard prompts for the same centrally maintained provider/model options shown in the web Model Settings page. Backup provider failover is configured later in **Settings → Model**; it is intentionally not part of the first-run CLI path.

Prefer interactive setup?

```bash
npx -y @crmy/cli init
```

Prefer a global install?

```bash
npm install -g @crmy/cli
crmy init
crmy doctor
crmy server
```

## Try the Demo

The seeded demo shows the full source-to-action loop:

```bash
npx -y @crmy/cli briefing "account:Northstar Labs"
npx -y @crmy/cli context raw-sources
npx -y @crmy/cli context signals
npx -y @crmy/cli context lineage --subject "account:Northstar Labs"
npx -y @crmy/cli hitl list
npx -y @crmy/cli agent-smoke
npx -y @crmy/cli agent-smoke --with-model   # proves model-backed Raw Context extraction when configured
```

You should see:

1. Raw Context from customer conversations.
2. Signals about stakeholders, buying process, risk, security, and next steps.
3. Confirmed Memory available in briefings.
4. A Handoff showing how uncertain or sensitive action routes to human review.
5. Lineage showing how source material became Signal, Memory, review, or writeback.

Demo users:

```text
Admin   sample.admin@crmy.local / crmy-demo-123
Manager sample.manager@crmy.local / crmy-demo-123
Rep     sample.rep@crmy.local / crmy-demo-123
Peer    sample.peer@crmy.local / crmy-demo-123
```

The CLI accepts friendly record references, so you usually do not need IDs:

```text
account:Northstar Labs
contact:Maya Patel
opportunity:Agent Context Rollout
use_case:Production Rollout
```

IDs are still used for system artifacts such as Handoffs, raw-source receipts, sync runs, and writeback requests.

## 30-Second Briefing

The fastest way to see the memory layer in action is to ask CRMy what an agent should know before touching a customer:

```bash
npx -y @crmy/cli briefing "account:Northstar Labs"
```

Equivalent MCP tool call:

```json
{
  "tool": "briefing_get",
  "arguments": {
    "subject_type": "account",
    "subject_id": "<resolved-account-id>",
    "context_radius": "account_wide",
    "format": "text",
    "token_budget": 3000
  }
}
```

The briefing returns customer state, Current Memory, unconfirmed Signals, recent activity, open Handoffs, stale warnings, and the context an agent should use before acting.

## Connect Agents Through MCP

CRMy is MCP-native. Add it to an agent harness and give the agent scoped tools for briefings, Raw Context ingestion, Signals, Memory, Handoffs, email drafting, record drafting, workflows, and systems-of-record writeback.

Claude Code:

```bash
claude mcp add crmy -- npx -y @crmy/cli mcp
```

Claude Desktop, Cursor, Windsurf, or any MCP client:

```json
{
  "mcpServers": {
    "crmy": {
      "command": "npx",
      "args": ["-y", "@crmy/cli", "mcp"]
    }
  }
}
```

Codex:

```bash
codex mcp add crmy -- npx -y @crmy/cli mcp
```

Or add CRMy to `~/.codex/config.toml`:

```toml
[mcp_servers.crmy]
command = "npx"
args = ["-y", "@crmy/cli", "mcp"]
```

ChatGPT Developer Mode:

Use CRMy's remote MCP endpoint (`https://<your-crmy-host>/mcp`) as a Developer Mode app. ChatGPT Developer Mode uses remote MCP over SSE or streaming HTTP, so use a reachable HTTPS CRMy server or a secure development tunnel rather than local stdio.

Hermes Agent:

Add CRMy to `~/.hermes/config.yaml` under `mcp_servers`. Hermes prefixes CRMy tools as `mcp_crmy_<tool>`, so `briefing_get` appears as `mcp_crmy_briefing_get`.

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

If Hermes runs outside the shell where `crmy init` wrote config, add `DATABASE_URL` and `CRMY_API_KEY` under `env:` or connect to CRMy over HTTP with `url: "http://localhost:3000/mcp"` and an `Authorization` header. Restart Hermes or run `/reload-mcp` after editing the config.

One-minute agent smoke test:

```bash
npx -y @crmy/cli agent-smoke
```

Or ask the connected agent:

```text
Use the CRMy MCP tools to resolve the customer record "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.
```

For Hermes Agent, ask for the prefixed tools:

```text
Use mcp_crmy_customer_record_resolve to resolve "Northstar Labs", call mcp_crmy_briefing_get, then call mcp_crmy_context_signal_group_list for Signals needing attention. Tell me the safest next action with the evidence you used.
```

Common first tools:

| Goal | MCP tool |
|---|---|
| Decide which tool path to use | `tool_guide` |
| Resolve customer records | `customer_record_resolve` |
| Brief an agent before action | `briefing_get` |
| Ingest messy customer context | `context_ingest_auto` |
| Review evidence-backed Signals | `context_signal_group_list` |
| Confirm a Signal as trusted Memory | `context_signal_group_promote` |
| Route uncertain work to review | `context_signal_handoff` |
| Draft a customer email | `email_draft_preview` |
| Draft a new record from natural language | `record_draft_preview` |

Use scoped API keys for agents whenever possible. Ordinary customer-reasoning agents should see a small workflow-specific tool set, not the full admin/operator catalog.

See [MCP tools](docs/mcp-tools.md) for the full tool catalog and scoped-access model.

## Product Surfaces

| Surface | What it is for |
|---|---|
| **Overview** | Daily operating view: what is set up, what context is flowing, and what needs action. |
| **Workspace Agent** | Scoped GTM workbench for briefings, tool use, drafting, record work, and customer reasoning. |
| **Context** | Raw Context, Signals, Memory, Lineage, and Context Sources. Graph remains available as a supporting record explorer. |
| **Handoffs** | Decision queue for approvals, escalations, delegated work, and governed action review. |
| **Customer Email** | Supporting Context Source for mailboxes, customer-message review, and governed follow-up drafts. |
| **Customer Activity** | Supporting Context Source for meetings, calls, notes, transcripts, and calendar context. |
| **Systems of Record** | Admin setup for CRMs and warehouses, field mappings, sync, conflicts, and governed writeback. |
| **Settings → Automations** | Admin/advanced event rules and sequences that request governed action instead of bypassing policy. |

## Systems of Record

CRM remains the system of record. CRMy makes it safer for agents to work with it.

Supported connector paths include:

- HubSpot
- Salesforce
- Databricks SQL Warehouse
- Snowflake
- Other Postgres-compatible systems through custom mapping

Connections can read external records into typed CRMy objects, preserve external references, detect conflicts, and request governed writebacks. New mappings default to read-only. Writeback must be explicitly enabled field by field and still passes through preview, policy, approval, audit, and execution receipts.

Configure connectors in **Settings -> Systems of Record**.

## Semantic Retrieval

CRMy works without embeddings. Keyword, deterministic, registry, and related-record matching remain available.

Enable pgvector-backed semantic retrieval when you want CRMy to find related Signals and Memory by meaning:

```bash
ENABLE_PGVECTOR=true crmy migrate run
```

Then configure an embedding provider in the server environment:

```env
EMBEDDING_PROVIDER=openai
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
```

For hosted Postgres, enable the extension first:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

In the app, admins can check readiness at **Settings -> Database -> Semantic retrieval setup**.

## CLI Essentials

```bash
crmy init                         # setup wizard
crmy doctor                       # local health check
crmy server                       # start API, Web UI, REST, and MCP HTTP
crmy seed-demo --reset            # reset and seed demo data

crmy briefing "account:Northstar Labs"
crmy context ingest --file call.txt
crmy context signals
crmy context lineage --subject "account:Northstar Labs"
crmy activities meetings
crmy emails messages
crmy hitl list
crmy systems list
crmy workflows list
crmy sequences list
```

The CLI is curated for setup, demos, Raw Context ingestion, activity/email review, systems, workflows, and operational QA. MCP is the complete agent-facing surface.

## REST API

REST endpoints live at:

```text
http://localhost:3000/api/v1
```

Use REST for integrations that cannot run MCP or for custom web tooling.

Authentication:

```text
Authorization: Bearer <jwt-token>     # human login
Authorization: Bearer crmy_<api-key>  # agent or integration
```

Create scoped API keys for agents and integrations:

```text
POST /auth/api-keys
{ "label": "my-agent", "scopes": ["contacts:read", "activities:write"] }
```

## Architecture

```text
packages/
  shared/   @crmy/shared   TypeScript types, Zod schemas
  server/   @crmy/server   Express, PostgreSQL, REST, MCP HTTP
  cli/      @crmy/cli      Local CLI and stdio MCP server
  web/      @crmy/web      React app at /app
docker/                    Dockerfile and docker-compose.yml
examples/                  Copy-paste agent harness setup examples
docs/recipes/              Agent walkthroughs
```

Design choices:

- **MCP-first**: agents use tools, not brittle app-specific glue.
- **PostgreSQL-backed**: durable state, migrations, audit, and optional pgvector retrieval.
- **Typed Memory**: GTM-specific context instead of generic chatbot memory.
- **Scoped actors**: members, managers, admins, owners, and agents see only what they are allowed to see.
- **Evidence and lineage**: important claims point back to source material.
- **Governed writes**: mutating actions use idempotency, policy, approvals, and audit receipts.
- **Local-first model support**: Workspace Agent configuration can use local or OpenAI-compatible providers.

## Environment Essentials

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `JWT_SECRET` | Production | JWT signing secret. Required for hardened production deployments. |
| `CRMY_ADMIN_EMAIL` | Optional | Auto-create the first owner account. |
| `CRMY_ADMIN_PASSWORD` | Optional | Password for the first owner account. |
| `CRMY_SEED_DEMO` | Optional | Seed demo data on startup when set to `true`. |
| `ENABLE_PGVECTOR` | Optional | Enable pgvector migrations and semantic retrieval support. |
| `EMBEDDING_PROVIDER` | Optional | Embedding provider for semantic retrieval. |
| `EMBEDDING_API_KEY` | Optional | Embedding provider API key. |
| `LLM_TIMEOUT_MS` | Optional | General Workspace Agent and background LLM timeout. |
| `CONTEXT_EXTRACTION_LLM_TIMEOUT_MS` | Optional | Raw Context extraction timeout. |

See [`.env.example`](.env.example) for the full reference.

## Develop From Source

```bash
git clone https://github.com/codycharris/crmy.git
cd crmy
npm install
npm run build
```

Run the local dev stack:

```bash
npm run dev
```

This starts:

- API server on `http://localhost:3000`
- Vite web app on `http://localhost:5173`

Useful checks:

```bash
npm run lint
npm run build
npm test
```

## Learn More

- [Guide](docs/guide.md)
- [MCP tools](docs/mcp-tools.md)
- [Examples](examples/README.md)
- [Claude Code account briefing example](examples/claude-code-account-briefing/README.md)
- [Claude Desktop account briefing example](examples/claude-desktop-account-briefing/README.md)
- [ChatGPT Developer Mode account briefing example](examples/chatgpt-developer-mode-account-briefing/README.md)
- [Codex account briefing example](examples/codex-account-briefing/README.md)
- [Hermes Agent account briefing example](examples/hermes-agent-account-briefing/README.md)
- [OpenClaw plugin account briefing example](examples/openclaw-plugin-account-briefing/README.md)
- [GTM agent demo](docs/recipes/gtm-agent-demo.md)
- [Post-meeting agent](docs/recipes/post-meeting-agent.md)
- [Pipeline review agent](docs/recipes/pipeline-review-agent.md)
- [Outreach agent](docs/recipes/outreach-agent.md)
- [Context governance agent](docs/recipes/context-governance-agent.md)
- [Renewal risk agent](docs/recipes/renewal-risk-agent.md)
- [Public signal research agent](docs/recipes/public-signal-research-agent.md)
- [0.8-1.0 roadmap](docs/roadmap-0.8-1.0.md)

## Release

Current version: `0.8.5`

v0.8.x focuses on making CRMy a usable, scoped GTM agent workspace:

- Raw Context ingestion with evidence-backed Signals
- Signal consolidation and typed Memory readiness
- scoped member, manager, and admin workspaces
- Workspace Agent with record scope, durable turns, attachments, and tool logs
- Handoffs as the approval and review boundary
- Customer Email and Customer Activity as first-class context sources
- Systems of Record setup, mapping, sync, conflict handling, and governed writeback
- MCP and CLI coverage for source-to-action workflows

Older release notes live in [CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0
