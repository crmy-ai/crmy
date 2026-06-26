# CRMy v0.9.3

CRMy v0.9.3 is the eval, governed product knowledge, and release-certification hardening release. It makes CRMy more measurable for agent builders, adds an optional governed product-knowledge layer for customer-facing actions, and closes several production-readiness gaps found during the 0.9.3 audit.

This release keeps the central loop intact: messy customer context and approved product knowledge stay governed, Signals remain evidence-backed, Memory is promoted only when grounded and ready, and agents get compact Action Context before acting.

## Release Focus

v0.9.3 focuses on proof, governance, and operator confidence:

- add local-first eval harnesses for extraction quality, retrieval, source attribution, tool choice, Action Context, and agent trajectory smoke checks;
- add governed Product Knowledge retrieval, receipts, briefing/Action Context/email grounding, CLI, and admin review controls for product, security, pricing, implementation, roadmap, and competitive claims;
- ground customer-facing email drafts in approved product claims with citations and exclusion warnings;
- make MCP sessions configurable by toolset so autonomous agents can start with a leaner, safer catalog;
- improve first-run proof with `crmy quickstart`;
- add live-provider certification docs and transcript-drop fixtures for repeatable production verification;
- harden setup output, admin pagination, Settings bundle performance, and background-worker recovery guidance.

## Highlights

### Eval Harness And Agent Quality Gates

- Added a local eval harness for deterministic customer-context corpora and production-path extraction quality.
- Added seeded retrieval, Action Context, source attribution, tool-choice, and agent trajectory smoke coverage.
- Added `crmy eval` support so contributors and customers can run quality gates locally without a hosted eval service.
- Added release-gate coverage so eval docs, fixtures, and production-path behaviors stay aligned.

### Governed Product Knowledge

- Added `knowledge_retrieve` and the `product_knowledge` toolset for optional governed product context.
- Added product knowledge claim storage and retrieval receipts with approval, grounding, freshness, source visibility, and customer-safety policy.
- Briefings and Action Context can now include a `product_context` section when configured.
- Customer-facing email draft previews can cite approved product claims, warn when claims are excluded, and persist knowledge receipt metadata.
- Added `crmy knowledge retrieve` plus UI display for approved claims, sources, exclusions, and product-claim usage in drafts.
- Added admin governance for product claims: review queue, approval/rejection/deprecation/staleness/reactivation, freshness review, conflict detection, source-priority resolution, review assignments, and Product Knowledge settings.

### Grounding And Trust

- Added a source-grounding gate for Memory auto-promotion. Signals only auto-promote when evidence is present in the source, reducing the risk of model-created Memory from ungrounded claims.
- Freshness windows mark expired or aging product claims stale without blocking core customer-context flows.
- Added provider certification guidance for Gmail, Outlook, Google Calendar, and Microsoft 365 Calendar across CRMy-managed, tenant-owned, and self-hosted OAuth app sources.
- Added a synthetic transcript-drop fixture for local-folder and S3-compatible source-drop smoke testing without real customer content.
- Confirmed sent/seller-authored and mixed-authorship context remains distinguishable from customer-authored evidence in the documented workflows.

### MCP, CLI, And Setup

- Added per-session MCP toolsets via CLI flags, query params, and headers. Selection narrows the visible catalog but never widens actor scope.
- Autonomous agents default to a leaner `standard` toolset; human/admin sessions default to `full`.
- Added `crmy quickstart` for the connector-free proof path: resolve customer, get briefing, get Action Context, and inspect lineage.
- `crmy init` now masks database credentials in setup output.

### Production Hardening And Performance

- Admin actor and user lists now use stable timestamp-plus-id cursors, including pending-review rank for actor pagination.
- Heavy Settings subsections are lazy-loaded, reducing the Settings route chunk from roughly 503 kB to roughly 222 kB in the production web build.
- Background worker advisory-lock release now binds its lock key correctly, and missing-schema worker failures now point operators to `crmy migrate run`.
- OpenAPI, README, guide, release notes, packaged web assets, and durability gates were refreshed for the 0.9.3 surface.

## Published Packages

Publish candidates:

