<p align="center">
  <img src="https://crmy.ai/crmy-logo.png" alt="CRMy" width="120" />
</p>

<h1 align="center">CRMy</h1>

<h2 align="center">Operational customer context for AI agents.</h2>

<p align="center">
  Before a customer-facing agent acts, it needs trusted context. CRMy turns meeting transcripts, emails, notes, CRM changes, and other raw customer context into the trusted briefing any AI agent needs before it acts.
</p>
<p align="center">
  <strong>Messy customer context in. Agent-ready Signals, Memory, and action guidance out.</strong> 
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@crmy/cli"><img alt="npm" src="https://img.shields.io/npm/v/@crmy/cli?label=npm&color=2563eb"></a>
  <a href="https://github.com/crmy-ai/crmy/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-0f172a"></a>
  <a href="https://discord.gg/2HvmudDwE"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white"></a>
  <a href="https://github.com/crmy-ai/crmy/releases"><img alt="Release" src="https://img.shields.io/badge/release-v0.9.0-16a34a"></a>
  <a href="https://github.com/crmy-ai/crmy/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/crmy-ai/crmy?style=social"></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a>
  ·
  <a href="#demo-raw-context-to-agent-briefing">Demo</a>
  ·
  <a href="#why-crmy">Why CRMy?</a>
  ·
  <a href="#connect-agents-through-mcp">MCP</a>
  ·
  <a href="docs/recipes/README.md">Recipes</a>
  ·
  <a href="examples/README.md">Examples</a>
</p>

---

Sales, CS, support, and RevOps agents do not need another place to store context. They need to know what is true, current, evidenced, approved, and safe to act on.

That breaks down when customer context is messy:

- the CRM is stale or incomplete;
- the call transcript has the real blocker but no durable structure;
- renewal risk is implied across emails, meetings, and notes;
- the agent cannot tell evidence from inference;
- the next action needs approval before it touches a customer or system of record;
- nobody can explain afterward why the agent acted.

CRMy is the context engine for that gap.

It accepts **Raw Context**, resolves the customer, extracts evidence-backed **Signals**, keeps inferred Signals separate until evidence, readiness, and review requirements allow them to become typed **Memory**, and retrieves the right briefing and Action Context before an agent drafts, decides, requests approval, or writes back.

```text
Raw Context -> Signals -> Memory -> Briefing + Action Context -> Handoff / Writeback -> Audit Trail
```

A customer-facing agent should be able to ask one high-level question before work:

> What do I need to know about this customer, what is uncertain or stale, what am I allowed to do, and what evidence backs it?

CRMy gives that answer through agent tools, CLI, REST, and UI surfaces on top of PostgreSQL.

