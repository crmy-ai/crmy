<p align="center">
  <img src="https://crmy.ai/crmy-logo.png" alt="CRMy" width="120" />
</p>

<h1 align="center">CRMy</h1>

<h2 align="center">Customer context engine for AI GTM agents.</h2>

<p align="center">
  CRMy turns messy customer context into trusted active context: what is true, stale, inferred, evidenced, risky, committed, awaiting approval, and safe to do next.
</p>
<p align="center">
  <strong>Messy customer context in. Agent-ready Signals, Memory, and action guidance out.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@crmy/cli"><img alt="npm" src="https://img.shields.io/npm/v/@crmy/cli?label=npm&color=2563eb"></a>
  <a href="https://github.com/crmy-ai/crmy/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-0f172a"></a>
  <a href="https://discord.gg/2HvmudDwE"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white"></a>
  <a href="https://github.com/crmy-ai/crmy/releases"><img alt="Release" src="https://img.shields.io/badge/release-v0.9.1-16a34a"></a>
  <a href="https://github.com/crmy-ai/crmy/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/crmy-ai/crmy?style=social"></a>
</p>

<p align="center">
  <a href="#why-crmy">Why CRMy</a>
  ·
  <a href="#30-second-proof">30-Second Proof</a>
  ·
  <a href="#quickstart">Quickstart</a>
  ·
  <a href="#connect-agents-through-mcp">MCP</a>
  ·
  <a href="docs/guide.md">Guide</a>
  ·
  <a href="examples/README.md">Examples</a>
</p>

---

AI sales, CS, support, and RevOps agents can draft, summarize, and call APIs. They still hit walls when customer truth is scattered across CRM fields, meeting transcripts, emails, notes, calendar events, and human approvals.

Without a context layer, agents ask the wrong questions:

- Is this CRM field still current?
- Did the customer actually say this, or did we infer it?
- Is there evidence behind this risk, commitment, or next step?
- Is this actor allowed to see or change the record?
- Does this email, CRM update, or workflow need approval?
- What proof exists after the agent acts?

CRMy is the operating layer for those questions. Instead of dumping records into a prompt, CRMy gives agents the customer Memory, warnings, policy, evidence, and action boundaries they need before they engage a customer or change a system of record.

```text
Raw Context -> Signals -> Memory -> Briefing + Action Context -> Handoff / Writeback -> Audit Trail
```

## Why CRMy

CRMy is built for teams creating customer-facing agents that need to work safely with real GTM data.

| Agent need | What CRMy provides |
|---|---|
| Know the customer before acting | Account, contact, opportunity, activity, Signal, Memory, and stale-context briefings. |
| Separate fact from inference | Evidence-backed Signals stay distinct from confirmed Memory until they are ready. |
| Use messy sources | Notes, transcripts, emails, calendar events, CRM/warehouse sync, REST, CLI, MCP, and UI Add Context flows. |
| Stay inside action boundaries | Actor scope, warnings, policy checks, approvals, Handoffs, writeback previews, and audit receipts. |
| Keep prompts smaller | Ranked, token-budgeted packets with evidence summaries by default and full proof on demand. |
| Connect through agent-native surfaces | MCP-first tools with REST, CLI, and Web UI surfaces over the same PostgreSQL-backed engine. |

CRMy does not replace your CRM, warehouse, mailbox, calendar, support desk, or sales methodology. Those systems remain where work happens and state is stored. CRMy makes that state agent-operable.

## How It Works

```mermaid
flowchart LR
  raw["Raw Context\nemails, meetings, notes, sync, agent inputs"]
  signals["Signals\ninferred claims + evidence"]
  memory["Memory\nconfirmed customer truth"]
  context["Briefing + Action Context\nwarnings, policy, evidence"]
  action["Agent action\nemail, handoff, workflow, writeback"]
  audit["Audit + Lineage"]

  raw --> signals
  signals -->|confirmed + ready| memory
  signals -->|uncertain or sensitive| context
  memory --> context --> action --> audit
  raw --> audit
  signals --> audit
  memory --> audit
```

CRMy keeps customer context useful without pretending messy source material is instantly true.