- `@crmy/core@0.9.3`
- `@crmy/shared@0.9.3`
- `@crmy/server@0.9.3`
- `@crmy/web@0.9.3`
- `@crmy/cli@0.9.3`
- `@crmy/openclaw-plugin@0.9.3`

## Quick Validation

For a fresh local demo:

```bash
npx -y @crmy/cli init --demo
npx -y @crmy/cli quickstart
npx -y @crmy/cli doctor
npx -y @crmy/cli eval run
npx -y @crmy/cli agent-smoke
npx -y @crmy/cli briefing "account:Northstar Labs"
npx -y @crmy/cli action-context "account:Northstar Labs" --action customer_outreach
```

## Validation Run

Before release:

- `npm run lint`
- `npm test` — 163/163 passing
- `npm run test:cli-coverage` — 23/23 passing
- `npm run build --workspace=packages/web`
- `npm run build --workspace=packages/server`
- `npm run build --workspace=packages/cli`
- `npm run generate:openapi --workspace=packages/server`
- `npm audit --audit-level=moderate --omit=dev`
- `npm publish --workspaces --include-workspace-root --dry-run`

## Notes And Caveats

- Live Gmail, Outlook, Google Calendar, Microsoft Calendar, HubSpot, Salesforce, and warehouse connector certification remains environment-dependent and should be run before production provider claims.
- The provider certification checklist is now explicit for Google/Microsoft OAuth app sources, but those live-provider tests cannot be completed without sandbox or production provider accounts.
- Governed product knowledge is optional. It does not create customer Memory and should remain customer-facing only when claims are approved, grounded, fresh, and externally safe.
- Global REST/MCP/agent quotas and SaaS-scale rate limiting remain post-0.9 work.

# CRMy v0.9.2

CRMy v0.9.2 is the transcript ingestion, scale, and production hardening release. It expands CRMy beyond mailbox/calendar context by adding admin-managed transcript and raw-note drops, then tightens the runtime path for higher-volume, hosted, and agent-first deployments.

This release keeps the core promise intact: messy customer context enters once, becomes traceable Raw Context, resolves into reviewable Signals, promotes into durable Memory only when ready, and returns compact Action Context before agents act.

## Release Focus

v0.9.2 focuses on source breadth, durability, and release readiness:

- add transcript and raw-note drop ingestion through S3-compatible buckets and local self-hosted folders;
- match transcript files to meetings, accounts, contacts, opportunities, and use cases through the same Subject Graph resolver;
- keep unmatched or ambiguous files reviewable instead of silently dropping them;
- harden high-volume list pagination, webhook delivery creation, migration startup, database TLS, and worker coordination;
- reduce token waste with budget profiles, ranked retrieval, and evidence-on-demand behavior;
- update CLI, MCP, REST/OpenAPI, UI, docs, and generated web assets for the new context-source workflow.

## Highlights

### Transcript & Notes Drops

- Added admin-managed Context Source Drops for S3-compatible buckets and local folders.
- Supported transcript/raw-note formats include `.txt`, `.md`, `.vtt`, `.srt`, `.json`, `.docx`, and `.pdf`.
- Dropped files are tracked as source objects with content hash, size, modified time, match state, processing state, linked records, and review status.
- Long transcripts are chunked while preserving parent source hash so one long transcript does not inflate independent corroboration.
- Oversized, unmatched, ambiguous, or failed files stay visible in review/Handoff flows.

### Context Engine Integration

- Transcript drops feed the same path as customer activity notes:

  `Source Object -> Meeting Artifact / Customer Activity -> Raw Context -> Signals -> Memory -> Lineage / Handoff`

- Matching now supports sidecar metadata, provider calendar identifiers, meeting time plus attendee overlap, contact/account domain matching, and Subject Graph resolution.
- Transcript and meeting context preserve authorship metadata so customer-authored, CRMy-authored, mixed, and unknown sources can be treated differently.
- Context lineage and activity surfaces expose source-object proof so agents and humans can trace where customer memory came from.

### Production Hardening

