# crmy.ai MCP Tools Reference

## Start Here

CRMy exposes many tools, but agents should usually connect with scoped credentials so they only see the tools needed for their job. Avoid full admin/operator manifests for ordinary customer workflows.

### Toolsets — focus the catalog per session

Scopes decide what an actor **may** use; a **toolset** decides what a single session actually **registers**. Toolsets exist because a large registered catalog degrades tool-selection accuracy and wastes context.

- Selection is **per connection, not per key**: `?toolset=<name>` or the `X-CRMy-Toolset` header on HTTP MCP, `crmy mcp --toolset <name>` or `CRMY_MCP_TOOLSET` on stdio. The same key can open differently-focused sessions for different jobs.
- Selection only ever **narrows** the actor's scope-filtered tools. It can never grant access, and `enforceToolScopes` still runs on every call.
- Defaults: autonomous **agents → `standard`** (a lean customer-reasoning loop), **humans/admins → `full`**. Operators can override the default with `CRMY_MCP_DEFAULT_TOOLSET`.
- Every named toolset also includes the core navigation tools (`tool_guide`, `guide_search`, `actor_whoami`, `customer_record_resolve`, `briefing_get`, `action_context_get`, `context_find`) so a session can always orient and discover other toolsets.

Available toolsets: `full`, `standard`, `record_lookup`, `ingest`, `signal_review`, `memory_promotion`, `customer_outreach`, `record_update`, `systems_writeback`, `ops`, `product_knowledge`. Call `tool_guide` to see descriptions and the toolset that matches a workflow.

### tool_guide
Read-only router for common MCP workflows. Use this when the agent is unsure which CRMy tool path to take.
- **Input**: `workflow` (`first_steps`, `record_lookup`, `brief_before_action`, `ingest_raw_context`, `review_signals`, `promote_memory`, `customer_outreach`, `record_update`, `systems_writeback`, `post_action_follow_up`, `ops_recovery`)
- **Output**: `{ workflow, summary, recommended_tools, avoid_tools, next_step, focus_toolset, how_to_focus_tools, available_toolsets, reminder }`

### guide_search
Search the CRMy guide for feature, concept, and workflow documentation.
- **Input**: `query` (required), `section`
- **Output**: `{ sections, available_sections }`

### knowledge_retrieve
Retrieve **governed product knowledge** — approved, source-grounded, cited product, pricing, implementation, security, and competitive claims — to ground a customer-facing action. `customer_facing` (default) applies a strict policy: only approved, externally-visible, source-grounded, fresh claims; everything else is reported under `excluded_claims` with a reason. `internal` includes risky claims but labels them in `warnings`. Optional and non-blocking: it never creates Memory or writes to systems of record, and returns a clear `not_configured` status until claims exist. Every retrieval records a receipt for proof/lineage. In the `product_knowledge` and `customer_outreach` toolsets; requires `knowledge:read` (covered by the `read` wildcard). Also available over REST at `POST /api/v1/knowledge/retrieve`. See [Governed Product Knowledge Retrieval](governed-product-knowledge-retrieval.md).

> **Briefing & Action Context auto-enrichment:** `briefing_get` and `action_context_get` include a `product_context` block (a sibling to customer Memory) **by default whenever product knowledge is configured**. Pass `include_product_context: false` to skip it, or `true` to force it. Action Context also adds an informational `product_knowledge` check and `used_knowledge_claim_ids` / `knowledge_retrieval_receipt_ids` proof. This is strictly additive — it never blocks or changes the operating mode.
- **Input**: `query` (required), `subject_type`, `subject_id`, `audience` (`customer_facing` | `internal`), `proposed_action`, `product_scope`, `competitor`, `persona`, `industry`, `require_approved`, `include_stale`, `limit`
- **Output**: `{ status, claims[], excluded_claims[], warnings[], retrieval_receipt?, message? }` where `status` is `available` | `no_results` | `degraded` | `not_configured`

### knowledge_claim_upsert
**Admin/governance** tool to author or update a product knowledge claim envelope (capability, proof point, pricing, implementation, security, or competitive response). Provide `source_text` so CRMy can verify the claim is **grounded** in its source — customer-facing eligibility requires grounding plus `approval_status: approved`, `approved_for_external_use`, `visibility: external`, and freshness. Re-upserts by `external_key` update in place. Authors governed product truth; does not touch customer Memory. Admin-only; requires `knowledge:write`.
- **Input**: `category` (required), `title` (required), `body` (required), `summary`, `source_text`, `external_key`, `product_scope[]`, `competitors[]`, `personas[]`, `industries[]`, `source_ref`/`source_url`/`source_label`/`source_version`, `confidence`, `source_priority`, `approval_status`, `approved_for_external_use`, `visibility`, `status`, `effective_at`, `valid_until`
- **Output**: the stored `KnowledgeClaim` (including the computed `grounded` flag)

Common safe paths:
- **Unknown customer reference**: `customer_record_resolve` → `action_context_get` or `briefing_get`
- **Find Memory, Signals, stale context, or search results**: `context_find`
- **Raw notes/transcripts/email/research**: `context_ingest_auto` when IDs are unknown, `context_ingest` when subject IDs are known
- **Before customer-facing action**: `action_context_get` with `proposed_action`
- **When Action Context requires review**: `action_context_request_human_unblock`
- **After sends, approvals, writebacks, assignments, workflows, or sequences**: `context_lineage_get` and inspect `outcomes` before dependent follow-up
- **Signal review**: `context_find` with `mode="signals"` → `context_signal_group_get` → complete details, handoff, reject, or promote
- **Operator recovery**: `ops_status_get` or `ops_data_quality_get` first; keep repair tools at `dry_run=true` until confirmed

## Contact Tools

### contact_create
Create a new contact in the CRM.
- **Input**: `first_name` (required), `last_name`, `email`, `phone`, `title`, `company_name`, `account_id`, `lifecycle_stage`, `aliases`, `tags`, `custom_fields`, `source`
- **Output**: `{ contact, event_id }`

### contact_get
Get a contact by ID.
- **Input**: `id` (required)
- **Output**: `{ contact }`

### contact_search
Search contacts with filters.
- **Input**: `query`, `lifecycle_stage`, `account_id`, `owner_id`, `tags`, `limit`, `cursor`
- **Output**: `{ contacts, next_cursor, total }`

### contact_update
Update a contact.
- **Input**: `id` (required), `patch` (object with fields to update, including `aliases: string[]`)
- **Output**: `{ contact, event_id }`

### contact_delete
Archive a contact while preserving evidence and lineage anchors (admin/owner only).
- **Input**: `id` (required)
- **Output**: `{ deleted: true, event_id }`

### contact_set_lifecycle
Set the lifecycle stage of a contact.
- **Input**: `id` (required), `lifecycle_stage` (required), `reason`
- **Output**: `{ contact, event_id }`

### contact_get_timeline
Get the activity timeline for a contact.
- **Input**: `id` (required), `limit`, `types`
- **Output**: `{ activities, total }`