- **Raw Context** is source material before extraction: transcripts, emails, notes, meetings, CRM changes, docs, support/product signals, and agent inputs.
- **Signals** are inferred claims with evidence, confidence, source lineage, and readiness.
- **Memory** is confirmed operational customer context agents can rely on across sessions. Memory carries freshness and decay signals, so CRMy does not treat customer truth as permanent.
- **Briefings** answer: what should the agent know?
- **Action Context** answers: is this action ready, allowed, risky, stale, or review-required?
- **Handoffs and Writeback** keep approval, idempotency, audit, and execution receipts in the path when work touches a customer or system of record.

## 30-Second Proof

The seeded demo shows CRMy doing more than a CRM lookup. It resolves the customer, retrieves a briefing with Memory and Signals, surfaces reviewable context, checks action readiness, and shows source-to-context proof.

Start Postgres first, or complete the [Quickstart](#quickstart), then run:

```bash
npx -y @crmy/cli init --demo
npx -y @crmy/cli agent-smoke
npx -y @crmy/cli briefing "account:Northstar Labs"
npx -y @crmy/cli action-context "account:Northstar Labs" --action customer_outreach
npx -y @crmy/cli context lineage --subject "account:Northstar Labs"
```

Representative output:

```text
Resolved account "Northstar Labs"
Briefing returned Memory, activity, open assignments, and related Signals
Action Context returned action guidance and recommended next steps
Found Signals needing attention
Lineage returned source-to-context proof
```

Optional live extraction check, if you have a Workspace Agent model configured:

```bash
cat > /tmp/northstar-note.txt <<'EOF'
Northstar call: Maya is pushing for expansion, but security review is the blocker.
They need technical validation before Friday. Procurement is not involved yet.
EOF

npx -y @crmy/cli context ingest --subject "account:Northstar Labs" --file /tmp/northstar-note.txt
npx -y @crmy/cli context signal-groups
```

The core concept: messy customer source material becomes reviewable Signals with evidence before it becomes trusted Memory.

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

Initialize and run CRMy:

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

Demo users:

```text
Admin   sample.admin@crmy.local / crmy-demo-123
Manager sample.manager@crmy.local / crmy-demo-123
Rep     sample.rep@crmy.local / crmy-demo-123
Peer    sample.peer@crmy.local / crmy-demo-123
```

What `init --demo` does:

1. Connects to PostgreSQL.
2. Creates the local database when needed.
3. Runs migrations.
4. Creates the first owner account.
5. Generates persistent JWT and stored-secret encryption keys.
6. Writes local CLI and MCP config.
7. Configures the Workspace Agent automatically when local Ollama is running with an installed model.
8. Seeds demo data so the examples work immediately.

For CI or another fully headless setup, use `init --yes --demo`. For a clean workspace without sample data, use `init --yes --no-demo`.

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

## Core Capabilities

| Capability | What it does |
|---|---|
| **Customer briefings** | Retrieve Current Memory, recent activity, open Handoffs, stale warnings, and unresolved Signals before analysis. |
| **Action Context** | Return readiness, policy, warnings, source authority, review requirements, and audit metadata before customer-facing or record-changing work. |
| **Raw Context ingestion** | Accept messy notes, transcripts, emails, meetings, sync records, agent inputs, and custom source metadata. |
| **Signals and Memory** | Extract inferred claims with evidence, then promote durable Memory only when readiness and policy allow it. |
| **Email and calendar context** | Connect actor mailboxes/calendars for customer communication, meeting context, availability-aware suggestions, and sender-aware email actions. |
| **Handoffs and approvals** | Route uncertain, sensitive, or governed work to humans with evidence attached. |
| **Systems of record** | Configure CRM/warehouse sync and governed writeback through mappings, previews, approvals, and receipts. |
| **Lineage and audit** | Trace source material into Signals, Memory, actions, reviews, writebacks, and receipts. |
| **MCP, CLI, REST, UI** | Use the same engine from agent tools, scripts, integrations, and the web app. |

## Token-Aware Context

CRMy is designed to reduce prompt waste, not maximize prompt size.

- It compresses noisy source material into Signals and Memory with source receipts.
- It returns confirmed Memory, unresolved Signals, stale warnings, and risky claims separately.
- It retrieves by action through `briefing_get` and `action_context_get` instead of dumping the customer database.
- It supports `context_radius`, explicit `token_budget`, and budget profiles such as `tiny`, `standard`, `deep`, and `evidence_heavy`.
- It ranks high-value context first and reports when lower-priority entries were omitted.
- It uses evidence summaries by default, with full Lineage and Raw Context available on demand.

The goal is the smallest sufficient, trustworthy customer context packet for the next action.

## Connect Agents Through MCP

CRMy is MCP-native. Local agent clients can usually start CRMy over stdio:

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

Ask a connected agent:

```text
Use the CRMy MCP tools to resolve the customer record "Northstar Labs", get a briefing, get Action Context for customer outreach, list Signals that need attention, check lineage outcomes, and tell me the safest next action with the evidence you used.
```

Common first tools:

| Goal | MCP tool |
|---|---|
| Decide which tool path to use | `tool_guide` |
| Resolve customer records | `customer_record_resolve` |
| Brief an agent before analysis | `briefing_get` |
| Check whether action is ready | `action_context_get` |
| Ingest messy customer context | `context_ingest_auto` |
| Find Memory, Signals, stale context, or search results | `context_find` |
| Review evidence-backed Signals | `context_signal_group_list` |
| Confirm a Signal as Memory | `context_signal_group_promote` |
| Create the needed human unblock | `action_context_request_human_unblock` |
| Draft a customer email | `email_draft_preview` |
| Draft a new record from natural language | `record_draft_preview` |

Use scoped API keys for agents whenever possible. Ordinary customer-reasoning agents should see a small workflow-specific tool set, not the full admin/operator catalog.

See [MCP tools](docs/mcp-tools.md) for the full tool catalog and scoped-access model.

## CLI And REST

Friendly CLI commands cover setup, demos, Raw Context ingestion, activity/email review, systems, workflows, and operational QA.

```bash
crmy init
crmy doctor
crmy server
crmy seed-demo --reset

crmy briefing "account:Northstar Labs"
crmy action-context "account:Northstar Labs" --action customer_outreach
crmy context signal-groups
crmy context lineage --subject "account:Northstar Labs"
crmy tools describe action_context_get
```

REST endpoints live at:

```text
http://localhost:3000/api/v1
```

Use REST for integrations that cannot run MCP or for custom web tooling.

```text
Authorization: Bearer <jwt-token>     # human login
Authorization: Bearer crmy_<api-key>  # agent or integration
```

## Web App Surfaces

| Surface | What it is for |
|---|---|
| **Overview** | Daily operating view: what is set up, what context is flowing, and what needs action. |
| **Workspace Agent** | Scoped customer workbench for briefings, tool use, drafting, record work, and customer reasoning. |
| **Context** | Raw Context, Signals, Memory, Lineage, and Context Sources. |
| **Handoffs** | Decision queue for approvals, escalations, delegated work, and governed action review. |
| **Customer Email** | Mailbox Context plus Outbound Actions for governed drafts/sends with visible sender identity. |
| **Customer Activity** | Meetings, notes, transcripts, calendar context, and availability-aware meeting suggestions. |
| **Systems of Record** | Admin setup for CRMs, warehouses, mappings, sync, conflicts, and governed writeback. |
| **Settings** | Actors, system connections, model settings, automations, API keys, and operational configuration. |

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

## Configuration

`crmy init` generates sane local defaults for JWT and secret encryption keys. Production, container, and hosted deployments should set stable secrets explicitly.

Minimum local environment:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
CRMY_ADMIN_EMAIL=admin@example.com
CRMY_ADMIN_PASSWORD=<strong-password>
```

Common production essentials:

```env
JWT_SECRET=<stable-random-secret>
CRMY_ENCRYPTION_KEY=<stable-32-byte-base64-or-hex-secret>
CRMY_PUBLIC_URL=https://<your-crmy-host>
CRMY_CORS_ORIGINS=https://<your-web-origin>
```

See [`.env.example`](.env.example) for the full reference, including hosted OAuth, mailbox/calendar, semantic retrieval, rate limits, MCP session routing, provider timeouts, and connector settings.

## Develop From Source

```bash
git clone https://github.com/crmy-ai/crmy.git
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
- [Context Engine](docs/context-engine.md)
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

Current version: `0.9.1`

Release notes live in [RELEASE_NOTES.md](RELEASE_NOTES.md). Older release notes live in [CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0