- Added shared unauthenticated login/register rate limiting backed by PostgreSQL and hashed identities.
- Added production database TLS guardrails requiring verified server certificates unless an explicit escape hatch is set.
- Added production migration startup modes: local installs auto-migrate, while production defaults to validation and expects a one-shot `crmy migrate run`.
- Split runtime process roles into `all`, `web`, and `worker` so hosted deployments can separate HTTP/MCP/UI from background work.
- Fixed the background worker advisory lock to acquire and release on the same checked-out database client.
- Added durable outbound webhook event backlog processing so persisted events can still create deliveries if an in-process subscriber misses them.
- Added stable timestamp-plus-id cursor pagination and estimated totals across high-volume list surfaces.

### Agent and CLI Surfaces

- Added MCP tools for context source connection and object list/create/sync/resolve/reprocess/ignore workflows.
- Added CLI commands for transcript source setup, sync, review, resolution, reprocessing, and ignore flows.
- Added efficient REST mappings for transcript source CLI commands.
- Updated OpenAPI and docs for transcript source drops, migration mode, process roles, token usage controls, and hosted/runtime guardrails.

### Security and Dependency Updates

- Upgraded production mail/form dependencies to clear high-severity audit findings:
  - `nodemailer` to `9.0.1`
  - `form-data` to `4.0.6`
  - transitive `hono` to `4.12.27`
- Upgraded `tsx` to `4.22.4`.
- `npm audit --audit-level=moderate --omit=dev` reports zero vulnerabilities.
- A remaining low-severity `esbuild` advisory exists only through `tsup` dev/build tooling and does not affect published runtime dependencies.

## Published Packages

Publish candidates:

- `@crmy/core@0.9.2`
- `@crmy/shared@0.9.2`
- `@crmy/server@0.9.2`
- `@crmy/web@0.9.2`
- `@crmy/cli@0.9.2`
- `@crmy/openclaw-plugin@0.9.2`

## Quick Validation

For a fresh local demo:

```bash
npx -y @crmy/cli init --demo
npx -y @crmy/cli doctor
npx -y @crmy/cli agent-smoke
npx -y @crmy/cli activities transcript-sources
npx -y @crmy/cli briefing "account:Northstar Labs"
npx -y @crmy/cli action-context "account:Northstar Labs" --action customer_outreach
```

## Validation Run

Before publish:

- `npm test` — 159/159 passing
- `npm run test:cli-coverage` — 22/22 passing
- `npm run lint`
- `npm run build`
- `npm run generate:openapi --workspace=packages/server`
- `npm audit --audit-level=moderate --omit=dev`
- `npm publish --workspaces --include-workspace-root --dry-run`

## Notes and Caveats

- Live Gmail, Outlook, Google Calendar, Microsoft Calendar, HubSpot, Salesforce, and warehouse connector certification should still be run in the target tenant/provider environment before production claims.
- Global REST/MCP/agent rate limiting remains a post-0.9 item; current actor and auth throttles are materially stronger but not a full hosted SaaS quota system.
- Hosted multi-instance deployments should use separate `web`, `worker`, and migration jobs with sticky MCP routing, as documented in the runtime plan.
- Local folder transcript drops are local/self-hosted only unless explicitly enabled in production.

# CRMy v0.9.1

CRMy v0.9.1 is the email context workflow release — the hardening line that makes customer email easier to connect, easier to trust, easier to send from the right identity, and easier for agents to follow from source message to Raw Context, Signals, Memory, activity, approval, and reply.

Before an agent drafts or sends customer email, CRMy now does more than generate copy. It resolves who is sending, what mailbox is used for context, whether replies can flow back into Memory, what evidence is safe to cite, and whether the action needs human approval. v0.9.1 turns email from a disconnected side surface into a first-class customer context source and governed action path.

## Release Focus

v0.9.1 focuses on email context, sender identity, and setup clarity:

- make mailbox context and outbound email actions explicit and traceable;
- prefer the actor's connected mailbox as sender identity, with tenant fallback provider kept for shared/system delivery;
- process sent email back into account activity and CRMy-authored context without treating CRMy's own words as customer-authored truth;
- improve Gmail/Outlook OAuth setup for admins and user self-service mailbox/calendar connection flows;
- expose mailbox and calendar connection paths through UI, MCP, and CLI for agent-first users;
- add stable cursor pagination and token budget controls for high-volume context retrieval.

## Highlights

### Email Context Workflow

