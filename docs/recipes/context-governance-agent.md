# Build a context governance agent with CRMy

An agent that keeps customer memory current and evidence-backed. It reviews stale entries, detects contradictions, consolidates redundant context, and creates human review assignments when confidence is not high enough for autonomous cleanup.

**What you will build:** A governance loop that improves the quality of the context layer without deleting audit history or silently rewriting facts.

**Prerequisites:**

- A running CRMy workspace. Seed demo data with `crmy seed-demo` for a quick Northstar Labs test, or replace the illustrative records below with your own workspace records.
- MCP connection configured (`claude mcp add crmy -- npx -y @crmy/cli mcp`)
- Optional: inspect exact tool inputs with `crmy tools describe <tool_name>`
- Optional: pgvector and embeddings for `context_semantic_search`

**Context engine capabilities used:** `context_stale`, `context_review_batch`, `context_detect_contradictions`, `context_contradiction_assign`, `context_consolidate`, `context_semantic_search`, `briefing_get`, and `assignment_create`.

---

## Complete system prompt

```
You are the Context Governance Agent for CRMy. Your job is to keep customer context useful, current, and safe for other agents.

Workflow:
1. Call `actor_whoami`.
2. Call `context_stale` to find expired current context.
3. Batch-review only high-confidence facts that are confirmed by recent activity or briefing evidence. Use `context_review_batch`.
4. For stale entries needing judgment, call `context_stale_assign` with an idempotency key.
5. For important accounts and opportunities, call `context_detect_contradictions`.
6. If contradictions exist, call `context_contradiction_assign`. Do not resolve the claim unless the source evidence is explicit and recent.
7. Use `context_consolidate` only for redundant entries of the same type on the same subject.
8. Call `briefing_get` after cleanup to verify what future agents will see.
9. Log the governance run with `activity_create`.

Rules:
- Never delete context to hide a mistake. Supersede, review, consolidate, or assign.
- Never mark competitive intel, budget, legal, pricing, or org-chart context reviewed without evidence.
- Never consolidate contradictory entries.
- Always use idempotency keys for scheduled governance jobs.
- The outcome should make the next `briefing_get` clearer and safer.
```

---

## Step 1 — Identify yourself

**MCP tool call:**

```
actor_whoami {}
```

Governance writes should be attributed to a clearly scoped agent actor, not a generic admin.

---

## Step 2 — Find stale context

Start with stale entries because they are the most common source of poor agent behavior.

**MCP tool call:**

```
context_stale {
  "limit": 50
}
```

**CLI equivalent:**

```bash
crmy context stale --limit 50
```

**Response excerpt:**

```json
{
  "stale_entries": [
    {
      "id": "d0000000-0000-4000-f000-000000000009",
      "subject_type": "account",
      "subject_id": "d0000000-0000-4000-b000-000000000002",
      "context_type": "research",
      "title": "Brightside Health org chart and tech stack",
      "valid_until": "2026-02-09T00:00:00.000Z",
      "confidence": 0.65
    }
  ],
  "total": 1
}
```

---

## Step 3 — Decide what can be batch-reviewed

Some stale entries can be safely marked reviewed because the briefing or recent activities confirm them. Others need human review.

**Safe to batch review:**

- Current preferences confirmed by recent activity
- Recently revalidated account facts
- Stable relationship facts with high confidence

**Do not batch review:**

- Competitive intel
- Pricing or contract terms
- Org charts and stakeholder maps near active deals
- Any entry with low confidence

**MCP tool call:**

```
context_review_batch {
  "entry_ids": [
    "d0000000-0000-4000-f000-000000000005"
  ],
  "extend_days": 30
}
```

**Response:**

```json
{
  "updated": 1,
  "not_found": 0
}
```

---

## Step 4 — Assign stale entries that need judgment

For entries that should not be auto-reviewed, create review assignments. CRMy deduplicates these so repeated governance runs do not spam reviewers.

**MCP tool call:**

```
context_stale_assign {
  "limit": 20,
  "idempotency_key": "context-governance-2026-03-26"
}
```

**Response excerpt:**

```json
{
  "assignments_created": 2,
  "assignments_skipped": 1
}
```

---

## Step 5 — Detect contradictions on important accounts

Run contradiction detection for accounts with open opportunities, upcoming renewals, or recent agent writes.

**MCP tool call:**

```
context_detect_contradictions {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002"
}
```

**Response excerpt:**

```json
{
  "contradictions": [
    {
      "entry_a_id": "ctx_old_budget",
      "entry_b_id": "ctx_new_budget",
      "context_type": "decision",
      "description": "Two current entries disagree on approved budget amount.",
      "suggested_action": "review_and_supersede"
    }
  ],
  "total": 1
}
```

Create review assignments instead of guessing:

```
context_contradiction_assign {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "context_type": "decision",
  "limit": 5,
  "idempotency_key": "brightside-contradictions-2026-03-26"
}
```

---

## Step 6 — Consolidate redundant context

If an account has accumulated many overlapping current entries of the same type, consolidate them into one authoritative entry. This preserves the old entries as superseded records, so audit history is not lost.

Use semantic search first when pgvector is enabled so the agent can find near-duplicates that do not share exact words.

**MCP tool call:**

```
context_semantic_search {
  "query": "next follow-up step for Brightside Health",
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "context_type": "next_step",
  "limit": 10
}
```

**MCP tool call:**

```
context_consolidate {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "context_type": "next_step",
  "max_entries": 8,
  "idempotency_key": "brightside-next-step-consolidation-2026-03-26"
}
```

**When to use this:**

- Several `next_step` entries describe the same follow-up
- Multiple `meeting_notes` entries repeat the same summary
- Several low-value `research` entries should become one clean account summary

**When not to use this:**

- Entries conflict and need human judgment
- Entries have different subjects
- Entries represent distinct facts that agents should keep separate

---

## Step 7 — Verify the account briefing after cleanup

Pull a briefing for the account you touched. This is the release valve: it shows what the next agent will actually see.

**MCP tool call:**

```
briefing_get {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "context_radius": "account_wide",
  "token_budget": 6000,
  "format": "json"
}
```

Check:

- `staleness_warnings` dropped or were assigned for review
- Contradiction warnings are gone or have assignments
- Consolidated entries are concise and current
- Open assignments explain what remains unresolved

---

## Step 8 — Write a governance summary

Log what the governance agent did so humans can audit the run without reading every event.

**MCP tool call:**

```
activity_create {
  "type": "research_completed",
  "subject": "Context governance run — Brightside Health",
  "body": "Reviewed stale context, assigned unresolved stale research, detected one budget contradiction for review, consolidated next-step entries, and verified the account-wide briefing after cleanup.",
  "account_id": "d0000000-0000-4000-b000-000000000002",
  "direction": "outbound",
  "detail": {
    "stale_reviewed": 1,
    "stale_assigned": 2,
    "contradictions_assigned": 1,
    "consolidations": 1
  }
}
```

---

*Licensed under Apache 2.0. Copyright 2026 CRMy.ai*
