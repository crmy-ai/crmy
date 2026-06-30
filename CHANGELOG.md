# Changelog

All notable changes to CRMy are documented here.

---

## [Unreleased]

No unreleased changes yet.

---

## [0.9.5] - 2026-06-29

### Added

- Added eval-driven model certification through `crmy certify`, with certification writes allowed only from passing `live_model` eval evidence or recorded CRMy pre-certification provenance.
- Added a deterministic high-impact Tier-2 auto-promotion eval gate in the `seeded_context` profile, including `high_impact_autopromote_false_allow = 0`.
- Added guided first-run certification copy and review-only fallback for uncertified models, while pre-certified exact model/provider matches restore recorded certification automatically.
- Added tenant-tunable Memory tier and freshness controls, versioned Action Context response metadata, and deterministic connector-parity coverage.

### Changed

- Made automatic Memory the recommended safe path for pre-certified models while keeping uncertified/local models in review-only mode until certification passes.
- Tightened Knowledge, Signals, Memory, Handoffs, Meeting Sources, Settings, Overview, and login UI consistency for the 0.9.5 backend workflows.
- Reframed docs around provenance-checked, decay-aware governance instead of "truth layer" or knowledge-graph claims.
- Moved Automations under Settings -> Experimental -> Automations and kept Sequences/Automations outside the default Core Profile path.
- Updated package, OpenAPI, README, guide, release-note, and packaged web asset metadata for 0.9.5.

---

## [0.9.4] - 2026-06-28

### Changed

- Tightened production trust boundaries with same-origin browser cookie mutation checks, scoped admin connector/model settings, safer file-ingest defaults, and private-network protection for MCP Knowledge connectors.
- Included Trusted Facts in AI briefing summaries when configured, so compact agent-facing summaries stay aligned with governed briefings.
- Added Memory freshness indexes and blocked production manual model certification from Settings.
- Marked Automations and Sequences as experimental admin surfaces instead of default product paths.
- Labeled contact detail scoring as Lead score to avoid confusion with account or deal health.
- Updated package, OpenAPI, README, guide, and release-note metadata for 0.9.4.

---

## [0.9.3] — 2026-06-26

### Added