### contact_get_opportunities
Get all opportunities linked to a contact.
- **Input**: `contact_id` (required), `stage`, `limit`
- **Output**: `{ contact_id, opportunities, total }`

### contact_score
Compute and persist the lead score for a contact.
- **Input**: `contact_id` (required), `idempotency_key`, `expected_version`
- **Output**: `{ contact_id, lead_score, score_breakdown, last_updated, mutation }`

### contact_merge
Merge a duplicate contact into a primary contact.
- **Input**: `primary_id` (required), `secondary_id` (required), `idempotency_key`, `primary_expected_version`, `secondary_expected_version`
- **Output**: `{ primary, secondary_id, merged_count, event_id, mutation }`

## Account Tools

### account_create
Create a new account.
- **Input**: `name` (required), `domain`, `industry`, `employee_count`, `annual_revenue`, `currency_code`, `website`, `parent_id`, `aliases`, `tags`, `custom_fields`
- **Output**: `{ account, event_id }`

### account_get
Get an account with its contacts and open opportunities.
- **Input**: `id` (required)
- **Output**: `{ account, contacts, open_opportunities }`

### account_search
Search accounts.
- **Input**: `query`, `industry`, `owner_id`, `min_revenue`, `tags`, `limit`, `cursor`
- **Output**: `{ accounts, next_cursor, total }`

### account_update
Update an account.
- **Input**: `id` (required), `patch` (object with fields to update, including `aliases: string[]`)
- **Output**: `{ account, event_id }`

### account_set_health_score
Set account health score (0-100).
- **Input**: `id` (required), `score` (required), `rationale`
- **Output**: `{ account, event_id }`

### account_get_hierarchy
Get parent/child hierarchy for an account.
- **Input**: `id` (required)
- **Output**: `{ root, children, depth }`

### account_delete
Archive an account while preserving evidence and lineage anchors (admin/owner only).
- **Input**: `id` (required)
- **Output**: `{ deleted: true, event_id }`

## Opportunity Tools

### opportunity_create
Create a new sales opportunity.
- **Input**: `name` (required), `account_id`, `contact_id`, `amount`, `currency_code`, `close_date`, `stage`, `description`, `custom_fields`
- **Output**: `{ opportunity, event_id }`

### opportunity_get
Get an opportunity with recent activities.
- **Input**: `id` (required)
- **Output**: `{ opportunity, activities }`

### opportunity_search
Search opportunities.
- **Input**: `query`, `stage`, `owner_id`, `account_id`, `forecast_cat`, `close_date_before`, `close_date_after`, `limit`, `cursor`
- **Output**: `{ opportunities, next_cursor, total }`

### opportunity_advance_stage
Advance an opportunity to a new stage.
- **Input**: `id` (required), `stage` (required), `note`, `lost_reason` (required for closed_lost)
- **Output**: `{ opportunity, event_id }`

### opportunity_update
Update an opportunity.
- **Input**: `id` (required), `patch`
- **Output**: `{ opportunity, event_id }`

### opportunity_delete
Archive an opportunity while preserving evidence and lineage anchors (admin/owner only).
- **Input**: `id` (required)
- **Output**: `{ deleted: true, event_id }`

### pipeline_summary
Get pipeline summary.
- **Input**: `owner_id`, `group_by` (stage|owner|forecast_cat)
- **Output**: `{ total_value, count, by_stage }`

## Activity Tools

### activity_create
Create a standalone activity.
- **Input**: `type` (required), `subject` (required), `body`, `contact_id`, `account_id`, `opportunity_id`, `due_at`, `direction`, `custom_fields`
- **Output**: `{ activity, event_id }`

### activity_get
Get an activity by ID.
- **Input**: `id` (required)
- **Output**: `{ activity }`

### activity_search
Search activities.
- **Input**: `contact_id`, `account_id`, `opportunity_id`, `type`, `limit`, `cursor`
- **Output**: `{ activities, next_cursor, total }`

### activity_get_timeline
Get paginated activity timeline for any customer record.
- **Input**: `subject_type` (required: contact|account|opportunity|use_case), `subject_id` (required), `limit`, `types`
- **Output**: `{ activities, total }`

### activity_complete
Mark an activity as completed.
- **Input**: `id` (required), `completed_at`, `note`
- **Output**: `{ activity, event_id }`

### activity_update
Update an activity.
- **Input**: `id` (required), `patch`
- **Output**: `{ activity, event_id }`

### Transcript & notes drop tools
Use these when transcripts or raw notes are exported to a storage location rather than sent inline through `context_ingest_auto`.

Admin tools:
- `context_source_connection_list`
- `context_source_connection_create`
- `context_source_connection_update`
- `context_source_connection_delete`
- `context_source_connection_sync`

Review/processing tools:
- `context_source_object_list`
- `context_source_object_get`
- `context_source_object_resolve`
- `context_source_object_reprocess`
- `context_source_object_ignore`

Supported providers are `s3` and `local_folder`. S3 credentials are encrypted and write-only. Local folders are intended for local/self-hosted installs and must be inside `CRMY_LOCAL_SOURCE_ROOTS`. Unmatched or ambiguous source objects create Handoffs and appear in Customer Activity Needs Context; resolving an object links it to a meeting or customer record and queues processing into Raw Context, Signals, Memory, and Lineage.

## Assignment Tools

### assignment_create
Create a structured handoff between a human and an agent.
- **Input**: `title` (required), `assignee_actor_id` (required), `subject_type`, `subject_id`, `instructions`, `priority` (low|normal|high|urgent), `due_at`, `context`, `metadata`
- **Output**: `{ assignment, event_id }`

### assignment_get
Get an assignment by ID.
- **Input**: `id` (required)
- **Output**: `{ assignment }`

### assignment_list
List assignments with filters.
- **Input**: `assignee_actor_id`, `assigner_actor_id`, `status`, `subject_type`, `subject_id`, `limit`, `cursor`
- **Output**: `{ assignments, next_cursor, total }`

### assignment_accept
Accept a pending assignment.
- **Input**: `id` (required)
- **Output**: `{ assignment, event_id }`

### assignment_start
Transition an assignment to in_progress.
- **Input**: `id` (required)
- **Output**: `{ assignment, event_id }`

### assignment_complete
Mark an assignment as completed.
- **Input**: `id` (required), `outcome`
- **Output**: `{ assignment, event_id }`

### assignment_decline
Decline an assignment with an optional reason.
- **Input**: `id` (required), `reason`
- **Output**: `{ assignment, event_id }`

### assignment_block
Mark an assignment as blocked.
- **Input**: `id` (required), `blocked_reason` (required)
- **Output**: `{ assignment, event_id }`

### assignment_cancel
Cancel an assignment.
- **Input**: `id` (required)
- **Output**: `{ assignment, event_id }`

### assignment_update
Update assignment fields.
- **Input**: `id` (required), `patch` (title, instructions, due_at, priority)
- **Output**: `{ assignment, event_id }`

## Use Case Tools

