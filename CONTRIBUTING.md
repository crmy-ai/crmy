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

### MCP tools

MCP tool definitions live in `packages/server/src/mcp/tools/`. Each tool file exports an array of `ToolDef` objects with the following shape:

- **`name`** -- unique tool identifier
- **`description`** -- human-readable description shown to the model
- **`inputSchema`** -- a Zod schema for input validation
- **`handler`** -- receives parsed input + `ActorContext` and returns a result object

### SQL migrations

Migrations live in `packages/server/migrations/` and are numbered sequentially. There is no ORM -- all queries use the `pg` Pool directly with raw SQL.

## Local development setup

```bash
git clone https://github.com/crmy-ai/crmy.git
cd crmy
npm install

# Start PostgreSQL locally or via Docker
docker compose -f docker/docker-compose.yml up db -d

# Run migrations
DATABASE_URL=postgresql://crmy:crmy@localhost:5432/crmy npx tsx scripts/migrate.ts

# Seed demo data
DATABASE_URL=postgresql://crmy:crmy@localhost:5432/crmy npx tsx scripts/seed-demo.ts

# Start the server
DATABASE_URL=postgresql://crmy:crmy@localhost:5432/crmy JWT_SECRET=dev-secret npm run dev --workspace=packages/server

# Connect Claude Code to local dev server
claude mcp add crmy -- npx @crmy/cli mcp
```

## Spec-driven development model

CRMy is built iteratively via versioned spec files passed to Claude Code (Opus). If you want to contribute a significant feature, please open a **Discussion** with a design proposal first so we can align on the approach before you invest time writing code.

## Good first contributions

1. **Add or improve an MCP tool description** (`packages/server/src/mcp/tools/`)
2. **Add a `context_type` or `activity_type`** to the registry seed data
3. **Improve error messages in the CLI** (`packages/cli/src/commands/`)
4. **Add a recipe** to `docs/recipes/`
5. **Report a bug** in the `briefing_get` response with a specific scenario

## Code conventions

- **Apache 2.0 SPDX headers on every file:**
  ```ts
  // SPDX-License-Identifier: Apache-2.0
  // Copyright 2026 CRMy.ai
  ```
- **Raw SQL (no ORM)** -- all queries use `pg` Pool directly
- **TypeScript strict mode**
- **Zod** for all input validation
- **Consistent tool definition pattern** in MCP tools (see the `ToolDef` shape above)

---
*Licensed under Apache 2.0. Copyright 2026 CRMy.ai*
