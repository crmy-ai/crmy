# crmy.ai MCP Tools Reference

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
Delete a contact (admin/owner only).
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

## Company Tools

### account_create
Create a new company.
- **Input**: `name` (required), `domain`, `industry`, `employee_count`, `annual_revenue`, `currency_code`, `website`, `parent_id`, `aliases`, `tags`, `custom_fields`
- **Output**: `{ account, event_id }`

### account_get
Get a company with its contacts and open opportunities.
- **Input**: `id` (required)
- **Output**: `{ account, contacts, open_opportunities }`

### account_search
Search companies.
- **Input**: `query`, `industry`, `owner_id`, `min_revenue`, `tags`, `limit`, `cursor`
- **Output**: `{ accounts, next_cursor, total }`

### account_update
Update a company.
- **Input**: `id` (required), `patch` (object with fields to update, including `aliases: string[]`)
- **Output**: `{ account, event_id }`

### account_set_health_score
Set company health score (0-100).
- **Input**: `id` (required), `score` (required), `rationale`
- **Output**: `{ account, event_id }`

### account_get_hierarchy
Get parent/child hierarchy for a company.
- **Input**: `id` (required)
- **Output**: `{ root, children, depth }`

### account_delete
Delete a company (admin/owner only).
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
Delete an opportunity (admin/owner only).
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

## Note Tools

### note_create
Add a threaded note to any customer record.
- **Input**: `object_type` (required: contact|account|opportunity|activity|use_case), `object_id` (required), `body` (required), `parent_id`, `visibility` (internal|external), `mentions`, `pinned`
- **Output**: `{ note }`

### note_get
Get a note with its threaded replies.
- **Input**: `id` (required)
- **Output**: `{ note, replies }`

### note_list
List notes for a customer record. Pinned notes appear first.
- **Input**: `object_type` (required), `object_id` (required), `visibility`, `pinned`, `limit`, `cursor`
- **Output**: `{ notes, next_cursor, total }`

### note_update
Update a note's body, visibility, or pinned status.
- **Input**: `id` (required), `body`, `visibility`, `pinned`
- **Output**: `{ note }`

### note_delete
Delete a note and its replies.
- **Input**: `id` (required)
- **Output**: `{ deleted: true }`

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
Soft delete a use case.
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
Run data-quality checks for malformed lifecycle/stage values, missing canonical subjects, orphaned actor links, missing search-index rows, and stuck context indexing work.
- **Input**: `sample_limit`, `include_clean`
- **Output**: `{ generated_at, checks, summary }`

### ops_data_quality_repair ★ 0.7+
Repair only deterministic, low-risk data-quality findings. Defaults to dry run.
- **Input**: `check_name` (`activities_missing_canonical_subject`|`current_context_missing_search_index`|`stuck_context_outbox_processing`), `dry_run`, `limit`
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
- **Output**: `{ webhook }` — includes `signing_secret`

### webhook_get
Get endpoint details.
- **Input**: `id` (required)
- **Output**: `{ webhook }` — includes `signing_secret`

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
Draft an outbound email. When `require_approval` is true (default), automatically submits a HITL approval request.
- **Input**: `to_address` (required), `subject` (required), `body_html`, `body_text`, `contact_id`, `account_id`, `opportunity_id`, `use_case_id`, `require_approval`
- **Output**: `{ email, hitl_request_id? }`

### email_get
Get an email by ID.
- **Input**: `id` (required)
- **Output**: `{ email }`

### email_search
Search emails.
- **Input**: `contact_id`, `status`, `limit`, `cursor`
- **Output**: `{ emails, next_cursor, total }`

## Identity Tools

### entity_resolve
Resolve a name, abbreviation, or partial string to a contact or account UUID. **Always call this before `contact_get` or `account_get` when you have a name but not a UUID — never guess an ID.**

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

## HITL Tools

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

### context_add
Store context/knowledge about a customer record.
- **Input**: `subject_type` (required), `subject_id` (required), `context_type` (required), `body` (required), `title`, `confidence` (0.0–1.0), `tags`, `valid_until`, `structured_data`, `source_activity_id`, `source`, `source_ref`
- **Output**: `{ context_entry, event_id, validation_warnings? }`

### context_get
Get a context entry by ID.
- **Input**: `id` (required)
- **Output**: `{ context_entry }`

