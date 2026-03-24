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

### contact_log_activity
Log an activity for a contact.
- **Input**: `contact_id` (required), `type` (required), `subject` (required), `body`, `opportunity_id`, `due_at`, `direction`
- **Output**: `{ activity, event_id }`

### contact_get_timeline
Get the activity timeline for a contact.
- **Input**: `id` (required), `limit`, `types`
- **Output**: `{ activities, total }`

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
Get parent/child hierarchy.
- **Input**: `id` (required)
- **Output**: `{ root, children, depth }`

### account_delete
Delete an account (admin/owner only).
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
Get paginated activity timeline for any CRM object.
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
Add a threaded note to any CRM object.
- **Input**: `object_type` (required: contact|account|opportunity|activity|use_case), `object_id` (required), `body` (required), `parent_id`, `visibility` (internal|external), `mentions`, `pinned`
- **Output**: `{ note }`

### note_get
Get a note with its threaded replies.
- **Input**: `id` (required)
- **Output**: `{ note, replies }`

### note_list
List notes for a CRM object. Pinned notes appear first.
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
- **Output**: `{ runs, next_cursor, total }`

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
Define a custom field for a CRM object type.
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
Search across all CRM entities.
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
Store context/knowledge about a CRM object.
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
- **Input**: `id` (required)
- **Output**: `{ context_entry }`

### context_stale
List stale context entries where `valid_until` has passed but `is_current` is still `true`.
- **Input**: `subject_type`, `subject_id`, `limit`
- **Output**: `{ stale_entries, total }`

### context_diff
Catch-up diff for a CRM subject — shows what changed since a given timestamp. Ideal for daily agent check-ins.
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
Get a unified briefing for any CRM object — assembles the record, related objects, activity timeline, open assignments, context entries, and staleness warnings in one call.
- **Input**: `subject_type` (required), `subject_id` (required), `since`, `context_types`, `include_stale`, `format` (`"json"` | `"text"`), `context_radius` (`"direct"` | `"adjacent"` | `"account_wide"`, default `"direct"`), `token_budget`
- **Output (json)**: `{ briefing: { record, related, activities, open_assignments, context, stale_warnings, adjacent_context?, token_estimate, truncated? } }`
- **Output (text)**: `{ briefing_text }` — a formatted string ready for prompt injection
- **Note**: `token_budget` enables priority-ranked, budget-constrained packing. Entries are scored by `effective_confidence × priority_weight` (with per-type half-life decay) and greedily packed. Pass `context_radius: "adjacent"` or `"account_wide"` to pull in context from related entities.

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

## Meta Tools

### schema_get
Get the schema for a CRM object type.
- **Input**: `object_type` (required: contact|account|opportunity|activity)
- **Output**: `{ standard_fields, custom_fields_schema }`

### tenant_get_stats
Get high-level tenant statistics.
- **Input**: (none)
- **Output**: `{ contacts, accounts, opportunities, activities, open_pipeline_value }`
