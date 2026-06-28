# Build a renewal risk agent with CRMy

An agent that runs before renewal or expansion reviews. It assembles account-wide customer context, finds hidden risk signals, writes structured renewal intelligence, and hands the next actions to the right owner.

**What you will build:** A renewal risk workflow that turns scattered activities, context entries, assignments, and opportunity state into an auditable renewal plan.

This recipe treats `briefing_get` as the retrieval step: it loads persistent Memory and relevant Signals into the agent's temporary Active Context before the agent reasons or writes anything.

**Prerequisites:**

- A running CRMy workspace. Seed demo data with `crmy seed-demo` for a quick Northstar Labs test, or replace the illustrative records below with your own workspace records.
- MCP connection configured (`claude mcp add crmy -- npx -y @crmy/cli mcp`)
- Optional: inspect exact tool inputs with `crmy tools describe <tool_name>`
- pgvector and embeddings enabled for semantic search, or use the keyword fallback shown below

**Context engine capabilities used:** `briefing_get`, `context_semantic_search`, `context_search`, `context_detect_contradictions`, `activity_create`, `context_ingest_auto`, `context_signal_group_list`, `context_signal_group_promote`, `context_signal_handoff`, `assignment_create`, and `hitl_submit_request`.

---

## Complete system prompt

```
You are the Renewal Risk Agent for CRMy. You run before renewal, expansion, or save-plan reviews.

Workflow:
1. Call `actor_whoami`.
2. Call `briefing_get` on the account with `context_radius: "account_wide"` and a token budget.
3. Call `context_semantic_search` for renewal risk, adoption blockers, executive sponsor changes, competitive threats, and pricing concerns. Fall back to `context_search` if semantic search is unavailable.
4. Call `context_detect_contradictions` before writing conclusions. If contradictions exist, call `context_contradiction_assign` and do not rely on disputed facts.
5. Log the review with `activity_create`.
6. Ingest one focused renewal-risk packet with `context_ingest_auto` so CRMy can create evidence-backed Signals and apply Memory readiness.
7. Create a human assignment with clear next steps, due date, and evidence from the briefing.
8. Use `hitl_submit_request` before recommending discounts, contract changes, or commitments.

Rules:
- Never summarize renewal risk without an account-wide briefing.
- Never act on stale or contradictory context without review.
- Never authorize discounts, legal terms, or commercial commitments.
- Prefer concise, source-linked renewal packets over long untyped notes.
- Do not use `context_add` for model-generated renewal conclusions unless a human explicitly asks you to write already-reviewed Memory.
- Every write should create a useful audit trail for the next agent run.
```

---

## Step 1 — Identify yourself

Every run starts with actor identity. This determines scopes, attribution, and audit entries.

**MCP tool call:**

```
actor_whoami {}
```

**Response:**

```json
{
  "tenant_id": "default",
  "actor_id": "d0000000-0000-4000-a000-000000000004",
  "actor_type": "agent",
  "role": "member"
}
```

---

## Step 2 — Pull an account-wide briefing

Start with the account, not a single contact. Renewal risk often lives across executive sentiment, support activity, adoption notes, open assignments, and opportunity history.

**MCP tool call:**

```
briefing_get {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "context_radius": "account_wide",
  "token_budget": 7000,
  "format": "json"
}
```

**CLI equivalent:**

```bash
crmy briefing "account:Brightside Health" --format json
```

**CLI note:** `context_radius` and `token_budget` are MCP/REST options for agent runs. Use the MCP call above when the agent needs account-wide renewal context.

**Response excerpt:**

```json
{
  "briefing": {
    "record": {
      "id": "d0000000-0000-4000-b000-000000000002",
      "name": "Brightside Health",
      "health_score": 45
    },
    "related": {
      "opportunities": [
        {
          "id": "d0000000-0000-4000-d000-000000000002",
          "name": "Brightside Health Platform Deal",
          "stage": "PoC",
          "amount": 96000,
          "close_date": "2026-05-15"
        }
      ]
    },
    "open_assignments": [
      {
        "id": "d0000000-0000-4000-f100-000000000002",
        "title": "Review stale research on Brightside Health before next call",
        "priority": "normal"
      }
    ],
    "staleness_warnings": [
      {
        "id": "d0000000-0000-4000-f000-000000000009",
        "context_type": "research",
        "reason": "valid_until has passed"
      }
    ],
    "truncated": false
  }
}
```

**What to notice:** The account is already below a healthy threshold, has stale research, and has an open review assignment. The agent should not write a renewal plan until it checks for hidden risks.

---

## Step 3 — Search for hidden renewal signals

Use semantic search to find conceptually related memory that may not fit in the briefing.

**MCP tool call:**

```
context_semantic_search {
  "query": "renewal risk adoption blocker executive sponsor pricing implementation concerns",
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "limit": 8
}
```

**Fallback when semantic search is unavailable:**