### use_case_create
Create a use case (consumption-based workload) for an account.
- **Input**: `account_id` (required), `name` (required), `stage`, `unit_label`, `consumption_capacity`, `attributed_arr`, `expansion_potential`, `tags`, `custom_fields`
- **Output**: `{ use_case, event_id }`

### use_case_get
Get a use case by ID.
- **Input**: `id` (required)
- **Output**: `{ use_case }`

### use_case_search
Search use cases.
- **Input**: `account_id`, `stage`, `owner_id`, `product_line`, `tags`, `limit`, `cursor`
- **Output**: `{ use_cases, next_cursor, total }`

### use_case_update
Update a use case.
- **Input**: `id` (required), `patch`
- **Output**: `{ use_case, event_id }`

### use_case_delete
Archive a use case while preserving evidence and lineage anchors.
- **Input**: `id` (required)
- **Output**: `{ deleted: true }`

### use_case_advance_stage
Advance a use case to the next stage.
- **Input**: `id` (required), `stage` (required: discovery|poc|production|scaling|sunset), `note`
- **Output**: `{ use_case, event_id }`

### use_case_update_consumption
Update current consumption value.
- **Input**: `id` (required), `consumption_current` (required), `note`
- **Output**: `{ use_case, event_id }`

### use_case_set_health
Set use case health score.
- **Input**: `id` (required), `score` (0–100, required), `rationale`
- **Output**: `{ use_case, event_id }`

### use_case_link_contact
Link a contact to a use case with a role.
- **Input**: `use_case_id` (required), `contact_id` (required), `role`
- **Output**: `{ linked: true }`

### use_case_unlink_contact
Remove a contact link from a use case.
- **Input**: `use_case_id` (required), `contact_id` (required)
- **Output**: `{ unlinked: true }`

### use_case_list_contacts
List contacts linked to a use case.
- **Input**: `use_case_id` (required)
- **Output**: `{ contacts }`

### use_case_get_timeline
Get activity timeline for a use case.
- **Input**: `id` (required), `limit`, `types`
- **Output**: `{ activities, total }`

### use_case_summary
Aggregate use cases by stage, product line, or owner.
- **Input**: `group_by` (stage|product_line|owner), `account_id`
- **Output**: `{ groups, total }`

## Registry Tools

### activity_type_list
List all registered activity types for the tenant.
- **Input**: (none)
- **Output**: `{ activity_types }`

### activity_type_add
Register a custom activity type.
- **Input**: `name` (required, snake_case), `category` (required), `description`
- **Output**: `{ activity_type }`

### activity_type_remove
Remove a custom activity type.
- **Input**: `name` (required)
- **Output**: `{ removed: true }`

### context_type_list
List all registered context types for the tenant, including `priority_weight` and `confidence_half_life_days`.
- **Input**: (none)
- **Output**: `{ context_types }`

### context_type_add
Register a custom context type.
- **Input**: `name` (required, snake_case), `description`, `priority_weight` (default 1.0), `confidence_half_life_days`
- **Output**: `{ context_type }`

### context_type_remove
Remove a custom context type (default types cannot be removed).
- **Input**: `name` (required)
- **Output**: `{ removed: true }`

## Workflow Tools

### workflow_create
Create an event-driven automation workflow.
- **Input**: `name` (required), `trigger_event` (required), `trigger_filter`, `actions` (required array), `is_active`
- **Output**: `{ workflow }`

### workflow_get
Get a workflow with its 5 most recent runs.
- **Input**: `id` (required)
- **Output**: `{ workflow, recent_runs }`

### workflow_list
List workflows.
- **Input**: `trigger_event`, `is_active`, `limit`, `cursor`
- **Output**: `{ workflows, next_cursor, total }`

### workflow_update
Update a workflow.
- **Input**: `id` (required), `patch` (name, trigger_event, trigger_filter, actions, is_active)
- **Output**: `{ workflow }`

### workflow_delete
Delete a workflow and its run history.
- **Input**: `id` (required)
- **Output**: `{ deleted: true }`

### workflow_run_list
List execution runs for a workflow.
- **Input**: `workflow_id` (required), `status` (running|completed|failed), `limit`, `cursor`
- **Output**: `{ runs, next_cursor, total }` — each run includes `action_logs` with per-action type, status, duration_ms, and error

### workflow_run_replay ★ 0.7+
Replay a failed or parked workflow run by creating a new direct run with an operator-supplied payload. The replay is explicit: CRMy does not silently reuse hidden side effects.
- **Input**: `run_id` (required), `variables` (object), `reason` (required), `subject_type`, `subject_id`, `idempotency_key`
- **Output**: `{ replay_of_run_id, workflow_id, workflow_name, replay, mutation }`

### workflow_template_list ★ 0.7+
List available built-in GTM workflow templates. Templates are static (no DB) and can be used as a starting point for `workflow_create`. Use the `category` filter to narrow results.
- **Input**: `category` (optional)
- **Output**: `{ templates }` — array of template objects with name, description, trigger_event, trigger_filter, and actions

## Operational Governance Tools

These tools are admin/owner-only and are designed for enterprise durability, incident response, privacy workflows, and operator review.

### ops_status_get ★ 0.7+
Return tenant-scoped health for durable queues and async jobs.
- **Input**: `include_samples`, `sample_limit`
- **Output**: `{ generated_at, tenant_id, queues, attention_required }`

### ops_job_recover ★ 0.7+
Retry, park, or mark failed a durable async job with an audit entry.
- **Input**: `queue_name`, `job_id`, `action` (`retry`|`park`|`mark_failed`), `reason`
- **Output**: `{ queue_name, job_id, action, previous_status, new_status, recovered, recovered_at }`

### ops_data_quality_get ★ 0.7+
Run data-quality checks for malformed lifecycle/stage values, missing canonical subjects, orphaned actor links, missing search-index rows, stuck context indexing work, stale Raw Context processing receipts, retryable Raw Context failures, and stuck Raw Context extraction attempts.
- **Input**: `sample_limit`, `include_clean`
- **Output**: `{ generated_at, checks, summary }`

### ops_data_quality_repair ★ 0.7+
Repair only deterministic, low-risk data-quality findings. Defaults to dry run.
- **Input**: `check_name` (`activities_missing_canonical_subject`|`current_context_missing_search_index`|`stuck_context_outbox_processing`|`stale_raw_context_sources_processing`|`stuck_raw_context_extraction_attempts_running`|`failed_raw_context_sources_retryable`|`stuck_agent_turns_running`), `dry_run`, `limit`
- **Output**: `{ check_name, dry_run, action, repaired_count, event_id? }`

### ops_audit_get ★ 0.7+
Retrieve tenant-scoped audit events.
- **Input**: `object_type`, `object_id`, `actor_id`, `event_type`, `since`, `limit`
- **Output**: `{ audit_events, total }`

### ops_privacy_export ★ 0.7+
Export all directly attached subject data for privacy or legal review.
- **Input**: `subject_type`, `subject_id`
- **Output**: `{ exported_at, tenant_id, subject_type, subject_id, subject, activities, context_entries, assignments, events }`