- **Local eval harness + production-path extraction quality eval** ([#29](https://github.com/crmy-ai/crmy/pull/29)) — makes extraction quality measurable across datasets and models, the foundation for capability-gated promotion.
- **Per-session MCP toolsets** ([#30](https://github.com/crmy-ai/crmy/pull/30)) — narrow the registered tool catalog per session/job via `--toolset`, `?toolset=`, or the `X-CRMy-Toolset` header. Selection never widens scope; autonomous agents default to a lean `standard` set, humans/admins to `full`. Override with `CRMY_MCP_DEFAULT_TOOLSET`.
- **Connector-free `crmy quickstart`** ([#32](https://github.com/crmy-ai/crmy/pull/32)) — one command seeds demo context and runs the connector-free golden path (resolve -> briefing -> Action Context -> lineage) with onboarding next steps.
- **Governed Knowledge Retrieval — Phase 1** — `knowledge_retrieve` MCP tool + `KnowledgeRetrievalService` contract and `knowledge` toolset. Optional and non-blocking: returns a clear `not_configured` until Trusted Facts exist; never creates Memory or writes to systems of record.
- **Governed Knowledge Retrieval — Phase 2** — Trusted Fact store + governed retrieval: `knowledge_claims` / `knowledge_retrieval_receipts` (migration 086), policy filtering (customer-facing requires approved + source-grounded + external + fresh; internal labels risk in warnings), lexical search, ranking, and durable retrieval receipts. Adds the admin `knowledge_claim_upsert` tool (grounding verified against `source_text`) and the `POST /api/v1/knowledge/retrieve` REST endpoint.
- **Governed Knowledge Retrieval — Phase 3** — briefings and Action Context now surface relevant Trusted Facts as a `knowledge` sibling to customer Memory. `include_knowledge` defaults to true when Trusted Facts are configured (override per call); it is strictly additive and never fails the core response. Action Context adds an informational `knowledge` check plus `used_knowledge_snippet_ids` / `knowledge_retrieval_receipt_ids` proof, reusing the existing `checks`/`proof` slots.
- **Governed Knowledge Retrieval — Phase 4** — `email_draft_preview` grounds customer-facing drafts in approved, cited Trusted Facts (and is instructed to avoid excluded ones). The draft records `used_knowledge_snippet_ids`, `knowledge_retrieval_receipt_ids`, and `knowledge_citations` in `model_metadata`, surfaces a `context_used.knowledge` summary, and warns when facts were excluded as not customer-safe.
- **Governed Knowledge Retrieval — Phase 5** — `crmy knowledge retrieve` CLI command, plus web display: a **Trusted Facts** section in the briefing panel (approved facts, sources, exclusions, warnings) and a Trusted Fact indicator on generated email drafts.
- **Governed Knowledge Retrieval — Phase 6** — freshness windows mark expired or aging Trusted Facts stale without blocking core customer-context flows.
- **Governed Knowledge Retrieval — Phase 7** — admin governance for Trusted Fact review, approval/rejection/deprecation/staleness/reactivation, conflict detection, source-priority resolution, review assignments, and the Knowledge workspace/settings surface.
- **Provider certification checklist** — added a repeatable Google/Microsoft live-provider checklist for mailbox context, sender/drafts, calendar sync, free/busy, reply matching, failure handling, and app-source coverage before production claims.
- **Transcript drop fixture** — added a synthetic Northstar transcript + sidecar fixture for local-folder and S3-compatible transcript source smoke testing.

### Changed

- **Source-grounding gate for Memory auto-promotion** ([#31](https://github.com/crmy-ai/crmy/pull/31)) — a Signal only auto-promotes to Memory when at least one evidence snippet is present in the source, so a weak model cannot silently mint Memory from a hallucinated claim. On by default; disable with `CRMY_REQUIRE_GROUNDED_AUTOPROMOTE=0`.
- **Admin pagination hardening** — admin actor and user lists now use stable timestamp-plus-id cursors, including pending-review sort rank for actors, so timestamp ties cannot skip or duplicate rows.
- **First-run setup trust** — `crmy init` masks database credentials when printing non-interactive setup status.
- **Settings performance** — heavy Settings subsections are lazy-loaded, reducing the main Settings route chunk from roughly 503 kB to roughly 222 kB in the production build.
- **Background worker reliability** — fixed advisory-lock release parameter binding and made missing-schema background failures point operators to `crmy migrate run`.

---

## [0.9.2] — 2026-06-23

### Release Focus

0.9.2 is the transcript ingestion, scale, and production hardening release. It expands CRMy beyond mailbox and calendar context with admin-managed transcript/raw-note drops, then tightens the runtime path for higher-volume, hosted, and agent-first deployments.

### Highlights

- **Transcript and note drops**: added admin-managed Context Source Drops for S3-compatible buckets and local self-hosted folders, with source-object tracking, content hashes, size limits, match state, processing state, review status, and linked records.
- **Transcript parsing and matching**: added ingestion support for `.txt`, `.md`, `.vtt`, `.srt`, `.json`, `.docx`, and `.pdf`, with matching through sidecar metadata, provider calendar identifiers, meeting time plus attendee overlap, contact/account domains, and Subject Graph resolution.
- **Source pipeline integration**: transcript drops feed the same Source Object -> Meeting Artifact / Customer Activity -> Sources -> Signals -> Memory -> Lineage / Handoff path as other customer context sources.
- **Reviewable failure modes**: oversized, unmatched, ambiguous, and failed transcript files remain visible in review/Handoff flows instead of being silently skipped.
- **Production runtime hardening**: added PostgreSQL-backed unauthenticated auth throttling, production database TLS guardrails, migration startup modes, process roles, worker advisory-lock fixes, and durable outbound webhook backlog processing.
- **Scale and retrieval**: added stable timestamp-plus-id cursor pagination and estimated totals across high-volume list surfaces, plus token budget profiles, ranked retrieval, and evidence-on-demand behavior.
- **Agent and CLI parity**: added MCP, REST/OpenAPI, UI, and CLI surfaces for transcript source connection/object list, create, sync, resolve, reprocess, and ignore workflows.
- **Dependency security**: upgraded production mail/form dependencies to clear high-severity audit findings and kept the production moderate audit clean.

### Notes

Live external-provider certification remains environment-dependent. Local folder transcript drops are intended for local/self-hosted installs unless explicitly enabled in production. Hosted multi-instance deployments should use separate `web`, `worker`, and migration jobs with sticky MCP routing as documented.

---

## [0.9.1] — 2026-06-15

### Release Focus

0.9.1 is the email context workflow release. It makes customer email easier to connect, easier to trust, easier to send from the right identity, and easier for agents to follow from source message to Sources, Signals, Memory, activity, approval, and reply.

### Highlights

- **Email workflow clarity**: split Customer Email into clearer Mailbox Context and Outbound Actions surfaces for customer-message ingestion, governed drafts, approvals, provider drafts, and sends.
- **Sender identity model**: connected mailboxes now carry context-sync, send, provider-draft, default-sender, and status fields, while drafts and sends persist `from_email`, `from_name`, `sender_type`, and `mailbox_connection_id`.
- **Actor mailbox preference**: outbound sends prefer the actor's send-enabled mailbox, then tenant fallback provider, and fall back to save-draft-only behavior when no sender exists.
- **Rejected draft recovery**: rejected outbound emails remain discoverable, show reviewer context, block direct send, and can be revised in place for approval resubmission.
- **Sent email as context**: sent email is recorded as account activity and becomes CRMy-authored context without treating CRMy's own words as customer-authored evidence.
- **Mailbox/calendar OAuth setup**: System Connections separates provider OAuth setup from personal mailbox/calendar connection, with hosted CRMy-managed app support and enterprise tenant-owned OAuth app support.
- **Actor connection controls**: admins can inspect mailbox, sender, and calendar coverage from Actor settings, while users can deactivate or disconnect their own mailbox/calendar from Customer Email and Customer Activity.
- **Agent-facing email tools**: MCP and CLI flows can start mailbox/calendar OAuth by returning a browser auth URL, and email tools expose selected sender metadata and governed delivery behavior.
- **Token and retrieval controls**: added stable cursor pagination for high-volume context surfaces and token budget/evidence controls for briefings and Action Context.

### Notes

Tenant shared sender settings remain fallback/shared/system delivery, not the user's personal mailbox. Live Gmail, Outlook, Google Calendar, and Microsoft Calendar flows should be certified in the target provider tenant before production claims.

---

## [0.9.0] — 2026-06-10

### Release Focus

0.9.0 is the agent reliability and polish release. It hardens durable workspace agent execution, richer email and inbox surfaces, admin/object UX, and the core guarantee that agents can retrieve what is true, stale, inferred, approved, risky, and safe to do next before acting.

### Highlights

- **Durable workspace agent execution**: hardened agent turns against partial tool execution, replay-unsafe side effects, stale turn state, and accidental double-execution on retry.
- **Scoped record writes**: record-write tool exposure now requires explicit write permission scopes so agents cannot modify records outside their authority.
- **Email and inbox surfaces**: rebuilt email drawer and inbox flows with full message thread view, context add, draft preview/save, message linking, ignore flows, and provider-level mailbox endpoints.
- **Action Policy and HITL UX**: redesigned condition editing, HITL rules setup, pending writeback visibility, and approval/rejection flows.
- **Context Lineage and governance**: simplified Lineage around source -> Signal -> Memory while keeping usage and audit detail available on demand.
- **Object and drawer polish**: improved Accounts, Contacts, Opportunities, and Use Cases with consistent action bars, field editing, lifecycle controls, activity, timeline, and briefing navigation.
- **Settings and systems of record**: redesigned Messaging and Systems of Record settings for clearer setup, connection state, sync status, and admin guidance.
- **CLI and server startup**: improved migration/startup feedback, friendly CLI errors, `agent-smoke`, and tenant-safe search indexing.

### Notes

pgvector remains optional. Semantic search improves retrieval when configured, but lexical and deterministic paths continue to work without it. Live connector certification remains environment-dependent.

---

## [0.8.7] — 2026-06-06

### Release Focus

0.8.7 is a same-day launch-hardening patch for 0.8.6. It includes the 0.8.6 MCP/API/CLI and recipe alignment work, then adds stronger auth, scope, webhook, migration, and governed writeback safeguards.

### Highlights

- **Auth and scope hardening**: JWT users resolve against current database user/actor state, deactivated users/actors are rejected, missing scopes no longer imply broad access, and admin-only scopes cover API keys, HITL policies, inbound email config, and systems administration.
- **API key governance**: only owner/admin actors with `api_keys:admin` can create/list/update/revoke keys, and requested scopes must be known and within the grantor's own authority.
- **HITL and webhook safety**: `/hitl/rules` routes before `/hitl/:id`, HITL rules require `hitl:admin`, inbound webhook secret config requires `email_provider:admin`, and inbound email ingestion requires explicit tenant identity plus a valid HMAC signature.
- **Writeback safety**: pending writebacks can no longer execute before approval, and HITL/writeback review state updates are transactional.
- **Migration reliability**: migrations now use a connection-scoped PostgreSQL advisory lock.
- **MCP/API/CLI parity**: actor-scoped REST and CLI tool listing, description, and invocation remain part of this package line.
- **Recipes and harnesses**: recipes/examples continue to use friendly record references, `agent-smoke`, `tools describe`, and Source ingestion guidance.

### Notes

This is not the 0.9 release. It is a launch-hardening patch on the 0.8.x line.

---

## [0.8.6] — 2026-06-05

### Release Focus

0.8.6 is a follow-up 0.8.x hardening release focused on proving CRMy from external agent harnesses. It improves MCP/API/CLI parity, refreshes recipes and examples, and aligns OpenClaw support with the current Sources -> Signals -> Memory model.

### Highlights

- **MCP/API/CLI parity**: added actor-scoped REST endpoints for listing, describing, and calling MCP tools, plus `crmy tools list`, `crmy tools describe`, and `crmy tools call`.
- **Tool-surface coverage**: CLI coverage now verifies direct HTTP mappings, generic actor-scoped tool fallback, and the one-minute `agent-smoke` path.
- **Recipe cleanup**: added a recipes index, clarified seeded Northstar demo data, and updated runnable CLI examples to prefer friendly record references over UUIDs.
- **Source guidance**: recipes now steer messy transcripts, emails, notes, research, and debriefs through `context_ingest_auto`, keeping direct `context_add` for advanced reviewed writes.
- **OpenClaw support**: the OpenClaw plugin now exposes `context.ingest_auto`, and its skill guidance uses accounts terminology plus the current Signal/Memory/Handoff model.
- **Docs alignment**: README, guide, MCP docs, OpenAPI, roadmap, examples, and release notes now describe the same MCP/API/CLI and Action Context behavior.

### Notes

This is not the 0.9 release. It is the next 0.8.x package release on the path to 0.9.

---

## [0.8.5] — 2026-05-31

### Release Focus

0.8.5 is the first major hardening checkpoint on the way to 0.9. It tightens CRMy’s core loop without broadening the product surface: Source reliability, account-scoped record resolution, scoped agent/MCP setup, surface cleanup, web performance, and release readiness.

### Highlights

- **Source reliability**: durable receipts, retry metadata, replayable payloads, stale-processing recovery, and consistent app/REST/MCP/CLI ingestion semantics are now documented and covered.
- **Golden corpus coverage**: extraction and record-resolution tests now cover account-scoped child records, duplicate names, malformed JSON, no-context inputs, proposed records, custom registries, and conservative auto-promotion.
- **Duplicate corroboration safety**: repeated ingestion of the same source no longer creates extra independent evidence or artificially validates Signals.
- **Subject Graph alignment**: Source ingestion, reprocess, file ingestion, Customer Email, Customer Activity, CLI, MCP, and agent guidance now share one primary customer-record resolver model.
- **Surface cleanup**: Context focuses on Sources, Signals, Memory, Lineage, and Context Sources; Email and Activity are supporting sources; Automations/Sequences are moved into admin settings while compatible routes remain.
- **MCP/CLI setup confidence**: `agent-smoke` verifies `customer_record_resolve -> briefing_get -> context_signal_group_list`, and `doctor` now catches stale or mismatched `CRMY_API_KEY` values before agent harness setup fails.
- **Web performance**: major routes, drawers, and editors are lazy-loaded, dropping the initial web bundle below Vite’s warning threshold.
- **UX consistency**: lingering Signal action labels now use the user-facing `Confirm Signal` / `Dismiss Signal` language.
- **Release readiness**: OpenAPI, roadmap, release notes, packaged web assets, and npm dry-run package sizes are aligned for the 0.8.5 bump.

### Notes

The 0.8.5 gate verifies correctness, drift, packaging, and local install-to-value. It does not claim full 1.0-scale latency budgets or live certification for every external provider.

---

## [0.8.3] — 2026-05-29

### Release Focus

0.8.3 is a hardening and clarity release for CRMy as the operational customer context and action layer for GTM agents. It tightens the app, MCP/CLI surface, docs, examples, scoped access, context extraction, Signal review, Handoffs, Customer Email, Customer Activity, Systems of Record setup, and Workspace Agent flows.

### Highlights

- **Clearer product promise**: README and guide language now explain CRMy around typed operational Memory, Active Context, Sources, Signals, Handoffs, and governed writeback.
- **Agent harness examples**: added or refreshed examples for Claude Code, Claude Desktop, Codex, ChatGPT Developer Mode, Hermes Agent, and OpenClaw so install-to-value can be proven through MCP quickly.
- **Scoped GTM workspace polish**: member/manager/admin experiences are clearer, with safer scoped access expectations and user-facing Overview patterns.
- **Source and Signal reliability**: improved subject association, account-scoped extraction guidance, Signal readiness, and Lineage/Context Graph clarity.
- **Workspace Agent improvements**: tightened readiness messaging, scoped tool expectations, durable/background task behavior, attachments, record draft preview, and email drafting paths.
- **Customer Email and Customer Activity**: reframed mailbox/calendar data as optional context feeds, with stronger filtering, record matching, and Source processing language.
- **Systems of Record clarity**: setup now better communicates what CRMy reads, what it may write, when writeback occurs, and how approvals/audit fit.
- **UI consistency**: login, Command Center, Handoffs, Context tabs, record drawers, Signals, Memory, search, empty states, and object actions received consistency and usability polish.
- **MCP/CLI drift repair**: expanded coverage and documentation around agent-facing tools, record draft preview, email drafting, activity/email context, and the `agent-smoke` validation path.

### Notes

Live connector certification remains environment-dependent. HubSpot is the primary certified path; Salesforce, Databricks, Snowflake, mailbox/calendar OAuth, and custom provider flows should be smoke-tested against real tenant credentials before a production claim.

---

## [0.8.2] — 2026-05-28

### Release Focus

0.8.2 is the release-candidate polish pass for CRMy as an agent-native GTM context and execution layer. It tightens the Sources → Signals → Memory → Handoffs flow, improves scoped user workspaces, hardens handoff-backed record creation, and updates package/OpenAPI metadata for the 0.8.2 push.

### Highlights

- **Clearer context lifecycle**: Source ingestion, grouped Signals, trusted Memory, Context Graph, and Memory Lineage now use simpler product language and route users to the right review/action surface.
- **Scoped human workspaces**: members land on a daily Overview for their book of business, managers see team work, and admins keep the Command Center, Memory Health, Operations, Audit Log, and full Settings.
- **Action-oriented Handoffs**: decision packets, reassignment, friendlier SLA presets, card/table consistency, and clearer approve/reject behavior make policy-gated work easier to complete.
- **Workspace Agent safety**: non-admin users can use the admin-configured model without seeing secrets, while sessions and tools stay bounded to the current user’s visible records.
- **Source extraction resilience**: extraction uses richer context packets, JSON-mode model calls where available, longer bounded timeouts, repair parsing, single-pass multi-subject extraction, and record-proposal handoffs for likely new accounts, contacts, opportunities, or use cases.
- **Release hardening**: approved record-proposal handoffs now create records with the linked human owner and resolve atomically so failed record creation cannot leave an approval half-applied.

### Notes

Live connector certification remains environment-dependent. HubSpot is the primary certified path; Salesforce, Databricks, and Snowflake share the governed connector framework and should be smoke-tested against real tenant credentials before a production claim.

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
