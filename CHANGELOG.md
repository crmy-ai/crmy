# Changelog

All notable changes to CRMy are documented here.

---

## [0.7.0] — 2026-04-25

### Highlights

Enterprise hardening across two critical subsystems: the context/memory pipeline and the automation engine. No breaking changes — all changes are additive or correctness fixes. This release makes CRMy production-ready for multi-agent, high-volume deployments with dependable extraction, reliable automation execution, and fully closed HITL loops.

---

### Context & Memory Engine — Resilience and Performance

#### Concurrent extraction pipeline
`processPendingExtractions` now runs all pending activity extractions concurrently via `Promise.allSettled`. Previously, 20 activities processed serially took ~100 seconds. Concurrently they complete in ~10 seconds. Failed extractions no longer block subsequent ones.

#### LLM fetch timeout guard
All LLM provider calls now use an `AbortController` with a 30-second hard timeout (configurable via `LLM_TIMEOUT_MS`). Previously a hung provider connection would block an extraction worker indefinitely.

#### Orphaned extraction guard
The extraction pipeline now validates that an activity has both `subject_type` and `subject_id` before writing context entries. Previously, activities with no subject silently created orphaned entries using `activity.id` as the subject — corrupting the context index.

#### SQL injection fix in `reviewContextEntry`
The `extend_days` parameter in context entry review was previously interpolated directly into a SQL string (`interval '${n} days'`). It is now fully parameterized (`$3 * INTERVAL '1 day'`).

#### Token budget visibility — `dropped_entries`
The briefing response now includes a `dropped_entries` summary field when the token budget is exhausted. Agents can now see exactly what context was deprioritized and why — enabling follow-up queries for the dropped content.

#### New DB indexes — migration 042
Six new PostgreSQL indexes targeting the most common query patterns:

| Index | Purpose |
|---|---|
| `idx_context_subject_tenant` | Primary briefing lookup — tenant + subject + currency + time |
| `idx_context_tenant_current` | Semantic search pre-filter (partial index on `is_current = true`) |
| `idx_context_fts_tenant` | Full-text search tenant scoping |
| `idx_context_source_activity` | Source activity lookup (partial index, non-null only) |
| `idx_context_authored_by` | Entries by actor (partial index, non-null only) |
| `idx_activities_extraction_pending` | Extraction backlog polling (partial index on `extraction_status = 'pending'`) |

#### New MCP tools — bulk context operations

**`context_review_batch`** — Mark up to 200 context entries as reviewed in a single call. Processes in batches of 20 with `Promise.allSettled`. Returns `{ updated, not_found, extend_days }`.

**`context_bulk_mark_stale`** — Invalidate up to 200 entries in a single parameterized `UPDATE`. Optionally appends a reason tag. Returns `{ updated, not_found_or_already_stale, reason }`.

These tools enable agents to efficiently batch-review stale context queues instead of making 200 individual `context_review` calls.

#### N+1 query elimination in briefing
The `account_wide` context radius now uses a single `UNION ALL` query to gather all contacts and opportunities for an account, replacing two separate repository calls.

#### Actor subquery optimization in semantic search
Semantic search results now use a single `LEFT JOIN actors` instead of two correlated subqueries per row for `authored_by_name` and `authored_by_type`.

#### Activity `sinceDate` filter pushed to SQL
The `sinceDate` filter in briefing timeline queries is now applied in the SQL `WHERE` clause instead of filtering a full result set in JavaScript. Reduces data transfer for briefings with many historical activities.

---

### Automation Engine — Enterprise Hardening

#### HITL auto-resume for paused sequence enrollments
Previously, approving a HITL request for a sequence email step left the enrollment paused permanently. Now, when a HITL request with `action_type = 'sequence.step.send'` is resolved:
- **Approved** → sends the pending email, marks the step `sent`, advances `current_step`, computes `next_send_at`, sets enrollment back to `active`
- **Declined** → marks the step `skipped`, advances to the next step, sets enrollment back to `active`

#### Workflow trigger deduplication
Workflow runs are now deduplicated by `event_id`. If the same event fires multiple times (burst), only the first run is created. Manual triggers support an optional `idempotency_key`.

#### Repeated workflow failure alerts
After a configurable threshold of consecutive failures (default: 3, set via `WORKFLOW_FAILURE_ALERT_THRESHOLD`), CRMy creates an urgent `workflow.repeated_failure` HITL request in the Handoffs queue. Humans are notified via the existing Handoffs UI without requiring a new notification system.