### ops_pii_redact ★ 0.7+
Redact direct PII fields from a contact or account. Defaults to dry run.
- **Input**: `subject_type` (`contact`|`account`), `subject_id`, `reason`, `dry_run`
- **Output**: `{ subject_type, subject_id, dry_run, redacted_fields, event_id? }`

### ops_privacy_delete ★ 0.7+
Delete a customer record for privacy compliance after review. Defaults to dry run and reports linked-row counts.
- **Input**: `subject_type`, `subject_id`, `reason`, `dry_run`
- **Output**: `{ subject_type, subject_id, dry_run, deleted, affected, event_id? }`

### ops_retention_apply ★ 0.7+
Apply tenant retention cleanup to supported operational tables. Defaults to dry run.
- **Input**: `older_than_days`, `targets` (`events`|`ops_recovery_log`|`context_outbox_complete`|`idempotency_keys`), `dry_run`
- **Output**: `{ dry_run, older_than_days, results }`

## Webhook Tools

### webhook_create
Register an HTTP endpoint to receive event notifications.
- **Input**: `url` (required), `events` (required array of event types), `description`
- **Output**: `{ webhook }` — includes the generated signing secret once for setup

### webhook_get
Get endpoint details.
- **Input**: `id` (required)
- **Output**: `{ webhook }` — includes masked signing-secret state, not the full secret

### webhook_reveal_secret
Reveal the full signing secret for receiver setup or repair.
- **Input**: `id` (required)
- **Output**: `{ id, secret, secret_masked }`

### webhook_rotate_secret
Regenerate the signing secret. The previous secret stops verifying new deliveries immediately.
- **Input**: `id` (required)
- **Output**: `{ webhook, secret, secret_masked }`

### webhook_list
List registered endpoints.
- **Input**: `active`, `limit`, `cursor`
- **Output**: `{ webhooks, next_cursor, total }`

### webhook_list_deliveries
List delivery attempts for an endpoint.
- **Input**: `endpoint_id` (required), `status` (delivered|failed|pending), `limit`, `cursor`
- **Output**: `{ deliveries, next_cursor, total }`

### webhook_update
Update endpoint URL, events, active status, or description.
- **Input**: `id` (required), `patch`
- **Output**: `{ webhook }`

### webhook_delete
Remove a webhook endpoint.
- **Input**: `id` (required)
- **Output**: `{ deleted: true }`

## Custom Field Tools

### custom_field_create
Define a custom field for a customer record type.
- **Input**: `object_type` (required: contact|account|opportunity|activity|use_case), `field_name` (required, snake_case), `field_type` (required: text|number|boolean|date|select|multi_select), `label` (required), `required`, `options` (for select types), `default_value`
- **Output**: `{ custom_field }`

### custom_field_list
List all custom fields for an object type.
- **Input**: `object_type` (required)
- **Output**: `{ custom_fields }`

### custom_field_update
Update a field's label, required flag, options, or sort order.
- **Input**: `id` (required), `patch`
- **Output**: `{ custom_field }`

### custom_field_delete
Remove a custom field definition.
- **Input**: `id` (required)
- **Output**: `{ deleted: true }`

## Email Tools

### email_create
Draft an outbound email. CRMy resolves sender identity from the actor mailbox first, then tenant fallback provider. When `require_approval` is true (default), automatically submits a HITL approval request. Delivered sends are recorded as account activity and CRMy-authored context, not customer-authored evidence.
- **Input**: `to_address` (required), `subject` (required), `body_html`, `body_text`, `contact_id`, `account_id`, `opportunity_id`, `use_case_id`, `require_approval`
- **Output**: `{ email, sender, hitl_request_id? }`

### email_get
Get an email by ID.
- **Input**: `id` (required)
- **Output**: `{ email }`

### email_search
Search emails.
- **Input**: `contact_id`, `account_id`, `opportunity_id`, `use_case_id`, `q`, `status`, `limit`, `cursor`
- **Output**: `{ emails, next_cursor, total }`

### mailbox_connection_list
List mailbox connections visible to the current actor, including context sync and sender capabilities.
- **Input**: none
- **Output**: `{ mailbox_connections, total, summary }`

### mailbox_connection_start
Start Gmail or Outlook OAuth for the current human-linked actor without opening the CRMy web UI. The tool returns `auth_url`; the user opens that URL in a browser to complete provider consent, then returns to MCP/CLI and checks `mailbox_connection_list`. Pure agent actors without a linked human user cannot connect a mailbox.
- **Input**: `provider` (`google` or `microsoft`), `email_address`, `display_name`, `context_sync_enabled`, `send_enabled`, `provider_draft_enabled`, `is_default_sender`, `account_ingest_scope`
- **Output**: `{ connection, auth_url, oauth_ready, setup_check, status, message }`

### calendar_connection_start
Start Google or Microsoft calendar OAuth for the current human-linked actor without opening the CRMy web UI. The tool returns `auth_url`; the user opens that URL in a browser to complete provider consent, then returns to MCP/CLI and checks `calendar_connection_list`. Pure agent actors without a linked human user cannot connect a calendar.
- **Input**: `provider` (`google` or `microsoft`), `email_address`, `display_name`, `meeting_ingest_scope`
- **Output**: `{ connection, auth_url, oauth_ready, setup_check, status, message }`

### email_draft_preview
Generate a customer email draft preview from Memory, Signals, source email, linked records, and selected sender identity.
- **Input**: `source_email_message_id`, `subject_type`, `subject_id`, `contact_id`, `account_id`, `opportunity_id`, `use_case_id`, `to_address`, `to_name`, `intent`, `instruction`, `tone`, `target`
- **Output**: `{ subject, body_text, sender, context_used, warnings, model_metadata }`

### email_draft_save
Save, request approval, push a provider draft when supported, or send a governed customer email draft. Sends use the actor mailbox when send-enabled, otherwise tenant fallback provider; no sender allows save-draft only. After provider delivery, CRMy records the sent email as account activity and CRMy-authored context so later agents can see what your team promised or asked without treating it as the customer's words.
- **Input**: draft preview fields plus `subject`, `body_text`, `body_html`, `draft_origin`, `draft_target`, `delivery_action`, `generation_metadata`
- **Output**: `{ email, sender, hitl_request_id?, event_id, status }`

### email_provider_set / email_provider_get
Configure or inspect the tenant fallback/shared email provider. Customer drafts prefer the actor mailbox when one is send-enabled; this provider is used when no actor mailbox sender is available and for sequence or system-generated email. Secrets are redacted in reads.

## Customer Record Resolution

### customer_record_resolve
Resolve GTM/customer references across accounts, contacts, opportunities, and use cases. Use this when an agent needs to identify a customer record before briefing, searching, drafting, or taking action.

