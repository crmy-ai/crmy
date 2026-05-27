# Build a renewal risk agent with CRMy

An agent that runs before renewal or expansion reviews. It assembles account-wide customer context, finds hidden risk signals, writes structured renewal intelligence, and hands the next actions to the right owner.

**What you will build:** A renewal risk workflow that turns scattered activities, context entries, assignments, and opportunity state into an auditable renewal plan.

This recipe treats `briefing_get` as the retrieval step: it loads persistent Memory and relevant Signals into the agent's temporary Active Context before the agent reasons or writes anything.

**Prerequisites:**

- A running CRMy instance with demo data seeded (`crmy seed-demo`)
- MCP connection configured (`claude mcp add crmy -- npx @crmy/cli mcp`)
- pgvector and embeddings enabled for semantic search, or use the keyword fallback shown below

**Context engine capabilities used:** `briefing_get`, `context_semantic_search`, `context_search`, `context_detect_contradictions`, `activity_create`, `context_add`, `assignment_create`, and `hitl_submit_request`.

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
6. Store one focused `deal_risk` context entry. Use `context_supersede` or `context_consolidate` if CRMy reports an overlapping current entry.
7. Create a human assignment with clear next steps, due date, and evidence from the briefing.
8. Use `hitl_submit_request` before recommending discounts, contract changes, or commitments.

Rules:
- Never summarize renewal risk without an account-wide briefing.
- Never act on stale or contradictory context without review.
- Never authorize discounts, legal terms, or commercial commitments.
- Prefer structured context entries over long untyped notes.
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
crmy briefing account:d0000000-0000-4000-b000-000000000002 --format json
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
    "stale_warnings": [
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

## Step 6 — Store structured renewal risk

Write one focused `deal_risk` entry. Do not bury multiple risks in a giant note.

**MCP tool call:**

```
context_add {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "context_type": "deal_risk",
  "title": "Brightside renewal risk: low health, unresolved objection, active alternatives",
  "body": "Brightside Health is a high-risk renewal/expansion candidate. Health score is 45. Priya Nair still has an unresolved vendor lock-in objection, the account is evaluating HubSpot and Attio, and org-chart research is stale. Next action should refresh research and address open MCP/multi-model concerns before the next executive touch.",
  "confidence": 0.9,
  "source": "renewal_risk_review",
  "tags": ["renewal-risk", "competitive", "objection", "stale-research"],
  "valid_until": "2026-05-15"
}
```

If CRMy returns a context convergence warning, follow it. Use `context_supersede` for an updated risk, or `context_consolidate` if the account already has many overlapping `deal_risk` entries.

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