> **Run the demo agent check:** complete the [Quickstart](#quickstart), then verify the source-to-action loop. It is not just a CRM lookup. It resolves the customer, retrieves a briefing with Memory and Signals, surfaces reviewable context, and shows the evidence behind the agent-ready output.
>
> ```bash
> npx -y @crmy/cli agent-smoke
> npx -y @crmy/cli briefing "account:Northstar Labs"
> npx -y @crmy/cli context signal-groups
> npx -y @crmy/cli context lineage --subject "account:Northstar Labs"
> ```

Star CRMy if you’re building customer-facing agents that need operational memory, scoped tools, and governed action. If you expect them to *reliably* interact with customers, they do.

---

CRMy does not replace your systems of record. Your CRM, warehouse, support desk, mailbox, calendar, and other tools remain where work happens and state is stored.

CRMy makes that state agent-operable.

```mermaid
flowchart LR
  raw["Messy Raw Context\ntranscripts, emails, notes, sync"]
  signals["Signals\ninferred claims + evidence"]
  memory["Memory\nconfirmed customer truth"]
  retrieve["One retrieval path\nbriefing_get / action_context_get"]
  action["Agent action\nwith warnings + policy"]
  audit_trail["Handoff / Writeback / Audit Trail"]

  raw --> signals --> memory --> retrieve --> action --> audit_trail
```

TL;DR: Before an agent acts on a customer, CRMy can tell it what is known, what is stale, what is inferred, what is approved, what action is allowed, what system owns the record, and what evidence or audit trail will exist afterward.

CRMy is not just retrieval over customer data. It separates inferred Signals from confirmed Memory, tracks source evidence and freshness, applies actor scope and policy, and records proof when an agent acts.

## Why CRMy?

Most sales, CS, support, and RevOps agents can draft, summarize, and call APIs. They still struggle with the operational questions that matter before action:

- What do we actually know about this account or deal?
- Which claims came from evidence, and which are only inferred?
- What changed since the last call, email, sync, or agent run?
- Which Memory is stale, contradicted, or missing support?
- Is this actor/agent allowed to see or change this record?
- Does this action need approval before it touches our system of record?
- What receipt shows what happened afterward?

CRMy gives agents that operating layer.

## Who This Is For

CRMy is for builders creating sales, CS, RevOps, support, or other customer-facing agents that need to work with humans and revenue systems safely.

Use it when your agent needs to know account state, inspect evidence, remember durable customer context, respect user scope, act with the right warnings, request approval when risk requires it, or prepare governed CRM/writeback actions.

## The Agent Context Loop

CRMy is built around the loop every customer-facing agent needs before action: observe messy context, remember what is proven, and act with guardrails.

### 1. Observe Freely

Ingest customer context from calls, meetings, emails, notes, calendar activity, CRM/warehouse sync, REST, CLI, MCP, and manual Add Context flows. Source metadata can represent support, product, Slack, document, and custom sources when those systems feed CRMy through API, MCP, or future adapters.

Raw Context stays messy. CRMy resolves visible customer records, extracts evidence-backed Signals, and keeps receipts for what was processed, skipped, matched, or failed.

The same account-first resolver powers Raw Context, customer email, calendar/activity capture, and agent record lookup, so opportunities and use cases are matched inside the right account instead of guessed globally.

### 2. Remember Operationally

Store typed customer Memory for accounts, contacts, opportunities, use cases, stakeholders, risks, objections, commitments, next steps, buying process, success criteria, and forecast signals.

Memory is persistent, scoped, searchable, versioned, auditable, and designed for agent action. Signals remain separate until evidence, source quality, typed detail, policy, and readiness allow them to become confirmed Memory.

### 3. Act Safely

Brief agents before action, warn when context is stale or inferred, route sensitive decisions through Handoffs, enforce user and team scope, preview writebacks, apply policy, and emit audit receipts.

Agents can prepare work freely. CRMy decides what can proceed, what needs a warning, what can be written, what needs approval, and what must stay reviewable. That same boundary applies to manual actions, Workspace Agent actions, workflow-triggered actions, sequence sends, customer email drafts, and systems-of-record writeback.

## Core Concepts

| Concept | What it means |
|---|---|
| **Raw Context** | Source material before extraction: transcripts, emails, notes, calendar meetings, CRM changes, docs, support/product signals, and agent inputs. |
| **Signals** | Inferred claims with evidence, confidence, source lineage, and readiness. Signals can be confirmed, dismissed, or sent to review. |
| **Memory** | Confirmed operational customer context agents can rely on across sessions and workflows. Memory carries freshness and decay signals, so CRMy does not treat customer truth as permanent. |
| **Active Context** | The temporary working set an agent can see right now: prompt, conversation, bound record, retrieved briefing, tool results, and loaded files. |
| **Action Context** | Action guidance in one packet: readiness, policy, source authority, warnings, review requirements, and audit metadata before an agent prepares customer-facing or record-changing work. |
| **Handoffs** | Human review for approvals, escalations, uncertain Signals, and governed decisions. |
| **Writeback** | Policy-checked updates to systems of record through preview, approval, idempotency, audit, and execution receipts. |

Briefings answer “what should the agent know?” Action Context answers “is this action ready, allowed, risky, stale, or review-required?”

## What CRMy Is Not

- Not a CRM replacement. Salesforce, HubSpot, warehouses, and support desks stay the systems of record.
- Not generic chatbot memory. CRMy stores typed, evidence-backed customer Memory with lifecycle, ownership, freshness, and audit.
- Not a workflow toy. Agents can prepare action, but CRMy keeps policy, Handoffs, writeback receipts, and human review in the path when risk requires it.
- Not a sales methodology lock-in. Registries and Memory types are extensible, so teams can model their own customer operating language.

## Architecture

```mermaid
flowchart LR
  sources["Calls, emails, CRM, calendar, support, product, docs, MCP"]
  raw["Raw Context"]
  signals["Signals\ninferred + evidence-backed"]
  memory["Memory\nconfirmed + typed"]
  active["Active Context\nbriefing_get + search"]
  action_context["Action Context\nreadiness + policy + audit"]
  agent["Agent action"]
  handoff["Handoffs\napproval + review"]
  writeback["System-of-record writeback"]
  audit["Audit + Lineage"]

  sources --> raw --> signals
  signals -->|confirmed + ready| memory
  signals -->|uncertain or sensitive| handoff
  memory --> active --> action_context --> agent
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
- expose the core loop through Web UI, REST, MCP, and CLI tool calls

## How The Engine Works

CRMy's main value is the engine underneath the app. Each step preserves enough structure, evidence, and audit metadata for the next step to be safe:

```text
Raw Context -> Subject Graph -> Signals -> Memory -> Briefing / Action Context -> Handoff / Writeback -> Audit Trail
```

1. **Raw Context** enters from transcripts, emails, notes, meetings, CRM/warehouse sync, REST, CLI, MCP, or the UI.
2. **Subject Graph** resolves which account, contact, opportunity, or use case the source material belongs to.
3. **Signals** capture inferred customer claims with evidence, source provenance, confidence, and readiness.
4. **Memory** stores confirmed operational context agents can rely on across sessions.
5. **Briefing / Action Context** retrieves the right Memory, Signals, stale warnings, policy, source authority, review requirements, and evidence before work.
6. **Handoff / Writeback** routes uncertain or sensitive work through human review, idempotency, audit, and execution receipts.

That engine keeps customer context useful without pretending messy source material is instantly true. Handoffs, writeback policy, receipts, audit, and Lineage carry evidence through execution.

The most important community contributions are real-world tests of this loop: messy transcripts, customer emails, calendar meetings, CRM/warehouse sync, custom systems of record, writeback previews, approval flows, and agent harnesses. See [Context Engine](docs/context-engine.md) and [Contributing](CONTRIBUTING.md) for where testing helps most.

## API, MCP, And CLI Parity

MCP is the canonical agent-facing tool contract. REST and CLI expose that contract through direct routes and an actor-scoped generic tool bridge. Friendly CLI commands cover common workflows, while `crmy tools list`, `crmy tools describe <tool_name>`, and `crmy tools call <tool_name>` provide direct access to the full visible MCP tool set for the current actor.

## Quickstart

Local setup usually takes 2-5 minutes if Docker and Node.js are already installed.

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
export CRMY_ADMIN_PASSWORD="$(openssl rand -base64 24)"
printf 'CRMy admin password: %s\n' "$CRMY_ADMIN_PASSWORD"

npx -y @crmy/cli init --demo
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

First things to try:

1. Open the Web UI and view Northstar Labs.
2. Run `agent-smoke`.
3. Run `briefing "account:Northstar Labs"`.
4. Ingest the sample note in the demo below.

What `init --demo` does:

1. Connects to PostgreSQL.
2. Creates the local database when needed.
3. Runs migrations.
4. Creates the first owner account.
5. Generates persistent JWT and stored-secret encryption keys.
6. Writes local CLI and MCP config.
7. Configures the Workspace Agent automatically when local Ollama is running with an installed model.
8. Seeds demo data so the examples below work immediately.

For CI or another fully headless setup, use `init --yes --demo`. For a clean workspace without sample data, use `init --yes --no-demo`.

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

## Demo: Raw Context To Agent Briefing

After quickstart, the seeded demo shows CRMy doing more than serving CRM records. It shows customer context becoming agent-usable Memory.

The seeded proof path does not require an LLM provider. Live extraction from your own notes requires a configured Workspace Agent model.

```bash
npx -y @crmy/cli agent-smoke
npx -y @crmy/cli briefing "account:Northstar Labs"
npx -y @crmy/cli context signal-groups
npx -y @crmy/cli context lineage --subject "account:Northstar Labs"
```

Representative demo check output:

```text
Resolved account "Northstar Labs"
Briefing returned Memory, activity, open assignments, and related Signals
Found Signals needing attention
```

You should see:

1. **Resolution**: the demo check resolves `Northstar Labs` through the same account-first resolver agents use for ambiguous customer references.
2. **Briefing**: the briefing tool returns Current Memory, recent activity, open assignments, stale warnings, and reviewable Signals in one agent-ready payload.
3. **Signals**: `context signal-groups` shows inferred claims that need attention across the customer graph; direct `context signals --subject ...` is narrower and only lists raw Signal entries attached to that exact record.
4. **Memory**: confirmed context is available to briefings and search across sessions.
5. **Lineage**: source material can be traced into Signals, Memory, related records, and later review/writeback/audit receipts when those actions happen.

With a Workspace Agent model configured, you can also check live Raw Context extraction:

```bash
cat > /tmp/northstar-note.txt <<'EOF'
Northstar call: Maya is pushing for expansion, but security review is the blocker.
They need technical validation before Friday. Procurement is not involved yet.
EOF

npx -y @crmy/cli context ingest --subject "account:Northstar Labs" --file /tmp/northstar-note.txt
npx -y @crmy/cli context signals --subject "account:Northstar Labs"
npx -y @crmy/cli context signal-groups
npx -y @crmy/cli agent-smoke --with-model   # optional: checks live Raw Context extraction with your configured model
```

This is the core behavior: messy source material becomes reviewable Signals with evidence before it becomes trusted Memory.

Representative Signal output:

```text
Signal group: Send trust packet to unblock pilot approval
Status: ready
Evidence: "She can sponsor the evaluation if we send the trust packet by Friday."
Source: Ingested document -> Northstar Labs
Next: confirm as Memory or route to Handoff
```

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

## Try A Customer Briefing

The fastest way to see CRMy work is to ask what an agent should know before touching a customer:

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

That is the core CRMy contract: a customer-facing agent does not have to scrape five tools, guess what is true, or rely on stale CRM fields. It asks CRMy for the customer briefing, then checks action readiness when work may touch a customer or system of record.

Check action readiness before customer-facing or record-changing work:

```bash
npx -y @crmy/cli action-context "account:Northstar Labs" --action customer_outreach
```

```text
Operating mode: warn
Readiness: review_needed
Reasons:
- Open Signals need review before relying on them
- Current Memory may require fresh evidence before action
```

## Connect Agents Through MCP

CRMy is MCP-native. Add it to an agent harness and give the agent scoped tools for briefings, Raw Context ingestion, Signals, Memory, Handoffs, email drafting, record drafting, workflows, and systems-of-record writeback.

Local agent clients can usually start CRMy over stdio:

```bash
claude mcp add crmy -- npx -y @crmy/cli mcp
codex mcp add crmy -- npx -y @crmy/cli mcp
```

Claude Desktop, Cursor, Windsurf, and other MCP clients can use the same command:

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

Remote clients, including ChatGPT Developer Mode, need a reachable CRMy server and the HTTP MCP endpoint:

```text
https://<your-crmy-host>/mcp
Authorization: Bearer <CRMy API key>
```

For harness-specific setup, see the examples for [Claude Code](examples/claude-code-account-briefing/README.md), [Claude Desktop](examples/claude-desktop-account-briefing/README.md), [Codex](examples/codex-account-briefing/README.md), [ChatGPT Developer Mode](examples/chatgpt-developer-mode-account-briefing/README.md), [Hermes Agent](examples/hermes-agent-account-briefing/README.md), and [OpenClaw](examples/openclaw-plugin-account-briefing/README.md).

Demo Prompt - Ask your agent to run this with CRMy MCP tools:

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
| Brief an agent before analysis | `briefing_get` |
| Check whether action is ready | `action_context_get` |
| Find Memory, Signals, stale context, or search results | `context_find` |
| Ingest messy customer context | `context_ingest_auto` |
| Review evidence-backed Signals | `context_signal_group_list` |
| Repair missing Signal details | `context_signal_group_complete_details` |
| Confirm a Signal as Memory | `context_signal_group_promote` |
| Route uncertain work to review | `context_signal_handoff` |
| Draft a customer email | `email_draft_preview` |
| Draft a new record from natural language | `record_draft_preview` |

Use scoped API keys for agents whenever possible. Ordinary customer-reasoning agents should see a small workflow-specific tool set, not the full admin/operator catalog.

See [MCP tools](docs/mcp-tools.md) for the full tool catalog and scoped-access model.

## Where The Loop Shows Up

| Surface | What it is for |
|---|---|
| **Overview** | Daily operating view: what is set up, what context is flowing, and what needs action. |
| **Workspace Agent** | Scoped customer workbench for briefings, tool use, drafting, record work, and customer reasoning. |
| **Context** | Raw Context, Signals, Memory, Lineage, and Context Sources. Graph remains available as a supporting record explorer. |
| **Handoffs** | Decision queue for approvals, escalations, delegated work, and governed action review. |
| **Customer Email** | Supporting Context Source for mailboxes, customer-message review, and governed follow-up drafts. |
| **Customer Activity** | Supporting Context Source for meetings, calls, notes, transcripts, and calendar context. |
| **Systems of Record** | Admin setup for CRMs and warehouses, field mappings, sync, conflicts, and governed writeback. |
| **Settings → Automations** | Admin/advanced event rules and sequences that request governed action instead of bypassing policy. |

## Source Support Levels

| Level | Sources | Current behavior |
|---|---|---|
| First-class ingestion | Add Context, REST, MCP, CLI, Customer Email, Customer Activity/calendar, systems-of-record sync | Creates Raw Context receipts, Signals, Memory candidates, and lineage/audit metadata. |
| Metadata-supported sources | Support records, product usage, Slack, documents, research packets, custom source types | Can be represented in source/evidence metadata when fed through first-class ingestion paths. |
| Future first-class adapters | Inbound Slack, support desk, product telemetry, document repositories | Planned adapter surface; not currently presented as built-in inbound connectors. |

## Signal Promotion Gates

Signals can be created freely from useful customer evidence, but they become Memory conservatively.

A Signal can auto-promote only when all of these are true:

- extraction auto-promotion is enabled for the Workspace Agent;
- at least one supporting evidence item exists;
- the claim is not speculative;
- typed Memory readiness is complete enough for the Signal's context type;
- the Signal/group score meets the configured confirmation threshold;
- the related Signals are ready, without unresolved conflict or duplicate-source inflation;
- policy allows promotion for the current actor without approval.

Otherwise, the Signal remains reviewable. Users or agents can add missing detail, add evidence, send it to Handoff, reject it as Memory, or confirm it manually when allowed.

## Systems of Record

CRM remains the system of record. CRMy makes it safer for agents to work with it.

Implemented connector paths include:

- HubSpot
- Salesforce
- Databricks SQL Warehouse
- Snowflake

Custom source and writeback integrations can also feed CRMy through REST, MCP, or webhooks. They are not first-class systems-of-record connectors unless they use one of the supported connector types above.

Configured connector mappings can read external records into typed CRMy objects, preserve external references, detect conflicts, and request governed writebacks. New mappings default to read-only. Writeback must be explicitly enabled field by field and still passes through preview, policy, approval, audit, and execution receipts.

Production certification should be performed against each target CRM or warehouse environment before enabling writeback broadly.

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
crmy context signals
crmy context signal-groups
crmy context lineage --subject "account:Northstar Labs"
crmy action-context "account:Northstar Labs"
crmy activities meetings
crmy emails messages
crmy hitl list
crmy systems list
crmy workflows list
crmy sequences list
crmy tools describe action_context_get
```

Friendly CLI commands cover setup, demos, Raw Context ingestion, activity/email review, systems, workflows, and operational QA. `crmy tools list`, `crmy tools describe <tool_name>`, and `crmy tools call <tool_name>` expose the same actor-scoped MCP tool surface through the CLI.

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

API key creation, update, listing, and revocation require an owner/admin actor with
`api_keys:admin`. Actors can only grant scopes they already hold.

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
- **Typed Memory**: customer-facing operational context instead of generic chatbot memory.
- **Scoped actors**: members, managers, admins, owners, and agents see only what they are allowed to see.
- **Evidence and lineage**: important claims point back to source material.
- **Governed writes**: mutating actions use idempotency, policy, approvals, and audit receipts.
- **Local-first model support**: Workspace Agent configuration can use local or OpenAI-compatible providers.

## Environment Essentials

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `JWT_SECRET` | Server process | JWT signing secret. `crmy init` generates this for local CLI-managed installs; set it explicitly for production, containers, or direct `npm run dev`/server processes. |
| `CRMY_ENCRYPTION_KEY` | Production | Secret encryption key for connector credentials, mailbox/calendar OAuth tokens, and Workspace Agent provider keys. `crmy init` and the local source dev server generate this automatically for local installs; production and container deployments should set one stable value explicitly. |
| `CRMY_ADMIN_EMAIL` | Optional | Auto-create the first owner account. |
| `CRMY_ADMIN_PASSWORD` | Optional | Password for the first owner account. |
| `CRMY_CORS_ORIGINS` | Optional | Comma-separated browser origins allowed to call the API cross-origin. |
| `CRMY_TRUST_PROXY` | Optional | Set to `1` when CRMy runs behind one trusted reverse proxy. |
| `CRMY_SEED_DEMO` | Optional | Seed demo data on startup when set to `true`. |
| `ENABLE_PGVECTOR` | Optional | Enable pgvector migrations and semantic retrieval support. |
| `EMBEDDING_PROVIDER` | Optional | Embedding provider for semantic retrieval. |
| `EMBEDDING_API_KEY` | Optional | Embedding provider API key. |
| `LLM_TIMEOUT_MS` | Optional | General Workspace Agent and background LLM timeout. Default: `60000`. |
| `AGENT_STREAM_TIMEOUT_MS` | Optional | Streaming Workspace Agent provider timeout. Default: `60000`. |
| `CONTEXT_EXTRACTION_LLM_TIMEOUT_MS` | Optional | Raw Context extraction timeout. Default: `90000`. |
| `SOURCE_SYNC_FETCH_TIMEOUT_MS` | Optional | Mailbox/calendar provider HTTP timeout. Default: `30000`. |
| `CONNECTOR_FETCH_TIMEOUT_MS` | Optional | Systems-of-record connector HTTP timeout. Default: `30000`. |
| `SLACK_SEND_TIMEOUT_MS` | Optional | Slack webhook delivery timeout. Default: `10000`. |

Inbound email webhooks are unauthenticated by bearer token, but must include an
explicit tenant (`tenant_id` query parameter or `x-crmy-tenant-id` header) and a
valid `x-webhook-signature` HMAC using the tenant's configured inbound secret.

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
npm run test:cli-coverage
npx playwright install chromium
npm run test:ui-smoke   # with CRMy running on http://localhost:3000
```

## Learn More

- [Guide](docs/guide.md)
- [MCP tools](docs/mcp-tools.md)
- [Agent recipes](docs/recipes/README.md)
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

Current version: `0.9.0`

Older release notes live in [CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0