- Customer Email is split into clearer surfaces: **Mailbox Context** for customer-message ingestion and **Outbound Actions** for governed drafts, approvals, provider drafts, and sends.
- Connected mailboxes now carry explicit context-sync, send, provider-draft, default-sender, and status fields.
- Drafts and sends persist sender metadata, including `from_email`, `from_name`, `sender_type`, and `mailbox_connection_id`.
- Sender resolution now prefers the actor's send-enabled mailbox, then tenant fallback provider, and leaves save-draft-only behavior when no sender is available.
- Rejected outbound emails remain discoverable, show reviewer context, block direct send, and can be revised in place for approval resubmission.
- Email search and subject summaries now keep rejected, failed, pending, draft, and account-linked outbound records visible instead of letting them disappear between scoped and global views.

### Sent Email Becomes Context Safely

- Sent email is recorded as account activity and becomes context for future agents.
- CRMy distinguishes seller/CRMy-authored outbound email from customer-authored evidence, so agents can see what your team said without treating it as what the customer claimed.
- Email and calendar sources are traceable through Raw Context, Signal, Memory, Lineage, and account activity views.
- Reply-chain metadata, sender identity, linked records, and provider thread/conversation context are preserved so follow-up replies can be matched back to the original workflow.

### Mailbox, Calendar, and OAuth Setup

- System Connections now separates provider OAuth setup from personal mailbox/calendar connection.
- Hosted deployments can use CRMy-managed Google/Microsoft OAuth apps, while enterprise tenants can bring tenant-owned OAuth apps when they need custom consent, publisher identity, security review, or domain restrictions.
- Admins can see actor mailbox, sender, and calendar coverage from Actor settings.
- Members and managers get a guided Overview prompt to connect email and calendar, with simpler copy focused on customer memory value instead of redirect-path details.
- Gmail/Outlook connection flows support self-service browser auth from the UI, and MCP/CLI tools can return an `auth_url` for users working through agent harnesses.

### Actor Controls and Scope

- Admins can activate, deactivate, or disconnect actor mailbox/calendar connections while preserving the distinction between reversible pause and destructive disconnect.
- Users can deactivate or disconnect their own mailbox/calendar from Customer Email and Customer Activity.
- Mailbox and calendar ingestion scopes support owned-account versus accessible-account modes, using account domains and additional domains to match customer records.
- Account domain collision handling, account splitting, and account merge support help admins resolve ambiguous or misassigned customer domains.

### Agent-Facing Email Tools

- MCP email tools now document mailbox connections as both context sources and sender identities.
- `email_create`, `email_draft_preview`, and `email_draft_save` expose selected sender information and explain how sends flow through approval, provider draft, or delivery.
- `mailbox_connection_start` and `calendar_connection_start` let a human-linked actor start OAuth from MCP/CLI by returning a browser auth URL.
- Tenant shared sender settings are now documented as fallback/shared/system delivery, not the user's personal mailbox.

### Retrieval, Scale, and Token Control

- Context, Raw Context, Signal Group, and Activity list pagination now use stable timestamp-plus-id cursors so high-volume timestamp ties do not skip or duplicate rows.
- Briefings and Action Context now support token budget profiles: `tiny`, `standard`, `deep`, and `evidence_heavy`.
- `evidence_mode` lets agents choose compact evidence summaries, full proof inline, or no evidence arrays for cheap scanning.
- Ranking now accounts for confidence, freshness decay, context type priority, evidence support, and proposed action relevance.
- README now includes a dedicated section explaining how CRMy reduces token usage by compressing Raw Context into Signals/Memory, using action-sized retrieval, and keeping proof available on demand.

### Release and Operations Polish

- OpenAPI was regenerated for the new email, OAuth, sender identity, Action Context, pagination, and token-budget contracts.
- Durability/static coverage now checks email visibility, mailbox/calendar setup, sender metadata, OAuth readiness, stable cursor pagination, briefing contract parity, and docs alignment.
- Packaged server web assets were rebuilt for the npm release.

## Published Packages

Published to npm:

- `@crmy/core@0.9.1`
- `@crmy/shared@0.9.1`
- `@crmy/server@0.9.1`
- `@crmy/web@0.9.1`
- `@crmy/cli@0.9.1`
- `@crmy/openclaw-plugin@0.9.1`

