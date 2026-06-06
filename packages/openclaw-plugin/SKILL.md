---
name: crmy
description: CRMy context engine for OpenClaw — brief customer records, search and update typed revenue objects, log activities, manage context, create handoffs, and route HITL approvals.
---

# CRMy — Operational Customer Context For Agents

You have access to CRMy through the **`crmy`** tool. CRMy is not just a CRM table surface; it is the operational state layer that lets agents remember customer context, work with typed revenue objects, and leave audit-safe state behind.

Every call uses:

```js
crmy({ action: "<action>", params: { ... } })
```

Use CRMy to:

- Get a one-call briefing before acting on a customer record.
- Search and update contacts, accounts, opportunities, use cases, activities, context entries, assignments, and HITL requests.
- Ingest messy customer context as Raw Context, then review Signals before they become Memory.
- Route work to humans or agents through assignments and approval requests.
- Check audit events and operations health when trust matters.

---

## Default Agent Workflow

### 1. Identify yourself

Start substantive work with:

```js
crmy({ action: "actor.whoami" })
```

This tells you which actor will be attributed on writes.

### 2. Resolve the customer record

Search before creating. Prefer exact records over guessed names.

```js
crmy({ action: "search", params: { q: "Acme", limit: 10 } })
crmy({ action: "contact.search", params: { q: "Sarah Chen", limit: 10 } })
crmy({ action: "account.search", params: { q: "Acme", limit: 10 } })
```

### 3. Brief before acting

Before outreach, deal changes, handoffs, or context writes, call `briefing.get`.

```js
crmy({
  action: "briefing.get",
  params: {
    subject_type: "contact",
    subject_id: "<uuid>",
    context_radius: "adjacent",
    token_budget: 4000,
    format: "json"
  }
})
```

Use `context_radius: "account_wide"` for deal reviews, renewal risk, and handoffs where related account/contact context matters.

### 4. Check context quality

If a decision depends on memory, check stale and contradictory context.

```js
crmy({ action: "context.stale", params: { subject_type: "account", subject_id: "<uuid>", limit: 20 } })
crmy({ action: "context.contradictions", params: { subject_type: "account", subject_id: "<uuid>" } })
```

If there are contradictions, do not pick a truth unless the evidence is explicit. Use:

```js
crmy({ action: "context.contradictions_assign", params: { subject_type: "account", subject_id: "<uuid>", limit: 5 } })
```

### 5. Capture context with provenance

When logging activities, include source, subject, and useful detail.

```js
crmy({
  action: "activity.create",
  params: {
    type: "call",
    subject: "Call with Cody Harris from Databricks",
    body: "Cody wants a demo on May 20.",
    subject_type: "contact",
    subject_id: "<contact-uuid>",
    outcome: "follow_up_needed",
    detail: { requested_next_step: "demo", requested_date: "2026-05-20" }
  }
})
```

For transcripts, emails, notes, call debriefs, research, or any messy source material, use Raw Context ingestion:

```js
crmy({
  action: "context.ingest_auto",
  params: {
    document: "Cody Harris from Databricks requested a CRMy demo on May 20.",
    source_label: "Call debrief - Databricks - 2026-05-20",
    source_occurred_at: "2026-05-20T17:00:00.000Z",
    subjects: [{ type: "contact", id: "<contact-uuid>", name: "Cody Harris" }],
    idempotency_key: "databricks-call-debrief-2026-05-20"
  }
})
```

Use `context.add` only for advanced direct writes when a human explicitly asks you to create already-reviewed Memory or an evidence-backed Signal.

### 6. Escalate risky actions

Use HITL before sending executive outreach, making commercial commitments, changing important state, or acting on ambiguous context.

```js
crmy({
  action: "hitl.submit",
  params: {
    action_type: "send_email",
    action_summary: "Send executive follow-up to Priya Nair about MCP openness",
    action_payload: { contact_id: "<uuid>", body_text: "..." },
    priority: "high",
    sla_minutes: 240
  }
})
```

Poll the request before proceeding:

```js
crmy({ action: "hitl.status", params: { id: "<hitl-request-id>" } })
```

---

## Action Reference

### Identity And Search

| Action | Purpose |
|---|---|
| `actor.whoami` | Current actor identity and scopes |
| `actor.list` | List humans and agents |
| `actor.register` | Register a human or agent actor |
| `search` | Cross-entity search across customer state |

### Briefings

| Action | Required params | Notes |
|---|---|---|
| `briefing.get` | `subject_type`, `subject_id` | Supports `context_radius`, `token_budget`, `context_types`, `include_stale`, `format` |

Subject types: `contact`, `account`, `opportunity`, `use_case`.

### Typed Revenue Objects

| Action | Purpose |
|---|---|
| `contact.search`, `contact.get`, `contact.create`, `contact.update`, `contact.set_stage`, `contact.timeline` | Contacts with lead lifecycle stages |
| `account.search`, `account.get`, `account.create`, `account.update` | Accounts |
| `opportunity.search`, `opportunity.get`, `opportunity.create`, `opportunity.update`, `opportunity.advance` | Deals/pipeline |
| `use_case.search`, `use_case.get`, `use_case.create`, `use_case.update` | Use cases/deployments |