- **Input**: `query` or `text` (one required), `subject_type` (`account` | `contact` | `opportunity` | `use_case` | `any`, default `any`), `account_hint`, `confidence_threshold`, `limit`
- **Output**: `{ resolver, query, subject_type, subjects, skipped, proposed_records, account_scope, records_examined, resolution_summary }`
  - `subjects`: resolved customer records, including account scope and parent subject metadata where applicable
  - `skipped`: ambiguity or low-confidence receipts with candidate records and recommended next action when available
  - `proposed_records`: possible new contacts/accounts/opportunities/use cases that need review; CRMy does not create them automatically
  - `account_scope`: the account-level directory CRMy checked before linking child records

This tool shares the same account-first resolver used by Raw Context extraction. Opportunities and use cases should usually resolve inside a matched account. If CRMy is not sure, it returns an ambiguity receipt or reviewed proposal instead of guessing.

For messy meeting transcripts, email threads, notes, research, or any source that should become Signals and Memory, call `context_ingest_auto` instead of trying to resolve every mention manually.

### Compatibility: entity_resolve
Resolve a name, stored alias/abbreviation, email, domain, or partial string to a contact or account UUID. This is a compatibility/simple lookup tool for older harnesses. Prefer `customer_record_resolve` for current agent workflows, especially when account scope, child records, or ambiguity receipts matter.

- **Input**: `query` (required), `entity_type` (`contact` | `account` | `any`, default `any`), `context_hints` (`{ company_name?, email_domain?, title?, email? }`), `actor_id` (defaults to requesting actor), `limit` (1–10, default 5)
- **Output**: `{ status, entity_type, resolved, candidates }`
  - `status`: `"resolved"` | `"ambiguous"` | `"not_found"`
  - `resolved`: `{ id, name, confidence, match_tier, affinity_score }` — present when `status = "resolved"`
  - `candidates`: array of the same shape — present when `status = "ambiguous"`

Resolution tiers (in order): email/domain exact → name exact → alias exact → ILIKE substring → trigram similarity. Actor affinity (prior interaction history) is used as a tiebreaker when multiple candidates match at the same tier.

When `status = "ambiguous"`, surface the candidates to a human via `hitl_submit_request` before proceeding.

## Analytics Tools

### crm_search
Search across all customer records.
- **Input**: `query` (required), `limit`
- **Output**: `{ contacts, accounts, opportunities }`

### pipeline_forecast
Get pipeline forecast.
- **Input**: `period` (month|quarter|year), `owner_id`
- **Output**: `{ committed, best_case, pipeline, win_rate, avg_deal_size, avg_cycle_days }`

### account_health_report
Get health report for an account.
- **Input**: `account_id` (required)
- **Output**: `{ health_score, open_opps, open_opp_value, last_activity_days, contact_count, activity_count_30d }`

## Action Policy And HITL Tools

CRMy is the policy boundary between agent inference and operational change. Signals can be inferred freely, but writes that affect forecast, customer engagement, assignments, Current Memory, or systems of record pass through scoped tools, Action Policies, HITL approvals, and audit receipts.

Built-in Action Policies protect high-risk operations even before custom HITL rules run:
- Forecast category changes require approval for non-user actors.
- Signal promotion requires evidence and may require approval when confidence is low.
- External writebacks evaluate source authority, allowed fields, writeback mode, idempotency, and object write scopes.
- Workflow field updates create approval requests instead of directly mutating sensitive fields.

### hitl_submit_request
Submit an approval request before high-impact actions.
- **Input**: `action_type` (required), `action_summary` (required), `action_payload` (required), `auto_approve_after_seconds`
- **Output**: `{ request_id, status }`

### hitl_check_status
Check status of a HITL request.
- **Input**: `request_id` (required)
- **Output**: `{ status, review_note }`

### hitl_list_pending
List pending requests.
- **Input**: `limit`
- **Output**: `{ requests }`

### hitl_resolve
Approve or reject a request.
- **Input**: `request_id` (required), `decision` (required: approved|rejected), `note`
- **Output**: `{ request }`

## Context Engine Tools

Use these tools with the Active Context / Memory distinction in mind:

- **Retrieval tools** load persistent Memory and related customer state into the model's temporary Active Context: `action_context_get`, `briefing_get`, `context_find`, `context_get`, and, for specialized cases, `context_search`, `context_semantic_search`, `context_list`, `context_lineage_get`, and `context_diff`.
- **Ingestion tools** accept Raw Context and let CRMy extract evidence-backed Signals: `context_ingest_auto`, `context_ingest`, and `context_extract`.
- **Promotion tools** turn confirmed Signals into Current Memory: `context_signal_group_promote` and `context_signal_promote`.
- **Governance tools** keep Memory safe to act on: Handoff, stale review, rejection, supersession, and review tools.

### context_add
Advanced direct write for Current Memory or an evidence-backed Signal about a customer record. For raw transcripts, emails, meeting notes, research, or other messy input, use `context_ingest_auto` or `context_ingest` so CRMy records Raw Context, extracts Signals, and promotes high-confidence Memory.
- **Input**: `subject_type` (required), `subject_id` (required), `context_type` (required), `body` (required), `title`, `confidence` (0.0–1.0), `memory_status`, `evidence`, `tags`, `valid_until`, `structured_data`, `source_activity_id`, `source`, `source_ref`
- **Output**: `{ context_entry, event_id, validation_warnings? }`
- **Lifecycle**: `active` is Current Memory. `signal` is inferred context and requires evidence. Memory past `valid_until` needs review before agents rely on it. Use `context_review` to reconfirm, `context_signal_reject` to dismiss Signals, and `context_supersede` for `superseded` states instead of creating those states directly.
- **Evidence shape**: each item should include `source_type` plus at least one of `source_id`, `source_ref`, `source_url`, or `snippet`. Prefer `snippet`, `speaker`, `observed_at`, `confidence`, and `rationale` for important claims.

### context_get
Get a context entry by ID.
- **Input**: `id` (required)
- **Output**: `{ context_entry }`

### context_find
Consolidated retrieval for Current Memory, Signals, stale Memory, and workspace context search. Prefer this for ordinary agent retrieval instead of choosing between `context_list`, `context_search`, `context_stale`, and `context_signal_group_list`.
- **Input**: `mode` (`recent` | `search` | `signals` | `stale`, default `recent`), `query`, `subject_type`, `subject_id`, `context_type`, `memory_status`, `current_only`, `attention_only`, `structured_data_filter`, `limit`, `cursor`
- **Output**:
  - `mode="recent"` or `mode="search"`: `{ mode, context_entries, next_cursor?, total, recommended_next_tools }`
  - `mode="signals"`: `{ mode, signal_groups, next_cursor, total, recommended_next_tools }`
  - `mode="stale"`: `{ mode, stale_entries, context_entries, total, recommended_next_tools }`
- **Use when**: an agent needs to retrieve Memory or Signals but does not need a lower-level specialized retrieval tool.