## Quick Validation

For a fresh local demo:

```bash
npx -y @crmy/cli init --demo
npx -y @crmy/cli doctor
npx -y @crmy/cli agent-smoke
npx -y @crmy/cli briefing "account:Northstar Labs"
npx -y @crmy/cli action-context "account:Northstar Labs" --action customer_outreach
```

To validate the email setup path, open CRMy and use:

1. **Settings -> System Connections -> OAuth** to verify Google/Microsoft readiness.
2. **Customer Email -> Mailboxes & Senders** to connect a personal mailbox.
3. **Customer Activity -> Connections** to connect calendar context.
4. **Settings -> Actors** to confirm mailbox, sender, and calendar coverage.
5. **Customer Email -> Outbound Actions** to draft, review, reject/revise, approve, or send with visible sender identity.

## Validation Run

Before publish:

- `npm run build`
- `npm run lint`
- `npm run test:durability --workspace=packages/server` — 156/156 passing
- `npm run generate:openapi --workspace=packages/server`
- `npm publish --workspaces --include-workspace-root --dry-run`
- npm registry verification for all six `0.9.1` packages

## Notes and Caveats

- Real Gmail and Microsoft provider behavior still depends on tenant OAuth configuration, granted scopes, provider policy, and mailbox permissions. Test with real tenant credentials before making production email-delivery claims.
- CRMy-managed OAuth apps are supported as the intended hosted-SaaS direction, while self-hosted/local installs can continue using environment-managed OAuth credentials.
- Calendar free/busy suggestions intentionally avoid exposing raw calendar event details.
- Full multi-instance hosted MCP/session portability still depends on sticky routing and the documented durable runtime architecture.
- Global rate limiting remains a post-0.9 roadmap item; actor-scoped request controls and operational safeguards are in place, but large hosted deployments should still front CRMy with platform-level controls.

## Community Testing Wanted

The highest-value feedback for v0.9.1 is real email and calendar workflow testing:

- Gmail and Outlook OAuth setup with different tenant policies;
- actor mailbox send, provider draft, and tenant fallback sender behavior;
- rejected email revision and approval resubmission;
- customer replies syncing back into account context;
- sent email appearing as CRMy-authored activity and context;
- mailbox/calendar ingestion scope behavior for owned versus accessible accounts;
- domain collisions, account split/merge flows, and ambiguous customer matching;
- MCP/CLI-only mailbox or calendar connection paths using returned auth URLs.

If you are testing CRMy with real GTM email/calendar data, please share sanitized threads, missed record matches, reply-chain edge cases, OAuth setup blockers, and places where agent-facing context is too large, too thin, or missing proof.

# CRMy v0.9.0

CRMy v0.9.0 is the agent reliability and polish release — the hardening line that brings durable workspace agent execution, richer email and inbox surfaces, and a tighter admin and object UX into a coherent whole.

Before any agent acts on a customer record, CRMy can tell it what is true, what is stale, what is inferred, what is approved, what system owns the record, what action is allowed, and what proof or audit trail will exist afterward. v0.9.0 makes that guarantee hold under real agent workloads.

## Release Focus

v0.9.0 focuses on agent execution durability and surface polish:

- harden workspace agent tool execution, side-effect handling, and record-write permissions;
- add durable replay-oriented safeguards and test coverage around agent turns and side-effecting tools;
- deepen email and inbox surfaces with draft previews, message linking, and improved provider support;
- polish admin UX for Action Policy conditions, Messaging, Systems of Record, and Context Lineage;
- clean up object list and drawer UX across Accounts, Contacts, Opportunities, and Use Cases;
- extend the CLI with friendly error surfaces and improved server startup feedback.

## Highlights

### Durable Workspace Agent Execution

- Agent engine hardened against partial tool execution, replay-unsafe side effects, and stale turn state.
- Record-write tool exposure now requires explicit write permission scopes — agents cannot write records they are not authorized to modify.
- Turn runner adds guard rails around side-effecting tool calls to prevent double-execution on retry.
- New `test/durability.test.mjs` suite with 294+ lines of durability and replay coverage.
- `tool-ux.ts` added to centralize response formatting and error surface for MCP tool calls.