#### New DB indexes — migrations 040 and 041
- `seq_enrollments_due_idx` — sequence executor polls this table every 60s; without this index it was a full table scan at scale
- `seq_enrollments_tenant_status_idx` — enrollment listing by tenant
- `workflow_runs_tenant_time_idx` — run history listing
- `sequences_tenant_active_idx` — active-only sequence queries
- `workflow_runs_event_idx` — deduplication event_id lookup (partial, non-null only)

#### Workflow template library — `workflow_template_list` MCP tool
Eight static GTM workflow templates, selectable via the new `workflow_template_list` MCP tool or the "From template" picker in the workflow editor:

| Template | Trigger | Actions |
|---|---|---|
| Lead Qualification | `contact.created` | context_entry + assign_owner + notify |
| Deal Won | `opportunity.stage_changed` → Closed Won | notify + activity |
| Churn Risk Alert | `use_case.health_changed` → at-risk | HITL checkpoint + notify |
| Email Engaged | `email.opened` | add_tag + enroll_sequence |
| Inbound Reply | `email.replied` | update_lifecycle + activity + notify |
| Assignment Overdue | `assignment.overdue` | notify + escalate (HITL) |
| ICP Outreach | `contact.created` + ICP filter | context_entry + enroll_sequence |
| Opportunity Stalled | `opportunity.no_activity` | notify + HITL checkpoint |

#### Editor crash isolation
A React error boundary (`EditorErrorBoundary`) now wraps the action list in WorkflowEditor and the step list in SequenceEditor. A crash in a nested component (e.g. a misconfigured ActionCard) renders an inline recovery UI instead of closing the entire dialog.

#### Variable syntax validation
Saving a workflow or sequence with unclosed `{{variable` references now fails client-side with a field-level error, preventing runtime failures from malformed variable tokens.

#### Manual trigger payload validation
`POST /workflows/:id/trigger` now validates the request body with Zod before passing it to the execution engine. Malformed payloads return a 400 with structured error details instead of cryptic engine errors.

---

### Web UI Improvements

#### ContextBrowser — Add Entry modal
A new **Add** button (secondary, alongside the existing Import button) opens a form dialog for manually crafting a context entry. Fields: subject (type + entity picker), context type, title, body, confidence (0–1), tags (comma-separated, auto-cleaned), source, and expiry date. Uses the same `POST /context` endpoint as the MCP `context_add` tool.

#### ContextBrowser — Semantic search fallback toast
When pgvector is unavailable and the user switches to semantic mode, a destructive toast notification fires once (deduped via ref) in addition to the existing inline banner. Both the transient toast and the persistent banner ensure the fallback is noticed.

#### ContextBrowser — File size validation
A 15 MB client-side guard prevents sending oversized uploads. Previously, large files would be sent to the API and fail with a generic error.

#### ContextPanel — Error state
The context panel now renders an `AlertTriangle` error card when the context fetch fails. Previously it silently returned `null`, giving users no feedback that context was unavailable.

#### Command palette — Automation actions
The `⌘K` command palette now includes:
- **New Trigger** — opens the WorkflowEditor in create mode
- **New Sequence** — opens the SequenceEditor in create mode  
- **Go to Automations** — navigates to the Automations page
- **Search results** from existing workflows and sequences by name

#### HITL — Sequence step preview
HITL cards for `action_type = 'sequence.step.send'` now show a rich preview instead of raw JSON:
- Full email envelope (subject, from, to)
- Body preview
- Enrollment progress (steps sent, current step, steps remaining)
- **Approve & Send** / **Decline & Skip** buttons with distinct styling

#### Sequences — Enrollment status visibility
The enrollment tab now includes:
- Skeleton loading state during fetch
- Status filter tabs: All / Active / Paused / Completed
- "Waiting for approval" chip + **Resume** button for paused enrollments
- `exit_reason` label for cancelled enrollments

#### Workflows — Action log drill-down
Each run in the Runs tab can be expanded to show per-action detail: action type, status, duration in ms, resolved config, and inline error message for failed steps. No backend change required — `action_logs` was already returned by the API.

---

### Breaking changes

None. All database changes use `ADD COLUMN IF NOT EXISTS` or new tables. New columns have defaults that preserve existing behavior.

---

### Migrations

```bash
crmy migrate   # applies 040, 041, 042
```

---

### Environment variables added

| Variable | Default | Description |
|---|---|---|
| `LLM_TIMEOUT_MS` | `30000` | Hard timeout for LLM extraction calls (AbortController) |
| `WORKFLOW_FAILURE_ALERT_THRESHOLD` | `3` | Consecutive failures before a HITL escalation is created |

---

## [0.6.2] — 2026-04-09

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