### context_list
Specific/advanced listing tool for Current Memory or Signals with filters. Prefer `context_find` for ordinary retrieval.
- **Input**: `subject_type`, `subject_id`, `context_type`, `authored_by`, `memory_status` (`active` by default, or `signal`), `is_current`, `tag`, `query`, `structured_data_filter`, `limit`, `cursor`
- **Output**: `{ context_entries, next_cursor, total }`
- **Note**: `structured_data_filter` is a JSONB containment filter — e.g. `{ "status": "open" }` finds entries whose `structured_data` contains that key/value pair.

### context_raw_source_list
List Raw Context processing records.
- **Input**: `source_type`, `status`, `subject_type`, `subject_id`, `limit`, `cursor`
- **Output**: `{ raw_context_sources, next_cursor, total }`
- **Use when**: an agent needs to explain where context came from, whether ingestion succeeded, how many Signals or Memory entries were produced, or why a source failed/skipped.

### context_raw_source_get
Get one Raw Context processing record.
- **Input**: `id` (required)
- **Output**: `{ raw_context_source }`

### context_search
Specific/advanced full-text search across Memory by default using PostgreSQL GIN index. Prefer `context_find` with `mode="search"` for ordinary keyword search.
- **Input**: `query` (required), `subject_type`, `subject_id`, `context_type`, `tag`, `current_only`, `memory_status`, `limit`, `structured_data_filter`
- **Output**: `{ context_entries, total }` — results ranked by relevance

### context_signal_group_list
Specific Signal-group listing tool. Prefer `context_find` with `mode="signals"` for ordinary Signal review queues.
- **Input**: `status`, `subject_type`, `subject_id`, `context_type`, `attention_only`, `limit`, `cursor`
- **Output**: `{ signal_groups, next_cursor, total }`; each group includes `readiness` with status, reasons, blockers, next actions, score components, and confirmation gates.
- **Use when**: an agent needs to know which inferred claims are ready for Memory, need evidence/detail, require approval, or are challenged by conflicting evidence.

### context_signal_group_get
Inspect one corroborated Signal with supporting/conflicting source evidence.
- **Input**: `id` (required)
- **Output**: `{ signal_group }`, including full `readiness` details for “why not Memory yet?”

### context_signal_group_complete_details
Add missing typed Signal detail and recompute readiness before confirmation.
- **Input**: `id` (required), `structured_data_patch` (required object), optional `idempotency_key`
- **Output**: `{ signal_group, context_entry, validation_warnings, event_id, mutation }`; `signal_group` includes recomputed readiness.
- **Use when**: readiness says a Signal needs more detail, such as stakeholder role, stakeholder sentiment, risk severity, buying-process stage, or another schema-backed field.
- **Boundary**: updates only unconfirmed Signal structured data. It does not edit CRM records, promote Memory, create activities, or execute writebacks.

### context_lineage_get
Trace Raw Context through Signals, Memory, Active Context retrievals, Handoffs, governed writebacks, and audit events.
- **Input**: one of `subject_type` + `subject_id`, `context_entry_id`, `signal_group_id`, or `raw_context_source_id`
- **Output**: `{ lineage: { nodes, edges, outcomes, summary } }`
- **Use when**: an agent needs to explain why a Memory exists, what evidence supports it, whether Action Context was assembled before action, whether a human reviewed it, or whether it produced a system-of-record writeback.
- **Outcomes**: summarizes recent downstream action results, pending human/writeback work, failed side effects, completed counts, and recommended follow-up so agents can continue safely after an action.

### context_signal_group_promote
Promote a confirmed corroborated Signal into Current Memory.
- **Input**: `id` (required)
- **Output**: `{ signal_group, context_entry, mutation }`

### context_signal_handoff
Route a Signal to Handoff when policy, conflict, or risk requires human review before it becomes Memory.
- **Input**: `id` (required), optional `assignee_actor_id`, `reason`, `note`, `priority` (`low` | `normal` | `high` | `urgent`), `idempotency_key`
- **Output**: `{ signal_group, hitl_request, mutation }`
- **Use when**: the Signal is useful but should not yet guide forecast, customer engagement, assignment, or system-of-record writeback without approval.

### context_signal_group_reject
Dismiss a corroborated Signal while preserving evidence for audit.
- **Input**: `id` (required), `reason`
- **Output**: `{ signal_group, mutation }`

### context_signal_promote
Advanced direct promotion for one evidence-backed Signal. Prefer `context_signal_group_promote` for ordinary agent workflows because it uses grouped evidence and readiness.
- **Input**: `id` (required), optional edits: `body`, `title`, `structured_data`, `confidence`, `tags`
- **Output**: `{ context_entry, event_id }`

### context_signal_reject
Reject a Signal while preserving its evidence for audit.
- **Input**: `id` (required), `reason`
- **Output**: `{ context_entry, event_id }`

### context_supersede
Supersede an existing context entry with updated content. Marks the old entry as `is_current = false`.
- **Input**: `id` (required), `body` (required), `title`, `structured_data`, `confidence`, `tags`
- **Output**: `{ context_entry, superseded, event_id }`

### context_review
Mark a context entry as reviewed (still accurate). Sets `reviewed_at = now()`.
- **Input**: `id` (required), `extend_days` (optional — extend `valid_until` by N days)
- **Output**: `{ context_entry }`

### context_review_batch ★ 0.7+
Mark up to 200 context entries as reviewed in a single call. Processes in parallel batches of 20 with `Promise.allSettled` — individual failures do not block others.
- **Input**: `entry_ids` (required, array, max 200), `extend_days` (optional — extend `valid_until` by N days for all updated entries)
- **Output**: `{ updated, not_found, extend_days, message }`

### context_bulk_mark_stale ★ 0.7+
Invalidate up to 200 context entries in a single parameterized UPDATE. Sets `valid_until = now()` on all matching current entries. Optionally appends a reason tag to each entry's `tags` array.
- **Input**: `entry_ids` (required, array, max 200), `reason` (optional — tag added to each invalidated entry, e.g. `"superseded-by-q2-research"`)
- **Output**: `{ updated, not_found_or_already_stale, reason, message }`

### context_stale
Specific Memory Health listing tool for Current Memory where `valid_until` has passed and the claim needs review before use. Prefer `context_find` with `mode="stale"` for ordinary stale-memory retrieval.
- **Input**: `subject_type`, `subject_id`, `limit`
- **Output**: `{ stale_entries, total }`

### context_diff
Catch-up diff for a customer record — shows what changed since a given timestamp. Ideal for daily agent check-ins.
- **Input**: `subject_type` (required), `subject_id` (required), `since` (required — ISO timestamp or relative: `"7d"`, `"24h"`, `"30m"`), `limit` (default 50, max 100 per bucket)
- **Output**: `{ subject_type, subject_id, since, limit, new_entries, superseded_entries, newly_stale, resolved_entries, truncated, summary: { new, superseded, newly_stale, resolved, truncated } }`
- **Note**: CRMy caps each bucket independently. If `summary.truncated` marks a bucket true, narrow `since` or fetch specific entries before relying on the diff as complete.

