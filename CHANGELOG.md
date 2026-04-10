# Changelog

All notable changes to CRMy are documented here.

---

## [0.7.0] — 2026-04-09

### Highlights

Context import is the core value of CRMy. This release eliminates every friction point: paste text, drop a file, or let the workspace agent handle it automatically. The entity memory graph is rebuilt from scratch as an Obsidian-style dark canvas. And a broad wave of UI polish makes the day-to-day experience sharper throughout.

---

### Context Engine — zero-friction ingestion

#### Auto-subject detection
The import dialog no longer requires manual subject selection. After pasting text, CRMy runs the 6-tier entity resolution service across all capitalized proper nouns and email addresses found in the body. Detected subjects appear as colored chips (green = high confidence, blue = medium) below the textarea. Users can confirm, remove, or override suggestions before submitting.

- Backend route: `POST /api/v1/context/detect-subjects`
- Debounced 600ms after the last keystroke
- Candidate cap of 15 entities prevents N+1 overload on large documents

#### File upload
A new **Upload File** tab in the import dialog accepts PDF, DOCX, TXT, and Markdown files via drag-and-drop or click-to-browse. Text is extracted server-side:

| Format | Library |
|---|---|
| `.pdf` | `pdf-parse` (dynamic import with CJS/ESM interop) |
| `.docx` | `mammoth` — `extractRawText()` |
| `.txt` / `.md` / `.csv` | direct UTF-8 decode |

The extracted text preview (first 500 chars) is shown before confirming, with a truncation warning when the document exceeds 120,000 characters. Subjects are detected automatically from the extracted content.

- Backend route: `POST /api/v1/context/ingest-file`
- New utility: `packages/server/src/lib/file-extract.ts`

#### Smart clipboard paste
When the import dialog opens with an empty body, `navigator.clipboard.readText()` is called. If the clipboard contains more than 100 characters, a banner offers to pre-fill the body and immediately trigger subject detection. Gracefully skipped if the clipboard permission is denied.

#### `context_ingest_auto` MCP tool
A new MCP tool for agent and CLI workflows that resolves entity subjects from document text automatically — no subject IDs required.

```
context_ingest_auto {
  document: "<meeting transcript or email body>",
  source_label: "Discovery call 2026-04-09",   // optional
  context_type: "transcript",                   // optional override
  confidence_threshold: 0.6                     // default; lower = more links
}
→ {
    subjects_resolved: [{ type, id, name, match_tier }],
    entries_created: 3,
    low_confidence_skipped: ["Generic Corp"]
  }
```

The tool extracts candidates via regex, filters a stop-word list, resolves each name with `entityResolve()`, creates an activity record, and runs `extractContextFromActivity()` per resolved subject.

- File: `packages/server/src/mcp/tools/context-entries.ts`

#### Auto-extract from activities (`auto_extract_context`)
A new capability flag in **Settings → Local AI Agent** controls whether the extraction pipeline runs automatically on every new activity. When disabled, activities are marked `skipped` and no context entries are written — useful for cost control or explicit-only workflows via `context_ingest_auto`.

- Database migration: `028_auto_extract_context.sql`
- Default: `true` (extraction enabled)
- Checked in `triggerExtraction()` before the pipeline runs

---

### Memory Graph — full redesign

The entity memory graph (`/contacts/:id/graph`, `/accounts/:id/graph`) is rebuilt as an Obsidian-style dark canvas powered by `@xyflow/react`.

**Node types**:

| Type | Color | Description |
|---|---|---|
| `subject` | Purple | The focal entity (contact or account) |
| `context` | Teal | Individual context entries |
| `account` | Blue | Linked account records |
| `contact` | Green | Linked contact records |
| `activity` | Orange | Recent activity log entries |
| `assignment` | Yellow | Open assignments |

**Layout**: 5-zone concentric radial arrangement — related records on the right arc, context clusters on the left, leaf entries orbiting their cluster, activities and assignments in the lower arcs.