```
context_search {
  "query": "renewal risk adoption blocker pricing implementation",
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "current_only": true
}
```

**Response excerpt:**

```json
{
  "context_entries": [
    {
      "id": "d0000000-0000-4000-f000-000000000002",
      "context_type": "objection",
      "title": "Concern about vendor lock-in with proprietary MCP",
      "confidence": 0.7,
      "valid_until": "2026-04-25T00:00:00.000Z"
    },
    {
      "id": "d0000000-0000-4000-f000-000000000003",
      "context_type": "competitive_intel",
      "title": "Brightside evaluating HubSpot and Attio",
      "confidence": 0.85,
      "valid_until": "2026-05-10T00:00:00.000Z"
    }
  ],
  "semantic_search": true
}
```

---

## Step 4 — Check for contradictions

Before summarizing risk, verify that the agent is not relying on conflicting current memory.

**MCP tool call:**

```
context_detect_contradictions {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002"
}
```

If contradictions are returned, call `context_contradiction_assign` instead of guessing which entry is correct.

```
context_contradiction_assign {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "limit": 5
}
```

---

## Step 5 — Log the renewal review activity

Write an activity so humans can see that the review happened.

**MCP tool call:**

```
activity_create {
  "type": "research_completed",
  "subject": "Renewal risk review — Brightside Health",
  "body": "Reviewed account-wide briefing, semantic context, stale warnings, open assignments, and contradiction status. Brightside shows renewal risk due to low health score, unresolved MCP objection, active competitive evaluation, and stale org research.",
  "account_id": "d0000000-0000-4000-b000-000000000002",
  "opportunity_id": "d0000000-0000-4000-d000-000000000002",
  "direction": "outbound"
}
```

---

## Step 6 — Ingest structured renewal risk as a Source

Create one focused renewal-risk packet and ingest it through Source. This lets CRMy extract Signals, check readiness, prevent duplicate-source inflation, and keep the source-to-Memory trail visible.

**MCP tool call:**

```
context_ingest_auto {
  "document": "Renewal risk review for Brightside Health. Evidence reviewed: account-wide briefing, semantic context search, stale warnings, open assignments, and contradiction status. Candidate Signal: Brightside may be a high-risk renewal or expansion account because health score is 45, Priya Nair has an unresolved vendor lock-in objection, the account has active competitive alternatives, and org-chart research is stale. Recommended next step: refresh research and address open MCP/multi-model concerns before the next executive touch. Treat this as reviewable renewal-risk context, not an approved commercial commitment.",
  "source_label": "Renewal risk review - Brightside Health",
  "source_occurred_at": "2026-03-26T17:00:00.000Z",
  "context_type": "deal_risk",
  "confidence_threshold": 0.6,
  "subjects": [
    {
      "type": "account",
      "id": "d0000000-0000-4000-b000-000000000002",
      "name": "Brightside Health"
    }
  ],
  "idempotency_key": "renewal-risk-brightside-2026-03-26"
}
```

Then review the grouped Signal:

```
context_signal_group_list {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "context_type": "deal_risk",
  "attention_only": true,
  "limit": 10
}
```

If the Signal is complete, evidence-backed, and safe to use operationally, confirm it with `context_signal_group_promote`. If it is sensitive, conflicting, or likely to affect forecast or commercial action, send it to Handoff with `context_signal_handoff`.

---

## Step 7 — Create the human follow-up

Create a concrete assignment with the briefing evidence embedded in the instructions.

**MCP tool call:**

```
assignment_create {
  "title": "Refresh Brightside renewal plan and address MCP objection",
  "assignee_actor_id": "d0000000-0000-4000-a000-000000000001",
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "priority": "high",
  "due_at": "2026-03-29T17:00:00.000Z",
  "instructions": "Refresh the Brightside org chart, verify whether HubSpot and Attio are still active alternatives, and prepare a short MCP openness/multi-model explanation for Priya Nair.",
  "context": "Renewal risk review found health score 45, stale org research, unresolved vendor lock-in objection, and active competitive evaluation. Use the account-wide briefing before outreach."
}
```

---

## Step 8 — Escalate risky commercial changes through HITL

The agent can recommend a discount, extension, or executive escalation, but it should not make commercial commitments autonomously.

**MCP tool call:**

```
hitl_submit_request {
  "action_type": "renewal_save_plan",
  "action_summary": "Approve renewal-save plan for Brightside Health: refresh research, address MCP objection, and prepare executive follow-up. No discount is authorized yet.",
  "action_payload": {
    "account_id": "d0000000-0000-4000-b000-000000000002",
    "risk_level": "high",
    "recommended_owner_action": "Refresh account research and schedule technical proof point with Priya Nair"
  },
  "priority": "high",
  "sla_minutes": 240
}
```

---

*Licensed under Apache 2.0. Copyright 2026 CRMy.ai*