### Email and Inbox Surfaces

- Email drawer rebuilt with full message thread view, context add, and draft editing.
- Draft preview and save endpoints added to REST router; `email_draft_preview` and `email_draft_save` now exposed in MCP.
- Inbox adds message linking and ignore flows; message processing improved for inbound provider events.
- `email-messages` repo extended with richer query, link, and ignore primitives.
- Provider-level email and mailbox connection list endpoints added to REST API.

### Action Policy and HITL UX

- Action Policy condition editing redesigned with clearer write-permission language and structured condition builder.
- HITL rules settings expanded with guided setup, required field validation, and full-height layout.
- Pending writeback rules now surface inline in the HITL rules view.

### Context Lineage and Governance

- Context Lineage default view simplified to source → Signal → Memory; usage and audit details available on demand.
- Context Governance view updated for cleaner contradiction and staleness flows.
- Agent Markdown renderer extended with richer structured-output support for lineage and briefing responses.

### Object List and Drawer Polish

- Accounts, Contacts, Opportunities, and Use Cases all receive consistent hover-only briefing/agent action bars.
- Opportunity and Use Case drawers improved with field editing, lifecycle controls, and briefing navigation.
- Account and Contact drawers add inline activity and timeline access.
- Briefing panel navigation between related records improved.

### Settings and Systems of Record

- Messaging settings redesigned with tab layout, full-height guided setup, and subtler semantic retrieval status.
- Systems of Record settings cleaned up; connection state and sync status now surface in the tab header.
- Agent settings page updated for model and provider configuration clarity.

### CLI and Server Startup

- Server startup now distinguishes "migrations skipped" from "migrations run" in progress output.
- CLI client adds friendly error surfaces for common failure modes via `friendlyErrors.ts`.
- `agent-smoke` command registered and fully functional for quick end-to-end validation.
- Search indexer tenant handling fixed to prevent cross-tenant index bleed.

## Published Packages

Published to npm:

- `@crmy/core@0.9.0`
- `@crmy/shared@0.9.0`
- `@crmy/server@0.9.0`
- `@crmy/web@0.9.0`
- `@crmy/cli@0.9.0`
- `@crmy/openclaw-plugin@0.9.0`

## Quick Validation

For a fresh local demo:

```bash
npx -y @crmy/cli init --yes
npx -y @crmy/cli doctor
npx -y @crmy/cli agent-smoke
npx -y @crmy/cli tools describe briefing_get
```

Then connect an agent harness and ask:

```text
Use the CRMy MCP tools to resolve the account "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.
```

Expected path:

1. CRMy resolves the account.
2. `briefing_get` returns Memory, activity, and grouped Signals.
3. Signal review items are visible.
4. The agent explains the safest next action using evidence from lineage.

## Validation Run

Before publish:

- `npm run build`
- `npm run lint`
- `npm test` — durability suite passing
- `npm run test:cli-coverage`
- `npm --workspace @crmy/server run generate:openapi`

## Notes and Caveats

- pgvector remains optional. Semantic search improves retrieval when configured, but lexical and deterministic paths continue to work without it.
- Live connector certification remains environment-dependent. HubSpot is the primary certified path; Salesforce, Databricks, Snowflake, mailbox/calendar OAuth, and custom provider flows should be smoke-tested against real tenant credentials before production claims.
- v0.9.0 improves agent execution durability and surface consistency. Full high-volume/serverless Postgres scale certification remains planned for the 1.0 resilience-at-scale line.

## Community Testing Wanted

The biggest thing CRMy needs from the community is real-world testing under agent workloads:

- agent turns that involve multiple side-effecting tool calls;
- email and inbox flows with real provider data;
- Action Policy condition editing under varied rule shapes;
- Systems of Record sync and writeback under concurrent writes;
- Handoff approval and rejection flows from external agent harnesses;
- auth, API key, and scoped-access behavior under real deployments;
- recovery from provider failures, stale jobs, and partial writes.

If you are testing CRMy against real GTM systems, please share sanitized fixtures, expected matches, missed Signals, false positives, writeback receipts, and recovery behavior. That feedback directly shapes the v1.0 resilience line.