**Sidebar filter panel**: toggle each node category on/off independently; hidden nodes are fully removed from the canvas, not just faded.

**Node detail Sheet**: clicking any node opens a Radix UI Sheet drawer from the right with full entry details — body text, tags, confidence score, type badge, and a link to the full record.

**MiniMap**: top-right, functional, shows colored nodes for spatial orientation. Explicit `width`/`height` on nodes ensures visibility in the minimap.

---

### UI polish

- **Accounts list** — removed the initials circle avatar; accounts are companies, not people (mirrors the Opportunities page style)
- **Context page** — keyword / semantic search toggle moved inline with the search bar, removed the confusing description bar below
- **Dashboard** — Overview / Knowledge tab toggle moved from the header into the page body, below the stat cards
- **BriefingPanel** — larger fonts, semantically colored activity-type icons, activity count pill on the activities section header
- **ContextPanel** — larger fonts and more readable entry cards throughout
- **Left nav** — fixed horizontal scroll overflow when the sidebar is collapsed

---

### Breaking changes

None. All changes are additive. The `auto_extract_context` column is added with `DEFAULT TRUE` so existing agent configs preserve prior behavior.

---

### Migration

```bash
crmy migrate   # applies 028_auto_extract_context.sql
```

---

### Dependencies added

| Package | Purpose |
|---|---|
| `pdf-parse` | Server-side PDF text extraction |
| `mammoth` | Server-side DOCX text extraction |
| `@xyflow/react` | Memory Graph canvas (ReactFlow v12) |

---

## [0.6.0] — 2026-02-15

### Highlights

Developer experience overhaul: `crmy init` wizard, `crmy doctor` diagnostics, Railway/Render one-click deploy, and 175+ MCP tools with rewritten LLM-optimized descriptions.

### Developer experience
- **`crmy init` wizard** — auto-creates database, offers pgvector opt-in, seeds demo data, shows API key
- **`crmy init --yes`** — fully non-interactive setup for CI/Docker
- **`crmy doctor`** — 8-point diagnostic (Node version, DB, migrations, users, pgvector, port, JWT)
- **`crmy seed-demo`** — rich demo data with stable UUIDs (3 accounts, 6 contacts, 3 opportunities, 10 activities, 12 context entries, 3 assignments)
- **Per-migration progress** — spinner updates per file during migrations
- **Node.js version gate** — clear error on Node < 20 instead of cryptic ESM failures

### MCP tools
- **175+ tools** with rewritten descriptions optimized for LLM tool selection
- **Tool ordering** — briefing and context tools first in manifest, signaling priority to agents
- **`context_semantic_search`** — pgvector cosine similarity search
- **`context_embed_backfill`** — back-fill embeddings for existing entries
- **Multi-channel messaging** — `message_channel_create`, `message_send`, `message_delivery_get` with Slack built-in, extensible via plugins
- **`guide_search`** — lets the agent look up CRMy documentation to answer user questions

### Web UI
- **18 pages** — Dashboard, Contacts, Accounts, Opportunities, Use Cases, Activities, Context, Assignments, Agents, HITL, Workflows, Emails, Settings, and more
- **19 drawer/panel components** — inline detail views for every entity type
- **Command palette** (`⌘K`) — cross-entity search and quick navigation
- **Settings → Registries** — manage custom context and activity types

### Self-hosting
- **Railway one-click deploy** — `railway.toml` template
- **Render.com blueprint** — `render.yaml` with auto-provisioned DB and JWT secret
- **Docker Compose** — pgvector-ready Postgres, health checks, env var configuration
- **JWT secret enforcement** — server rejects known-bad secrets in production

### Documentation
- **3 agent recipe tutorials** with full MCP tool call sequences
- **CONTRIBUTING.md** — architecture overview, local dev setup, conventions
- **`.env.example`** — comprehensive reference for all environment variables

---

## [0.5.0] and earlier

See git history (`git log --oneline`) for changes prior to v0.6.
