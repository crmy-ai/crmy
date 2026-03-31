# Contributing to CRMy

Thanks for your interest in contributing to CRMy! This guide will help you get oriented and start making changes.

## Architecture overview

CRMy is a TypeScript monorepo with the following packages:

| Package | npm name | Description |
|---------|----------|-------------|
| `packages/shared` | `@crmy/shared` | TypeScript types, Zod schemas |
| `packages/server` | `@crmy/server` | Express + PostgreSQL + MCP Streamable HTTP server |
| `packages/cli` | `@crmy/cli` | Local CLI + stdio MCP server |
| `packages/web` | `@crmy/web` | React SPA served at `/app` |
| `packages/openclaw-plugin` | `@crmy/openclaw-plugin` | Plugin for OpenClaw integration |

### MCP tools (111 total)

MCP tool definitions live in `packages/server/src/mcp/tools/`. Each tool file exports an array of `ToolDef` objects with the following shape:

- **`name`** — unique tool identifier
- **`description`** — human-readable description shown to the model (aim for 2–4 sentences covering: what the tool does, when to use it, what it returns)
- **`inputSchema`** — a Zod schema for input validation
- **`handler`** — receives parsed input + `ActorContext` and returns a result object

Tool files: `context-entries.ts`, `actors.ts`, `activities.ts`, `assignments.ts`, `hitl.ts`, `contacts.ts`, `accounts.ts`, `opportunities.ts`, `analytics.ts`, `use-cases.ts`, `registries.ts`, `notes.ts`, `workflows.ts`, `webhooks.ts`, `emails.ts`, `custom-fields.ts`, `meta.ts`

Tool ordering in the manifest (defined in `packages/server/src/mcp/server.ts`) matters — tools listed first are more likely to be selected by the LLM. Briefing and context tools come first.

### SQL migrations

Migrations live in `packages/server/migrations/` and are numbered sequentially (001–022+). There is no ORM — all queries use the `pg` Pool directly with raw SQL.

Migration 022 (`022_pgvector.sql`) is conditional — only runs when `ENABLE_PGVECTOR=true`.

### Web UI pages (18)

Pages live in `packages/web/src/pages/`. CRM drawer components live in `packages/web/src/components/crm/`. The app uses React Router, TanStack Query for data fetching, Zustand for state, and Tailwind CSS + Framer Motion for styling/animation.

### CLI commands (30+)

All commands live in `packages/cli/src/commands/` and are registered in `packages/cli/src/index.ts`. The CLI uses Commander.js for command parsing and Inquirer.js for interactive prompts.

## Requirements

- **Node.js >= 20.0.0** (enforced at runtime — the CLI will refuse to start on older versions)
- **PostgreSQL >= 14** (16 recommended; pgvector/pgvector:pg16 for semantic search)
- **npm >= 9**

## Local development setup

### Recommended: use `crmy init`

```bash
git clone https://github.com/crmy-ai/crmy.git
cd crmy
npm install
npm run build

# Start just the database if you don't have local Postgres
docker compose -f docker/docker-compose.yml up db -d

# Run the setup wizard — handles DB creation, migrations, admin account, demo data
npx @crmy/cli init

# Start the dev server
npx @crmy/cli server
```

### Alternative: manual setup

```bash
git clone https://github.com/crmy-ai/crmy.git
cd crmy
npm install
npm run build

# Start PostgreSQL via Docker
docker compose -f docker/docker-compose.yml up db -d

# Create the database (if it doesn't exist)
createdb -h localhost -U crmy crmy 2>/dev/null || true

# Run migrations
DATABASE_URL=postgresql://crmy:crmy@localhost:5432/crmy npx tsx scripts/migrate.ts

# Seed demo data
DATABASE_URL=postgresql://crmy:crmy@localhost:5432/crmy npx tsx scripts/seed-demo.ts

# Copy .env.example and configure
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET

# Start BOTH the API server and the web UI dev server
npm run dev
```

### How `npm run dev` works

`npm run dev` starts two processes in parallel:

| Process | Port | What it does |
|---------|------|-------------|
| API server (`dev:server`) | `:3000` | Express + MCP endpoint via `tsx watch` (hot reload on file changes) |
| Vite dev server (`dev:web`) | `:5173` | React app with hot module replacement, proxies `/api/*` and `/auth/*` to `:3000` |