### context_ingest
Ingest Raw Context (transcript, email, meeting notes, etc.) and auto-extract structured Signals. Creates an activity as provenance and runs the full extraction pipeline.
- **Input**: `subject_type` (required), `subject_id` (required), `document` (required), `source_label`
- **Output**: `{ extracted_count, memory_created, signals_created, skipped, signals, memory_entries, context_entries, activity_id, raw_context_source, processing_receipt }`

### context_ingest_auto
Ingest Raw Context and automatically resolve mentioned contacts/accounts before extraction. Requires the configured Workspace Agent: the model identifies likely people and accounts, then CRMy grounds them against existing records before creating Signals or Memory.
- **Input**: `document` (required), `source_label`, `context_type`, `confidence_threshold`
- **Output**: `{ subjects_resolved, entries_created, memory_created, signals_created, skipped, processing_receipts, low_confidence_skipped }`

### context_extract
Re-run the automatic context extraction pipeline on a specific activity. Useful for backfilling or retrying after an error.
- **Input**: `activity_id` (required)
- **Output**: `{ extracted_count }`

### context_stale_assign
Trigger the Memory Health review loop for the current tenant on-demand. Normally runs automatically every 60 seconds.
- **Input**: `limit` (1–100, default 20)
- **Output**: `{ assignments_created }`

### briefing_get
Get a unified briefing for any customer record — assembles the record, related objects, activity timeline, open assignments, Current Memory, separate unconfirmed Signals, and Memory Health warnings in one call.
- **Input**: `subject_type` (required), `subject_id` (required), `since`, `context_types`, `include_stale`, `format` (`"json"` | `"text"`), `context_radius` (`"direct"` | `"adjacent"` | `"account_wide"`, default `"direct"`), `token_budget`, `token_budget_profile` (`tiny`, `standard`, `deep`, `evidence_heavy`), `evidence_mode` (`summary`, `full`, `none`)
- **Output (json)**: `{ briefing: { subject, subject_type, related_objects, activities, open_assignments, context_entries, signals?, signal_groups?, staleness_warnings, active_sequences?, contradiction_warnings?, adjacent_context?, token_estimate?, truncated?, dropped_entries? } }`
- **Output (text)**: `{ briefing_text }` — a formatted string ready for prompt injection
- **Active Context**: this is the main retrieval tool for moving persistent Memory and relevant Signals into the model's current working set before action.
- **Note**: `token_budget` enables priority-ranked, budget-constrained packing across direct and adjacent/account-wide Memory entries. `token_budget_profile` gives named presets: `tiny` for routing/classification, `standard` for ordinary action prep, `deep` for account/deal review, and `evidence_heavy` for writeback or Memory promotion. Explicit `token_budget` wins over a profile. Entries are scored by `effective_confidence × priority_weight` with freshness decay, evidence boost, and action-aware ranking when called through Action Context. `evidence_mode: "summary"` returns compact evidence references by default; use `"full"` only when the agent needs deeper proof, or `"none"` for cheapest context scanning. `context_packing` reports the effective profile, budget, evidence mode, and ranking strategy.

### action_context_get
Assemble action-aware customer context before an agent prepares work. This is an intelligence packet first: it helps the agent understand Memory, Signals, stale context, policy, source ownership, warnings, proof, and whether review is needed for the proposed action.
- **Input**: `subject_type` (required), `subject_id` (required), `since`, `context_types`, `include_stale`, `context_radius`, `token_budget`, `token_budget_profile`, `evidence_mode`, `emit_retrieval_event` (default `true`), and optional `proposed_action`
- **Proposed action types**: `customer_outreach`, `assignment_create`, `memory_promote`, `record_update`, `external_writeback`
- **Output**: `{ action_context: { operating_mode, guidance, action_packet, briefing, readiness, checks, allowed_actions, required_handoffs, proof } }`
- **Action packet**: `action_packet` is the agent-ready decision packet. It separates `use_as_truth`, `use_with_caution`, `do_not_use_as_truth`, `evidence_to_cite`, `source_posture`, `recommended_actions`, `action_boundaries`, `human_unblock`, and `next_tools` so an agent can act, caveat, or ask for review without re-interpreting the full briefing.
- **Readiness states**: `ready`, `review_needed`, or `blocked`
- **Operating modes**: use the readiness and checks as `inform` for low-risk work, `warn` when stale/inferred/conflicting context should be visible but not blocking, and `require_review` when execution needs human approval.
- **Handoffs**: `required_handoffs` contains execution-blocking review work. Non-blocking stale Memory, unconfirmed Signals, and open-work warnings remain in `guidance.warning_reasons` and `checks`.
- **Low-friction examples**: briefing, search, summarization, internal notes, draft preparation, Raw Context ingest, and reviewable Signal creation should generally remain fast.
- **Review examples**: automatic customer email send, sequence send, workflow-triggered outreach, forecast/stage/amount/owner changes, external writeback, external commitments, out-of-scope records, or using unconfirmed Signals as fact should require review when policy or risk says so.
- **Proof**: when `emit_retrieval_event` is true, CRMy records an `action_context.retrieved` event with compact metadata: context IDs, Signal group IDs, stale count, contradiction count, readiness status, risk level, and proposed action type.
- **Boundary**: this tool does not create activities, promote Memory, update records, create handoffs, or execute writebacks. It only assesses readiness and records retrieval proof. When it returns `human_unblock.required`, call `action_context_request_human_unblock` to create the tracked human decision.
- **Token control**: if no explicit profile or budget is supplied, CRMy infers a budget profile from `proposed_action` for common workflows. For example, customer outreach uses `standard`, assignment/agent tasks use `tiny`, and external writeback or Memory promotion uses `evidence_heavy`.

### action_context_request_human_unblock
Create a durable human approval or assignment from Action Context review guidance. This composes `action_context_get`, a handoff snapshot, and either HITL or Assignment creation so the reviewer gets the packet, proof, and agent reasoning.
- **Input**: `subject_type` (required), `subject_id` (required), optional `proposed_action`, `request_type` (`"auto"` | `"approval"` | `"assignment"`), `title`, `question`, `assignee_id`, `reviewer_id`, `priority`, `due_at`, `sla_minutes`, `reasoning`, `tools_called`, `idempotency_key`
- **Output**: approval path returns `{ created_type: "approval", request_id, status, snapshot_id, event_id, action_packet, mutation }`; assignment path returns `{ created_type: "assignment", assignment_id, assignment, snapshot_id, event_id, action_packet, mutation }`
- **Use when**: `action_context_get` returns `operating_mode: "require_review"` or `action_packet.human_unblock.required: true`, and the agent needs a concrete human decision before acting.
- **Notes**: `request_type: "auto"` creates approval by default, or assignment when Action Context recommends assignment/source-conflict review and an `assignee_id` is provided. Use explicit `request_type: "assignment"` when a specific owner should take over.

## Actor Tools

### actor_register
Register a new actor (human or agent). Agents auto-register on first MCP connect.
- **Input**: `display_name` (required), `actor_type` (required: `human`|`agent`|`system`), `agent_identifier`, `agent_model`, `scopes`, `metadata`
- **Output**: `{ actor, event_id }`