Important field names:

- Contacts use `first_name`, `last_name`, `email`, `phone`, `title`, `company_name`, `account_id`, `lifecycle_stage`.
- Opportunities use `name`, `account_id`, `contact_id`, `amount`, `stage`, `close_date`, `description`.
- Use cases use `name`, `account_id`, `opportunity_id`, `stage`, `attributed_arr`, `target_prod_date`, `description`.

### Activities

| Action | Purpose |
|---|---|
| `activity.search` | Search activity timeline |
| `activity.get` | Fetch one activity |
| `activity.create` | Log a call, email, meeting, demo, research item, handoff, or note |
| `activity.update` | Update activity fields |

Prefer `subject_type` + `subject_id`. Use `detail` for structured extras like attendees, duration, requested date, next step, or email metadata.

### Context Engine

| Action | Purpose |
|---|---|
| `context.list`, `context.get` | Browse context entries |
| `context.signal_groups`, `context.signal_group.get` | Review grouped Signals with evidence and readiness |
| `context.search` | Keyword search |
| `context.semantic_search` | Semantic memory search when pgvector is enabled |
| `context.ingest_auto` | Ingest messy Raw Context and let CRMy extract Signals and Memory readiness |
| `context.add` | Advanced direct Memory or Signal write |
| `context.supersede` | Replace stale/wrong context while preserving audit history |
| `context.stale` | Find expired context |
| `context.review_batch` | Mark stale entries reviewed |
| `context.consolidate` | Merge redundant current entries |
| `context.contradictions` | Detect conflicting current facts |
| `context.contradictions_assign` | Create review assignments for conflicts |
| `context.contradictions_resolve` | Resolve a conflict when evidence is clear |

Context guidance:

- Prefer `context.ingest_auto` for transcripts, emails, notes, research, debriefs, and support updates.
- Use `source_label`, `source_occurred_at`, selected `subjects`, and `idempotency_key` when possible.
- Use `context.add` only for already-reviewed direct Memory/Signal writes.
- Use `valid_until` for time-sensitive facts.
- Do not create duplicate context if CRMy reports convergence warnings; supersede, consolidate, or ask for review.

### Assignments And HITL

| Action | Purpose |
|---|---|
| `assignment.list`, `assignment.get`, `assignment.create`, `assignment.update` | Structured handoffs |
| `assignment.start`, `assignment.complete`, `assignment.block`, `assignment.cancel` | Assignment lifecycle |
| `hitl.list`, `hitl.submit`, `hitl.status`, `hitl.resolve` | Human approval requests |

Use assignments for work that should be done later. Use HITL for approval before an action.

### Analytics, Audit, And Ops

| Action | Purpose |
|---|---|
| `pipeline.summary` | Pipeline by stage/owner/forecast category |
| `pipeline.forecast` | Forecast metrics |
| `audit.events` | Audit trail filtered by object, event, or actor |
| `ops.status` | Queue/job/system health |
| `ops.data_quality` | Data quality findings |

---

## High-Value Workflows

### Log a call and update memory

1. `search` or `contact.search` to resolve the person.
2. `briefing.get` for current context.
3. `activity.create` with the call summary and structured `detail`.
4. `context.ingest_auto` for messy notes or transcript excerpts. Review resulting Signals before confirming Memory.
5. `assignment.create` for the follow-up.

### Prepare outreach

1. `briefing.get` on the contact with `context_radius: "adjacent"`.
2. `context.semantic_search` for the specific objection or goal.
3. Draft the message grounded in context.
4. `activity.create` for the draft.
5. `hitl.submit` if the message is high-stakes.
6. After approval, log the final send.

### Review a deal

1. `opportunity.search` to find deals by account, stage, or query.
2. `briefing.get` on each opportunity with `context_radius: "account_wide"`.
3. `context.stale` and `context.contradictions`.
4. `assignment.create` for concrete next actions.
5. `audit.events` if the user asks what changed.

### Governance cleanup

1. `context.stale` to identify stale entries.
2. `context.review_batch` only for facts confirmed by recent evidence.
3. `context.contradictions` for important accounts.
4. `context.contradictions_assign` when judgment is needed.
5. `context.consolidate` for redundant non-conflicting entries.

---

## Presentation Guidelines

- Summarize results with names and business meaning; do not dump raw JSON unless asked.
- Mention stale or contradictory context before making recommendations.
- Confirm before writes that affect many records or high-stakes workflows.
- When a required UUID is missing, search first or ask the user which record they mean.
- Use audit and mutation receipts to explain what changed.
- On errors, give the likely recovery path:
  - Server not reachable: start CRMy with `npx @crmy/cli server`.
  - Missing auth: run `npx @crmy/cli init --yes`, `npx @crmy/cli auth login`, or configure `CRMY_API_KEY`.
  - Permission denied: ask an admin to adjust actor/API-key scopes in Settings → Actors.
