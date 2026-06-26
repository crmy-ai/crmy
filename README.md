<p align="center">
  <img src="https://crmy.ai/crmy-logo.png" alt="CRMy" width="120" />
</p>

<h1 align="center">CRMy</h1>

<h2 align="center">Governed customer context for AI agents</h2>

<p align="center">
  <strong>Messy customer interactions in. Governed agent context out.</strong>
</p>
<p align="center">
  CRMy turns messy customer source material into governed agent context. It ingests meeting transcripts, notes, customer emails, and CRM changes; extracts evidence-backed Signals; validates grounded claims; promotes trusted facts into durable Memory; flags stale context; and returns one compact briefing, with action checks and proof, so agents can act reliably from context you can trust.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@crmy/cli"><img alt="npm" src="https://img.shields.io/npm/v/@crmy/cli?label=npm&color=2563eb"></a>
  <a href="https://github.com/crmy-ai/crmy/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-0f172a"></a>
  <a href="https://discord.gg/2HvmudDwE"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white"></a>
  <a href="https://github.com/crmy-ai/crmy/releases"><img alt="Release" src="https://img.shields.io/badge/release-v0.9.2-16a34a"></a>
  <a href="https://github.com/crmy-ai/crmy/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/crmy-ai/crmy?style=social"></a>
</p>

<p align="center">
  <img src="examples/crmy-claude-demo.gif" alt="CRMy Claude demo showing governed customer context, Action Context, Signals, and lineage" width="900">
</p>

<p align="center">
  <a href="#why-crmy">Why CRMy</a>
  ·
  <a href="#local-demo">Local Demo</a>
  ·
  <a href="#how-it-works">How It Works</a>
  ·
  <a href="#connect-agents-through-mcp">MCP</a>
  ·
  <a href="docs/guide.md">Guide</a>
  ·
  <a href="examples/README.md">Examples</a>
</p>

---

Your AI sales, CS, support, and RevOps agents can draft content, summarize meetings, and call APIs. They still hit walls when customer truth is scattered across CRM fields, meeting transcripts, emails, notes, calendar events, and human approvals.

Without a governed context layer, agents can't answer the most critical questions:

- Did the customer actually say this, or did we infer it?
- Is there evidence behind this risk, commitment, or next step?
- Is this CRM field still current?
- Is this actor (agent) allowed to see or change the record?
- Does this customer email, CRM update, or workflow need human approval?
- What proof should exist after the agent acts? 

CRMy is the operating layer for these questions. Instead of dumping raw records into a prompt, CRMy gives agents the customer Memory, warnings, policy, evidence, and action boundaries they need before they engage a customer or change a system of record, leaving an audit trail behind. It is the **trust boundary between your agents and your customer systems**.

```text
Raw Context -> Signals -> Memory -> Briefing + Action Context -> Handoff / Writeback -> Audit Trail
```

Need proof? Try the <a href="#local-demo">local demo</a> below to see an agent resolve a customer, get a governed briefing, check what is safe to act on, and prove lineage.

## What Agents Get Back

CRMy does not return a raw data dump. It returns a compact packet that separates durable facts from unresolved claims and action risk:

```text
Memory
- Security review is the active expansion blocker.
- Maya is the current expansion champion.

Signals needing review
- Procurement is not involved yet.
  Evidence: "Procurement is not involved yet."
  Status: grounded in source, not confirmed as Memory.

Stale warnings
- Expansion timeline has not been reconfirmed recently.

Safe to act?
- Customer outreach is allowed.
- Include technical validation as the next step.
- Keep the procurement claim out of committed CRM updates until confirmed.
```

## Why CRMy

CRMy is built for teams creating customer-facing agents that need to work safely with real GTM data.

| Agent need | What CRMy provides |
|---|---|
| Extract customer facts from messy inputs | Turn transcripts, notes, emails, meetings, CRM changes, REST, CLI, MCP, and UI inputs into structured Raw Context and Signals. |
| Validate before agents rely on it | Keep inferred Signals separate from confirmed Memory until evidence, readiness, policy, and source grounding say they are safe. |
| Track Memory decay | Carry freshness and decay signals, surface stale warnings, and avoid treating old customer truth as permanent. |
| Decide whether an agent can act | Return readiness, policy checks, source authority, review requirements, Handoffs, writeback previews, and audit receipts. |
| Keep prompts smaller and more useful | Retrieve ranked, token-budgeted packets with evidence summaries by default and full proof on demand. |
| Fit any agent stack | Use MCP-first tools with REST, CLI, and Web UI surfaces over the same PostgreSQL-backed engine. |

CRMy does not replace your CRM, warehouse, mailbox, calendar, support desk, or sales methodology. Those systems remain where work happens and state is stored. CRMy makes that state agent-operable.

## Who CRMy Is For

Use CRMy when you are building agents that need customer context they can trust before acting.

- Sales and CS agents that draft customer emails, prep meetings, or summarize account state.
- RevOps and support agents that update CRM records, create handoffs, or run workflows.
- Agent platforms that need evidence, stale-context warnings, approvals, and audit receipts around customer-facing work.
- Teams that want to test governed customer memory with realistic demo data or direct context ingestion.