### context_list
List context entries with filters.
- **Input**: `subject_type`, `subject_id`, `context_type`, `authored_by`, `is_current`, `tag`, `query`, `structured_data_filter`, `limit`, `cursor`
- **Output**: `{ context_entries, next_cursor, total }`
- **Note**: `structured_data_filter` is a JSONB containment filter — e.g. `{ "status": "open" }` finds entries whose `structured_data` contains that key/value pair.

### context_search
Full-text search across context entries using PostgreSQL GIN index.
- **Input**: `query` (required), `subject_type`, `subject_id`, `context_type`, `tag`, `current_only`, `limit`, `structured_data_filter`
- **Output**: `{ context_entries, total }` — results ranked by relevance

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
List stale context entries where `valid_until` has passed but `is_current` is still `true`.
- **Input**: `subject_type`, `subject_id`, `limit`
- **Output**: `{ stale_entries, total }`

### context_diff
Catch-up diff for a customer record — shows what changed since a given timestamp. Ideal for daily agent check-ins.
- **Input**: `subject_type` (required), `subject_id` (required), `since` (required — ISO timestamp or relative: `"7d"`, `"24h"`, `"30m"`)
- **Output**: `{ subject_type, subject_id, since, new_entries, superseded_entries, newly_stale, resolved_entries, summary: { new, superseded, newly_stale, resolved } }`

### context_ingest
Ingest a raw document (transcript, email, meeting notes, etc.) and auto-extract all structured context entries. Creates an activity as provenance and runs the full extraction pipeline.
- **Input**: `subject_type` (required), `subject_id` (required), `document` (required), `source_label`
- **Output**: `{ extracted_count, context_entries, activity_id }`

### context_extract
Re-run the automatic context extraction pipeline on a specific activity. Useful for backfilling or retrying after an error.
- **Input**: `activity_id` (required)
- **Output**: `{ extracted_count }`

### context_stale_assign
Trigger the stale context review loop for the current tenant on-demand. Normally runs automatically every 60 seconds.
- **Input**: `limit` (1–100, default 20)
- **Output**: `{ assignments_created }`

### briefing_get
Get a unified briefing for any customer record — assembles the record, related objects, activity timeline, open assignments, context entries, and staleness warnings in one call.
- **Input**: `subject_type` (required), `subject_id` (required), `since`, `context_types`, `include_stale`, `format` (`"json"` | `"text"`), `context_radius` (`"direct"` | `"adjacent"` | `"account_wide"`, default `"direct"`), `token_budget`
- **Output (json)**: `{ briefing: { record, related, activities, open_assignments, context, stale_warnings, adjacent_context?, token_estimate, truncated?, dropped_entries? } }`
- **Output (text)**: `{ briefing_text }` — a formatted string ready for prompt injection
- **Note**: `token_budget` enables priority-ranked, budget-constrained packing. Entries are scored by `effective_confidence × priority_weight` (with per-type half-life decay) and greedily packed. Pass `context_radius: "adjacent"` or `"account_wide"` to pull in context from related entities. When entries are dropped due to budget exhaustion, `dropped_entries` summarizes what was cut (context_type, title, confidence) so agents can request specific entries via `context_get`.

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
Query actor knowledge contributions. Two modes:
- **Mode 1** — pass `actor_id` to see which subjects this actor has contributed context about (ordered by contribution count). Useful for routing reviews.
- **Mode 2** — pass `subject_type` + `subject_id` to find the actors who know most about that entity.
- **Input**: `actor_id`, `subject_type`, `subject_id`, `limit` (at least one of actor_id or subject_type+subject_id required)
- **Output (by_actor)**: `{ mode: "by_actor", actor_id, total_entries, subjects, top_context_types }`
- **Output (by_subject)**: `{ mode: "by_subject", subject_type, subject_id, experts }`

## Systems of Record Tools

These tools are intentionally operator-facing. They are visible in an MCP session only when the actor has explicit systems scopes. Generic `read` and `write` shortcuts do not grant systems-of-record access. Governed external writeback tools also require the relevant object write scope, such as `contacts:write` or `opportunities:write`, before CRMy will preview, review, or execute a write.

HubSpot is the first certified 0.8 connector path. Salesforce, Databricks, and Snowflake use the same governed interfaces, but should be live-tested in the target environment before production rollout. `context_entry` mappings are reserved for the connector-author workflow and currently produce reviewable sync conflicts instead of silently creating memory.

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
Get high-level tenant statistics.
- **Input**: (none)
- **Output**: `{ contacts, accounts, opportunities, activities, open_pipeline_value }`
