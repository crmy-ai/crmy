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

### activity_complete
Mark an activity as completed.
- **Input**: `id` (required), `completed_at`, `note`
- **Output**: `{ activity, event_id }`

### activity_update
Update an activity.
- **Input**: `id` (required), `patch`
- **Output**: `{ activity, event_id }`

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

## Meta Tools

### schema_get
Get the schema for a CRM object type.
- **Input**: `object_type` (required: contact|account|opportunity|activity)
- **Output**: `{ standard_fields, custom_fields_schema }`

### tenant_get_stats
Get high-level tenant statistics.
- **Input**: (none)
- **Output**: `{ contacts, accounts, opportunities, activities, open_pipeline_value }`