## Local Demo

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
npx -y @crmy/cli quickstart
npx -y @crmy/cli server
```

`quickstart` seeds realistic demo data and runs the path an agent takes over MCP: resolve a customer, get a governed briefing, check Action Context, and prove lineage. (`npx -y @crmy/cli doctor` runs the same checks as a pass/fail health check.)

Representative output:

```text
✓ Demo workspace ready: 2 accounts · 6 Signals · 5 Memory
✓ Resolved account "Northstar Labs"
✓ Briefing returned 4 Memory items, 3 activities, and 2 reviewable Signal sets
✓ Action Context returned warn mode, review_needed readiness, 2 recommended actions
✓ Lineage returned source-to-context proof (67 nodes, 395 edges)
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

Start with the Admin user if you want to explore the whole workspace.

Prefer individual commands? They map one-to-one to the MCP calls an agent makes:

```bash
npx -y @crmy/cli briefing "account:Northstar Labs"
npx -y @crmy/cli action-context "account:Northstar Labs" --action customer_outreach
npx -y @crmy/cli context lineage --subject "account:Northstar Labs"
```

Connect an MCP client to the same path:

```bash
claude mcp add crmy -- npx -y @crmy/cli mcp
codex mcp add crmy -- npx -y @crmy/cli mcp
```

Want to watch your own messy text become reviewable context? New extraction from notes or transcripts requires a Workspace Agent model. Once configured, ingest a transcript and see it become evidence-backed Signals. CRMy will not auto-confirm Memory unless the evidence is grounded in the source:

```bash
cat > /tmp/northstar-note.txt <<'EOF'
Northstar call: Maya is pushing for expansion, but security review is the blocker.
They need technical validation before Friday. Procurement is not involved yet.
EOF

npx -y @crmy/cli context ingest --subject "account:Northstar Labs" --file /tmp/northstar-note.txt
npx -y @crmy/cli context signal-groups
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

## How It Works

```mermaid
flowchart LR
  A[Raw Context]
  B[Signals]
  C[Memory]
  D[Briefing]
  E[Action Context]
  F[Agent Action]
  G[Handoff or Review]
  H[Audit and Lineage]
  K[Product Knowledge]

  A --> B
  B --> C
  B --> D
  C --> D
  K --> D
  D --> E
  E --> F
  E --> G
  F --> H
  G --> H
  A --> H
  B --> H
  C --> H
  K --> H
```

CRMy keeps customer context useful without pretending messy source material is instantly true.

- **Raw Context** is source material before extraction: transcripts, emails, notes, meetings, CRM changes, docs, support/product signals, and agent inputs.
- **Signals** are inferred claims with evidence, confidence, source lineage, and readiness.
- **Memory** is confirmed operational customer context agents can rely on across sessions. Memory carries freshness and decay signals, so CRMy does not treat "customer truth" as permanent.
- **Product Knowledge** is approved product, pricing, security, implementation, and competitive context for customer-facing claims. It stays separate from customer Memory.
- **Briefings** answer: what should the agent know?
- **Action Context** answers: is this action ready, allowed, risky, stale, or review-required?
- **Handoffs and Writeback** keep approval, idempotency, audit, and execution receipts in the path when work touches a customer or system of record.

## Core Capabilities

| Capability | What it does |
|---|---|
| **Raw Context ingestion** | Accept messy notes, transcripts, emails, meetings, sync records, agent inputs, and custom source metadata. |
| **Transcript & notes drops** | Watch S3-compatible buckets or local self-hosted folders for transcripts/notes, match them to meetings or records, and keep unmatched files in review. |
| **Signals and Memory** | Extract inferred claims with evidence, then promote durable Memory only when readiness, policy, and source grounding allow it. |
| **Memory freshness and decay** | Track freshness, surface stale warnings, and keep old customer truth from silently becoming agent truth. |
| **Customer briefings** | Retrieve Current Memory, recent activity, open Handoffs, stale warnings, and unresolved Signals before analysis. |
| **Action Context** | Return readiness, policy, warnings, source authority, review requirements, and audit metadata before customer-facing or record-changing work. |
| **Product Knowledge** | When configured, retrieve approved, source-grounded product, pricing, implementation, security, and competitive claims without mixing global product truth into customer Memory. |
| **Handoffs and approvals** | Route uncertain, sensitive, or governed work to humans with evidence attached. |
| **Lineage and audit** | Trace source material into Signals, Memory, product knowledge retrievals, actions, reviews, writebacks, and receipts. |
| **Email and calendar context** | Connect actor mailboxes/calendars for customer communication, meeting context, availability-aware suggestions, and sender-aware email actions. |
| **Systems of record** | Configure CRM/warehouse sync and governed writeback through mappings, previews, approvals, and receipts. |
| **MCP, CLI, REST, UI** | Use the same engine from agent tools, scripts, integrations, and the web app. |

## Why Agents Work Better With CRMy

CRMy gives agents smaller, more trustworthy working context instead of a bigger prompt full of unverified customer data.

- It compresses noisy source material into Signals and Memory with source receipts.
- It returns confirmed Memory, unresolved Signals, stale warnings, and risky claims separately.
- It retrieves by action through `briefing_get` and `action_context_get` instead of dumping the customer database.
- It registers a small, job-focused tool working set per session (toolsets) instead of the full catalog, so the model picks from the right handful of tools.
- It supports `context_radius`, explicit `token_budget`, and budget profiles (`tiny`, `standard`, `deep`, `evidence_heavy`).
- It ranks high-value context first and reports when lower-priority entries were omitted.
- It uses `evidence_mode: "summary"` by default, with full Lineage and Raw Context available on demand.

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

### Focus the tool catalog per session

CRMy exposes a large tool catalog. Registering all of it on every session hurts tool-selection accuracy and wastes context, so you can narrow the working set to the job at hand with a **toolset**. Toolsets are chosen per connection, not baked into the API key, so the same key can open a `customer_outreach` session and a `systems_writeback` session and get the right tools for each.

```bash
# stdio (CLI): pick a toolset for this session
crmy mcp --toolset customer_outreach        # or: CRMY_MCP_TOOLSET=ops crmy mcp
```

```text
# HTTP MCP: per-connection query param or header
POST https://<your-crmy-host>/mcp?toolset=customer_outreach
X-CRMy-Toolset: customer_outreach
```

Selection only ever *narrows* what the actor's scopes already allow. It can never widen access, and per-call scope enforcement is unchanged. Autonomous agents default to a lean `standard` set; human and admin sessions default to `full`. Set `CRMY_MCP_DEFAULT_TOOLSET=full` to restore the full catalog everywhere. Call `tool_guide` to see available toolsets and the one that matches your workflow.

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
| **Customer Activity** | Meetings, notes, transcript drops, calendar context, review queues, and availability-aware meeting suggestions. |
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
- **Grounded promotion**: a Signal becomes Memory only when its evidence is actually present in the source, so model confidence alone never mints trusted context.
- **Governed writes**: mutating actions use idempotency, policy, approvals, and audit receipts.
- **Direct ingestion paths**: demo data, CLI, MCP, REST, and UI context input all exercise the same briefing, Action Context, and lineage engine.
- **Runtime-neutral**: the same engine serves MCP, REST, CLI, and the Web UI, so any agent runtime gets the same governed contracts.
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
CRMY_MIGRATION_MODE=validate
```