### actor_get
Get an actor by ID.
- **Input**: `id` (required)
- **Output**: `{ actor }`

### actor_list
List actors with optional filters.
- **Input**: `actor_type`, `is_active`, `query`, `limit`, `cursor`
- **Output**: `{ actors, next_cursor, total }`

### actor_update
Update an actor.
- **Input**: `id` (required), `patch` (fields to update)
- **Output**: `{ actor, event_id }`

### actor_whoami
Return the current actor identity based on the authenticated session. Always allowed — no scope required.
- **Input**: (none)
- **Output**: `{ tenant_id, actor_id, actor_type, role }`

### actor_expertise
Query actor Memory contributions. Two modes:
- **Mode 1** — pass `actor_id` to see which subjects this actor has contributed context about (ordered by contribution count). Useful for routing reviews.
- **Mode 2** — pass `subject_type` + `subject_id` to find the actors who know most about that entity.
- **Input**: `actor_id`, `subject_type`, `subject_id`, `limit` (at least one of actor_id or subject_type+subject_id required)
- **Output (by_actor)**: `{ mode: "by_actor", actor_id, total_entries, subjects, top_context_types }`
- **Output (by_subject)**: `{ mode: "by_subject", subject_type, subject_id, experts }`

## Systems of Record Tools

These tools are intentionally operator-facing. They are visible in an MCP session only when the actor has explicit systems scopes. Generic `read` and `write` shortcuts do not grant systems-of-record access. Governed external writeback tools also require the relevant object write scope, such as `contacts:write` or `opportunities:write`, before CRMy will preview, review, or execute a write.

HubSpot is the first certified connector path. Salesforce, Databricks, and Snowflake use the same governed interfaces, but should be live-tested in the target environment before production rollout. `context_entry` mappings are reserved for the connector-author workflow and currently produce reviewable sync conflicts instead of silently creating memory.

### sor_system_create
Create a governed external system connection for HubSpot, Salesforce, Databricks, or Snowflake. Credentials are encrypted and redacted.
- **Input**: `name` (required), `system_type` (required), `auth_type` (required), `credentials`, `config`, `sync_settings`
- **Output**: `{ system, event_id, mutation }`

### sor_system_list
List configured systems of record with health and credential status.
- **Input**: `system_type`, `status`, `limit`, `cursor`
- **Output**: `{ systems, next_cursor, total }`

### sor_system_get
Get one system connection with redacted configuration.
- **Input**: `id` (required)
- **Output**: `{ system }`

### sor_system_update
Update a connection, including encrypted credentials, sync settings, or status.
- **Input**: `id` (required), `patch`
- **Output**: `{ system, event_id, mutation }`

### sor_system_delete
Delete a connection and related mapping/sync metadata.
- **Input**: `id` (required)
- **Output**: `{ deleted, event_id }`

### sor_system_test
Validate credentials and test connectivity.
- **Input**: `id` (required)
- **Output**: `{ result }`

### sor_discover
Discover available objects or fields from a configured source.
- **Input**: `system_id` (required), `object_name`
- **Output**: `{ data }`

### sor_mapping_upsert
Create or update a mapping from an external object/table to a typed CRMy object.
- **Input**: `system_id` (required), `object_type` (required), `external_object` (required), `external_id_field`, `watermark_field`, `field_mapping`, `readable_fields`, `writable_fields`, `source_authority`, `writeback_mode`, `writeback_config`, `allow_source_loop`, `is_active`
- **Authority behavior**: `external` can update CRMy directly; `crmy`, `read_only`, and `approval_required` create conflicts instead of overwriting existing records; `bidirectional` updates only when CRMy has not diverged from the last synced value.
- **Output**: `{ mapping, event_id, mutation }`

### sor_mapping_list
List mappings for systems of record.
- **Input**: `system_id`, `object_type`, `is_active`, `limit`, `cursor`
- **Output**: `{ mappings, next_cursor, total }`

### sor_mapping_delete
Delete a mapping when it should no longer sync or govern writebacks.
- **Input**: `id` (required), `idempotency_key`
- **Output**: `{ deleted, event_id }`

### sor_sync_run
Run a sync. Synced changes emit normal CRMy events with source metadata for Automations, Sequences, audit, and context extraction.
- **Input**: `system_id` (required), `mapping_id`, `mode`
- **Output**: `{ run }`

### sor_sync_status
List recent sync runs and status counts.
- **Input**: `system_id`, `status`, `limit`, `cursor`
- **Output**: `{ runs, next_cursor, total }`

### sor_conflict_list
List source/local conflicts.
- **Input**: `system_id`, `status`, `object_type`, `object_id`, `limit`, `cursor`
- **Output**: `{ conflicts, next_cursor, total }`

### sor_conflict_resolve
Resolve a conflict by choosing local, choosing external, or ignoring it.
- **Input**: `id` (required), `resolution` (required), `note`
- **Output**: `{ conflict, applied, event_id }`

### sor_writeback_preview
Preview an external writeback before creating a request.
- **Input**: `system_id` (required), `mapping_id`, `object_type` (required), `external_object` (required), `external_record_id`, `operation` (required), `writeback_mode` (required), `payload`
- **Output**: `{ preview }`
- **Policy**: preview includes allowed/blocked status, approval requirement, warnings, mapping source authority, and the Action Policy decision.

### sor_writeback_request
Create a governed external writeback request. High-risk writes enter approval-required status.
- **Input**: `system_id` (required), `mapping_id`, `object_type` (required), `object_id`, `external_object` (required), `external_record_id`, `operation` (required), `writeback_mode` (required), `payload`, `require_approval`, `idempotency_key`
- **Output**: `{ writeback, event_id, mutation }`
- **Safety**: idempotency keys can be reused only for the same payload and target. Blocked policy results become rejected requests instead of approval tasks.

### sor_writeback_review
Approve or reject a governed external writeback request before execution. Approvals can also happen through the Handoffs queue when a linked HITL request exists.
- **Input**: `id` (required), `decision` (`approved` or `rejected`), `note`, `idempotency_key`
- **Output**: `{ writeback, event_id }`

### sor_writeback_execute
Execute an approved governed external writeback through its configured connector adapter.
- **Input**: `id` (required), `idempotency_key`
- **Output**: `{ writeback, event_id, mutation }`

### sor_writeback_status
List external writeback requests.
- **Input**: `system_id`, `status`, `limit`, `cursor`
- **Output**: `{ writebacks, next_cursor, total }`

## Meta Tools

### schema_get
Get the schema for a customer record type.
- **Input**: `object_type` (required: contact|account|opportunity|activity)
- **Output**: `{ standard_fields, custom_fields_schema }`

### tenant_get_stats
Get high-level statistics for the current actor scope. Admins and owners see tenant-wide totals; managers and members see their visible book of business.
- **Input**: (none)
- **Output**: `{ contacts, accounts, opportunities, activities, open_pipeline_value }`