The API server auto-loads `.env` from the repo root (or `packages/server/.env`). You can also pass env vars inline:
```bash
DATABASE_URL=postgresql://crmy:crmy@localhost:5432/crmy JWT_SECRET=dev-secret npm run dev
```

During development, open **http://localhost:5173/app** for the web UI (not `:3000/app`). Vite provides instant hot reload for frontend changes.

You can also run them individually:
```bash
npm run dev:server   # API only (port 3000)
npm run dev:web      # Web UI only (port 5173, needs API server running)
```

### Verify your setup

```bash
npx @crmy/cli doctor     # 8-point diagnostic check
npm run build             # verify TypeScript compiles cleanly
npm test                  # run test suite
```

### Connect Claude Code to local dev server

```bash
claude mcp add crmy -- npx @crmy/cli mcp
```

## Key commands for development

| Command | What it does |
|---------|-------------|
| `npm run build` | Build all packages (shared → server → cli → web → plugin) |
| `npm run dev` | Start API server + web UI with hot reload (requires `DATABASE_URL` + `JWT_SECRET`) |
| `npm run dev:server` | Start API server only (port 3000) |
| `npm run dev:web` | Start Vite web UI only (port 5173, proxies to :3000) |
| `npm test` | Run test suite (vitest) |
| `npm run lint` | TypeScript type checking (`tsc --noEmit`) |
| `npx @crmy/cli doctor` | Diagnose setup issues |
| `npx @crmy/cli seed-demo` | Seed demo data (idempotent) |
| `npx @crmy/cli seed-demo --reset` | Drop and re-seed demo data |
| `npx @crmy/cli migrate status` | Show applied vs pending migrations |

## Spec-driven development model

CRMy is built iteratively via versioned spec files passed to Claude Code (Opus). If you want to contribute a significant feature, please open a **Discussion** with a design proposal first so we can align on the approach before you invest time writing code.

## Good first contributions

1. **Add or improve an MCP tool description** (`packages/server/src/mcp/tools/`)
2. **Add a `context_type` or `activity_type`** to the registry seed data
3. **Improve error messages in the CLI** (`packages/cli/src/commands/`)
4. **Add a recipe** to `docs/recipes/` — follow the pattern in the existing 3 recipes
5. **Report a bug** in the `briefing_get` response with a specific scenario
6. **Add a web UI page** for a backend feature that lacks one
7. **Add a `crmy doctor` check** for something that catches new contributors off guard

## Code conventions

- **Apache 2.0 SPDX headers on every file:**
  ```ts
  // Copyright 2026 CRMy Contributors
  // SPDX-License-Identifier: Apache-2.0
  ```
- **Raw SQL (no ORM)** — all queries use `pg` Pool directly
- **TypeScript strict mode**
- **Zod** for all input validation
- **Consistent tool definition pattern** in MCP tools (see the `ToolDef` shape above)
- **Stable UUIDs for demo data** — pattern `d0000000-0000-4000-XXXX-NNNNNNNNNNNN` where the 4th group encodes entity type (`a`=actors, `b`=accounts, `c`=contacts, `d`=opportunities)
- **Idempotent seeds** — always use `INSERT ... ON CONFLICT (id) DO NOTHING`

## Project structure

```
crmy/
├── packages/
│   ├── shared/          TypeScript types + Zod schemas
│   ├── server/
│   │   ├── src/
│   │   │   ├── mcp/tools/     111 MCP tool definitions (18 files)
│   │   │   ├── rest/          REST API router
│   │   │   ├── db/            Pool, migrations, repositories
│   │   │   ├── auth/          JWT + API key auth
│   │   │   ├── agent/         AI extraction pipeline
│   │   │   ├── workflows/     Event-driven automation engine
│   │   │   └── index.ts       Server entry point + createApp()
│   │   └── migrations/        22+ SQL migration files
│   ├── cli/
│   │   └── src/commands/      30+ CLI commands (init, server, doctor, etc.)
│   └── web/
│       └── src/
│           ├── pages/         18 page components
│           ├── components/crm/ 19 drawer/panel components
│           └── api/hooks.ts   TanStack Query hooks
├── docker/                    Dockerfile + docker-compose.yml
├── docs/recipes/              3 agent tutorial walkthroughs
├── scripts/                   Seed + migration scripts
├── railway.toml               Railway deploy template
├── render.yaml                Render.com deploy blueprint
├── .env.example               Environment variable reference
└── CONTRIBUTING.md            This file
```

---
*Licensed under Apache 2.0. Copyright 2026 CRMy.ai*