For production deploys, run `crmy migrate run` as a one-shot migration job before starting web/worker processes. Local installs keep automatic startup migrations by default.

Common timeout controls:

| Variable | Required | Purpose |
|---|---|---|
| `LLM_TIMEOUT_MS` | Optional | General Workspace Agent and background LLM timeout. Default: `60000`. |
| `AGENT_STREAM_TIMEOUT_MS` | Optional | Streaming Workspace Agent provider timeout. Default: `60000`. |
| `SOURCE_SYNC_FETCH_TIMEOUT_MS` | Optional | Mailbox/calendar/provider fetch timeout. Default: `30000`. |
| `CONNECTOR_FETCH_TIMEOUT_MS` | Optional | Systems-of-record connector fetch timeout. Default: `30000`. |
| `SLACK_SEND_TIMEOUT_MS` | Optional | Slack webhook delivery timeout. Default: `10000`. |

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

## Community And Contributing

- Join the [Discord](https://discord.gg/2HvmudDwE) for questions, examples, and implementation discussion.
- Open a GitHub issue for bugs, missing docs, confusing setup, or agent workflows CRMy should support.
- See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Share sanitized transcripts, notes, expected Signals, missed context, and false positives. Real agent workloads make CRMy sharper.

## Learn More

Docs:

- [Guide](docs/guide.md)
- [Context Engine](docs/context-engine.md)
- [MCP tools](docs/mcp-tools.md)
- [Agent recipes](docs/recipes/README.md)
- [Examples](examples/README.md)
- [0.8-1.0 roadmap](docs/roadmap-0.8-1.0.md)

Agent examples:

- [Claude Code account briefing example](examples/claude-code-account-briefing/README.md)
- [Claude Desktop account briefing example](examples/claude-desktop-account-briefing/README.md)
- [ChatGPT Developer Mode account briefing example](examples/chatgpt-developer-mode-account-briefing/README.md)
- [Codex account briefing example](examples/codex-account-briefing/README.md)
- [Hermes Agent account briefing example](examples/hermes-agent-account-briefing/README.md)
- [OpenClaw plugin account briefing example](examples/openclaw-plugin-account-briefing/README.md)

Recipes:

- [GTM agent demo](docs/recipes/gtm-agent-demo.md)
- [Post-meeting agent](docs/recipes/post-meeting-agent.md)
- [Pipeline review agent](docs/recipes/pipeline-review-agent.md)
- [Outreach agent](docs/recipes/outreach-agent.md)
- [Context governance agent](docs/recipes/context-governance-agent.md)
- [Renewal risk agent](docs/recipes/renewal-risk-agent.md)
- [Public signal research agent](docs/recipes/public-signal-research-agent.md)

## Release

Current version: `0.9.2`

Release notes live in [RELEASE_NOTES.md](RELEASE_NOTES.md). Older release notes live in [CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0
 
