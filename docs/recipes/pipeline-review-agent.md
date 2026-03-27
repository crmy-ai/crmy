# Build a weekly pipeline review agent with CRMy

An agent that runs on a schedule. It reviews all open opportunities, surfaces at-risk deals, identifies stale context, and creates review assignments for the team.

**What you will build:** A weekly pipeline review pipeline that produces a structured summary of deal health, stale intelligence, and recommended actions — then distributes assignments to the right people.

**Prerequisites:**

- A running CRMy instance with demo data seeded (`crmy seed-demo`)
- MCP connection configured (`claude mcp add crmy -- npx @crmy/cli mcp`)

---

## Step 1 — Identify yourself

**MCP tool call:**

```
actor_whoami {}
```

**CLI equivalent:**

```bash
crmy actors whoami
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

The agent is the **Research Agent** (`d0000000-0000-4000-a000-000000000004`). Pipeline reviews are typically run by a research or ops agent, not the outreach agent.

---

## Step 2 — Pull the pipeline forecast

Start with the high-level numbers. This tells you the overall pipeline health before you drill into individual deals.

**MCP tool call:**

```
pipeline_forecast {
  "period": "quarter"
}
```

**CLI equivalent:**

```bash
crmy pipeline forecast --period quarter
```

**Response:**

```json
{
  "committed": 240000,
  "best_case": 336000,
  "pipeline": 516000,
  "win_rate": 0.35,
  "avg_deal_size": 172000,
  "avg_cycle_days": 62
}
```

**How to interpret:**

| Metric | Value | Signal |
|---|---|---|
| `committed` | $240K | Only the Vertex deal ($240K, Negotiation) is in commit |
| `best_case` | $336K | Vertex + Brightside ($96K, PoC) |
| `pipeline` | $516K | All three deals combined |
| `win_rate` | 35% | Historical win rate — below the 40% benchmark |
| `avg_deal_size` | $172K | Healthy for mid-market |
| `avg_cycle_days` | 62 | Slightly long — worth investigating |

---

## Step 3 — Search for at-risk opportunities

Find deals that are in late stages or approaching their close date. These need the most attention.

**MCP tool call:**

```
opportunity_search {
  "stage": "Negotiation",
  "limit": 10
}
```

**CLI equivalent:**

```bash
crmy opps search --stage Negotiation --limit 10
```

**Response:**

```json
{
  "opportunities": [
    {
      "id": "d0000000-0000-4000-d000-000000000003",
      "name": "Vertex Logistics Expansion",
      "account_id": "d0000000-0000-4000-b000-000000000003",
      "stage": "Negotiation",
      "amount": 240000,
      "close_date": "2026-04-30",
      "forecast_category": "commit",
      "created_at": "2026-03-10T00:00:00.000Z"
    }
  ],
  "next_cursor": null,
  "total": 1
}
```

Now search for deals with close dates approaching (within 60 days):

**MCP tool call:**

```
opportunity_search {
  "close_date_before": "2026-05-25",
  "limit": 10
}
```

**CLI equivalent:**

```bash
crmy opps search --close-date-before 2026-05-25 --limit 10
```

**Response:**

```json
{
  "opportunities": [
    {
      "id": "d0000000-0000-4000-d000-000000000003",
      "name": "Vertex Logistics Expansion",
      "account_id": "d0000000-0000-4000-b000-000000000003",
      "stage": "Negotiation",
      "amount": 240000,
      "close_date": "2026-04-30"
    },
    {
      "id": "d0000000-0000-4000-d000-000000000002",
      "name": "Brightside Health Platform Deal",
      "account_id": "d0000000-0000-4000-b000-000000000002",
      "stage": "PoC",
      "amount": 96000,
      "close_date": "2026-05-15"
    }
  ],
  "next_cursor": null,
  "total": 2
}
```

Both Vertex (Apr 30) and Brightside (May 15) are closing within 60 days. Acme's close date (Jun 30) is further out and still in Discovery.

---

## Step 4 — Deep-dive each at-risk opportunity

For each at-risk deal, pull a full briefing with `context_radius: "account_wide"` to see everything — the opportunity, the account, all contacts, and all context entries.

### Vertex Logistics Expansion

**MCP tool call:**

```
briefing_get {
  "subject_type": "opportunity",
  "subject_id": "d0000000-0000-4000-d000-000000000003",
  "context_radius": "account_wide",
  "format": "json"
}
```

**CLI equivalent:**

```bash
crmy briefing opportunity:d0000000-0000-4000-d000-000000000003 \
  --context-radius account_wide
```

**Response:**

```json
{
  "briefing": {
    "record": {
      "id": "d0000000-0000-4000-d000-000000000003",
      "name": "Vertex Logistics Expansion",
      "account_id": "d0000000-0000-4000-b000-000000000003",
      "stage": "Negotiation",
      "amount": 240000,
      "close_date": "2026-04-30"
    },
    "related": {
      "account": {
        "id": "d0000000-0000-4000-b000-000000000003",
        "name": "Vertex Logistics",
        "industry": "Logistics",
        "health_score": 88
      },
      "contacts": [
        {
          "id": "d0000000-0000-4000-c000-000000000005",
          "first_name": "Tomás",
          "last_name": "Rivera",
          "title": "Head of Sales Ops"
        },
        {
          "id": "d0000000-0000-4000-c000-000000000006",
          "first_name": "Keiko",
          "last_name": "Yamamoto",
          "title": "CEO"
        }
      ]
    },
    "activities": [
      {
        "id": "d0000000-0000-4000-e000-000000000007",
        "type": "stage_change",
        "subject": "Vertex Logistics → Negotiation",
        "occurred_at": "2026-03-25T00:00:00.000Z"
      },
      {
        "id": "d0000000-0000-4000-e000-000000000006",
        "type": "meeting_scheduled",
        "subject": "Executive alignment call — Vertex Logistics",
        "occurred_at": "2026-03-24T00:00:00.000Z"
      }
    ],
    "open_assignments": [
      {
        "id": "d0000000-0000-4000-f100-000000000003",
        "title": "Schedule executive alignment call with Keiko Yamamoto at Vertex",
        "status": "accepted",
        "priority": "urgent"
      }
    ],
    "context": [
      {
        "id": "d0000000-0000-4000-f000-000000000010",
        "context_type": "summary",
        "title": "Vertex Logistics account summary",
        "body": "Vertex Logistics is our highest-probability deal ($240K ARR, Negotiation stage). The PoC exceeded throughput targets by 22%. Remaining gate: CEO Keiko Yamamoto sign-off. Next action: executive alignment call scheduled.",
        "confidence": 0.9
      },
      {
        "id": "d0000000-0000-4000-f000-000000000008",
        "context_type": "relationship_map",
        "title": "Vertex Logistics buying committee",
        "body": "Tomás Rivera is the champion and day-to-day contact. Keiko Yamamoto (CEO) has final sign-off authority on all annual contracts over $100K. Tomás warned: 'Don't oversell to Keiko — she values directness.'",
        "confidence": 0.9
      }
    ],
    "stale_warnings": [
      {
        "id": "d0000000-0000-4000-f000-000000000004",
        "context_type": "competitive_intel",
        "title": "Vertex considering Attio as alternative",
        "valid_until": "2026-03-16",
        "reason": "valid_until has passed"
      }
    ],
    "token_estimate": 1420
  }
}
```

**Assessment:** Vertex is healthy (score 88, PoC exceeded targets). One stale competitive_intel entry, one urgent open assignment. Main risk: CEO sign-off pending.

### Brightside Health Platform Deal

**MCP tool call:**

```
briefing_get {
  "subject_type": "opportunity",
  "subject_id": "d0000000-0000-4000-d000-000000000002",
  "context_radius": "account_wide",
  "format": "json"
}
```

**CLI equivalent:**

```bash
crmy briefing opportunity:d0000000-0000-4000-d000-000000000002 \
  --context-radius account_wide
```

**Response:**

```json
{
  "briefing": {
    "record": {
      "id": "d0000000-0000-4000-d000-000000000002",
      "name": "Brightside Health Platform Deal",
      "account_id": "d0000000-0000-4000-b000-000000000002",
      "stage": "PoC",
      "amount": 96000,
      "close_date": "2026-05-15"
    },
    "related": {
      "account": {
        "id": "d0000000-0000-4000-b000-000000000002",
        "name": "Brightside Health",
        "industry": "Healthcare",
        "health_score": 45
      },
      "contacts": [
        {
          "id": "d0000000-0000-4000-c000-000000000003",
          "first_name": "Priya",
          "last_name": "Nair",
          "title": "CTO"
        },
        {
          "id": "d0000000-0000-4000-c000-000000000004",
          "first_name": "Jordan",
          "last_name": "Liu",
          "title": "RevOps Lead"
        }
      ]
    },
    "activities": [
      {
        "id": "d0000000-0000-4000-e000-000000000005",
        "type": "outreach_call",
        "subject": "Follow-up call to Dr. Priya Nair",
        "outcome": "voicemail",
        "occurred_at": "2026-03-23T00:00:00.000Z"
      },
      {
        "id": "d0000000-0000-4000-e000-000000000008",
        "type": "outreach_email",
        "subject": "Technical deep-dive request to Jordan Liu",
        "outcome": "opened",
        "occurred_at": "2026-03-22T00:00:00.000Z"
      }
    ],
    "open_assignments": [
      {
        "id": "d0000000-0000-4000-f100-000000000002",
        "title": "Review stale research on Brightside Health before next call",
        "status": "pending",
        "priority": "normal"
      }
    ],
    "context": [
      {
        "id": "d0000000-0000-4000-f000-000000000002",
        "context_type": "objection",
        "title": "Concern about vendor lock-in with proprietary MCP",
        "confidence": 0.7
      },
      {
        "id": "d0000000-0000-4000-f000-000000000003",
        "context_type": "competitive_intel",
        "title": "Brightside evaluating HubSpot and Attio",
        "confidence": 0.85
      }
    ],
    "stale_warnings": [
      {
        "id": "d0000000-0000-4000-f000-000000000009",
        "context_type": "research",
        "title": "Brightside Health org chart and tech stack",
        "valid_until": "2026-02-09",
        "reason": "valid_until has passed"
      }
    ],
    "token_estimate": 1680
  }
}
```

**Assessment:** Brightside is at risk. Health score 45, unresolved objection, stale research, last activity was a voicemail 3 days ago. Close date is 50 days out but the deal is only at PoC stage.

---

## Step 5 — List all stale context across the pipeline

Get a comprehensive view of stale intelligence that could be affecting deal strategy.

**MCP tool call:**

```
context_stale {
  "limit": 20
}
```

**CLI equivalent:**

```bash
crmy context stale --limit 20
```

**Response:**

```json
{
  "stale_entries": [
    {
      "id": "d0000000-0000-4000-f000-000000000004",
      "subject_type": "account",
      "subject_id": "d0000000-0000-4000-b000-000000000003",
      "context_type": "competitive_intel",
      "title": "Vertex considering Attio as alternative",
      "confidence": 0.6,
      "valid_until": "2026-03-16T00:00:00.000Z",
      "authored_by": "d0000000-0000-4000-a000-000000000001"
    },
    {
      "id": "d0000000-0000-4000-f000-000000000009",
      "subject_type": "account",
      "subject_id": "d0000000-0000-4000-b000-000000000002",
      "context_type": "research",
      "title": "Brightside Health org chart and tech stack",
      "confidence": 0.65,
      "valid_until": "2026-02-09T00:00:00.000Z",
      "authored_by": "d0000000-0000-4000-a000-000000000004"
    }
  ],
  "total": 2
}
```

Two stale entries across the pipeline:
1. **Vertex competitive intel** — outdated Attio evaluation (already known from the briefing)
2. **Brightside research** — org chart from January, over 6 weeks past expiry

---

## Step 6 — Auto-create review assignments for stale entries

Use `context_stale_assign` to trigger CRMy's built-in stale review loop. This creates assignments for each stale entry, routed to the actor who originally authored it.

**MCP tool call:**

```
context_stale_assign {
  "limit": 20
}
```

**CLI equivalent:**

```bash
crmy context stale-assign --limit 20
```

**Response:**

```json
{
  "assignments_created": 2
}
```

CRMy automatically creates assignments:
- Stale Vertex competitive intel (`d0000000-0000-4000-f000-000000000004`) assigned to **Cody** (`d0000000-0000-4000-a000-000000000001`) since he authored it
- Stale Brightside research (`d0000000-0000-4000-f000-000000000009`) assigned to **Research Agent** (`d0000000-0000-4000-a000-000000000004`) since it authored it

Note: if an assignment already exists for a stale entry (like the existing Brightside review assignment `d0000000-0000-4000-f100-000000000002`), CRMy will not create a duplicate.

---

## Step 7 — Create targeted assignments for at-risk deals

For each deal with concerning signals, create an assignment for the account owner with specific instructions.

### Brightside Health — stale research blocks deal progress

**MCP tool call:**

```
assignment_create {
  "title": "Urgent: refresh Brightside Health research before PoC evaluation",
  "assignee_actor_id": "d0000000-0000-4000-a000-000000000002",
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000002",
  "instructions": "The Brightside Health research entry (org chart, tech stack) has been stale since February 9. The deal is at PoC stage with a May 15 close date and a health score of 45. Priya Nair's last interaction was a voicemail 3 days ago. Before the next touchpoint: (1) Verify the org chart — the rumored new CTO hire may have happened. (2) Confirm Priya is still the right technical contact. (3) Check if Jordan Liu has responded to the technical deep-dive email.",
  "priority": "high",
  "due_at": "2026-03-28T17:00:00.000Z",
  "context": "Pipeline review flagged Brightside Health as at-risk. Health score: 45. Stage: PoC. Close date: 2026-05-15. Last activity: voicemail to Priya Nair (3 days ago). Stale research: org chart from January. Unresolved objection: MCP vendor lock-in concern. Competitive threat: HubSpot and Attio also being evaluated."
}
```

**CLI equivalent:**

```bash
crmy assignments create \
  --title "Urgent: refresh Brightside Health research before PoC evaluation" \
  --assignee d0000000-0000-4000-a000-000000000002 \
  --subject-type account \
  --subject-id d0000000-0000-4000-b000-000000000002 \
  --priority high \
  --due-at 2026-03-28T17:00:00.000Z \
  --instructions "The Brightside Health research entry has been stale since February 9..."
```

**Response:**

```json
{
  "assignment": {
    "id": "a0000002-0000-4000-f100-000000000099",
    "title": "Urgent: refresh Brightside Health research before PoC evaluation",
    "assignee_actor_id": "d0000000-0000-4000-a000-000000000002",
    "assigner_actor_id": "d0000000-0000-4000-a000-000000000004",
    "subject_type": "account",
    "subject_id": "d0000000-0000-4000-b000-000000000002",
    "status": "pending",
    "priority": "high",
    "due_at": "2026-03-28T17:00:00.000Z",
    "created_at": "2026-03-26T16:00:00.000Z"
  },
  "event_id": "evt_ghi001"
}
```

---

## Step 8 — Pull account health reports

Surface accounts with declining or low health scores.

### Brightside Health (low health)

**MCP tool call:**

```
account_health_report {
  "account_id": "d0000000-0000-4000-b000-000000000002"
}
```

**CLI equivalent:**

```bash
crmy accounts health d0000000-0000-4000-b000-000000000002
```

**Response:**

```json
{
  "health_score": 45,
  "open_opps": 1,
  "open_opp_value": 96000,
  "last_activity_days": 3,
  "contact_count": 2,
  "activity_count_30d": 3
}
```

### Vertex Logistics (healthy, for comparison)

**MCP tool call:**

```
account_health_report {
  "account_id": "d0000000-0000-4000-b000-000000000003"
}
```

**CLI equivalent:**

```bash
crmy accounts health d0000000-0000-4000-b000-000000000003
```

**Response:**

```json
{
  "health_score": 88,
  "open_opps": 1,
  "open_opp_value": 240000,
  "last_activity_days": 1,
  "contact_count": 2,
  "activity_count_30d": 5
}
```

### Acme Corp (mid-range)

**MCP tool call:**

```
account_health_report {
  "account_id": "d0000000-0000-4000-b000-000000000001"
}
```

**CLI equivalent:**

```bash
crmy accounts health d0000000-0000-4000-b000-000000000001
```

**Response:**

```json
{
  "health_score": 72,
  "open_opps": 1,
  "open_opp_value": 180000,
  "last_activity_days": 7,
  "contact_count": 2,
  "activity_count_30d": 4
}
```

---

## Step 9 — Synthesize the pipeline review summary

Combine all the data from steps 2-8 into a structured review. Here is the output format the agent should produce:

```markdown
# Weekly Pipeline Review — Week of 2026-03-23

## Pipeline Snapshot
| Metric | Value |
|---|---|
| Committed | $240,000 |
| Best Case | $336,000 |
| Total Pipeline | $516,000 |
| Win Rate (trailing) | 35% |
| Avg Deal Size | $172,000 |
| Avg Cycle (days) | 62 |

## Deal-by-Deal Assessment

### Vertex Logistics Expansion — $240K, Negotiation
**Risk: LOW** | Health: 88 | Close: Apr 30

- PoC exceeded targets by 22%
- CEO sign-off pending (Keiko Yamamoto) — executive alignment call scheduled
- Stale competitive intel (Attio eval) — auto-assigned for review
- **Action:** Ensure executive call happens this week. Prep Tomás with talking points.

### Brightside Health Platform Deal — $96K, PoC
**Risk: HIGH** | Health: 45 | Close: May 15

- Unresolved objection: MCP vendor lock-in concern (Dr. Priya Nair)
- Stale research: org chart from January (6+ weeks overdue)
- Last contact: voicemail 3 days ago — no response
- Active competitor eval: HubSpot ($3,600/mo), Attio ($1,200/mo)
- **Action:** Refresh research ASAP. Address MCP objection in next touchpoint. Engage Jordan Liu as alternate path.

### Acme Corp Enterprise Deal — $180K, Discovery
**Risk: MEDIUM** | Health: 72 | Close: Jun 30

- Champion identified (Sarah Chen, VP Engineering)
- CFO blocker: Marcus Webb rejected ROI projections — needs case studies
- Close date is 3 months out but still in Discovery — cycle risk
- **Action:** Send revised proposal with Vertex case study. Identify VP Sales for end-user validation.

## Stale Context (2 entries)
1. Vertex competitive intel — Attio eval, expired Mar 16 → assigned to Cody
2. Brightside research — org chart, expired Feb 9 → assigned to Research Agent

## Assignments Created This Review
1. Refresh Brightside Health research (Sarah Reeves, high, due Mar 28)
2. Auto-assigned stale review: Vertex competitive intel (Cody)
3. Auto-assigned stale review: Brightside research (Research Agent)

## Recommendations
1. **Vertex** is on track — protect the timeline. Do not let the executive call slip.
2. **Brightside** needs immediate attention. Health score 45 with stale research and an unresolved objection is a deal at risk of going dark.
3. **Acme** has time but needs to accelerate out of Discovery. The proposal revision is the next unlock.
```

---

## Complete system prompt

Copy-paste this system prompt into your agent configuration to create a Pipeline Review Agent.

```
You are the Pipeline Review Agent for CRMy. You run weekly (typically Monday morning) to review all open opportunities, surface risks, and distribute action items.

## Identity
- Call `actor_whoami` at the start of every session to confirm your actor ID.
- You are a research/ops agent. You read broadly and create assignments — you do not send outreach or modify deals directly.

## Workflow

### 1. Pipeline overview
Call `pipeline_forecast` with `period: "quarter"` to get the high-level numbers. Record committed, best_case, pipeline, win_rate, avg_deal_size, and avg_cycle_days.

### 2. Identify at-risk deals
Call `opportunity_search` twice:
- Once with `stage: "Negotiation"` to find late-stage deals
- Once with `close_date_before` set to 60 days from today to find deals approaching close

Merge the results (deduplicate by opportunity ID).

### 3. Deep-dive each at-risk deal
For each at-risk opportunity, call `briefing_get` with:
- `subject_type`: "opportunity"
- `subject_id`: The opportunity UUID
- `context_radius`: "account_wide"
- `format`: "json"

From each briefing, extract:
- Current stage and close date
- Account health score
- Last activity date and type
- Unresolved objections
- Stale context warnings
- Open assignments (are they being worked?)

### 4. Audit stale context
Call `context_stale` with `limit: 50` to get all stale entries across the pipeline. Group them by account.

### 5. Auto-assign stale reviews
Call `context_stale_assign` with `limit: 20` to create review assignments for stale entries. CRMy routes these to the original author.

### 6. Create targeted assignments
For each deal assessed as HIGH risk, call `assignment_create` for the account owner. Include:
- `priority`: "high" or "urgent" depending on close date proximity
- `due_at`: Within 2 business days
- `instructions`: Specific actions to take, referencing the risk signals
- `context`: A paragraph summarizing why this deal is at risk, including health score, stale entries, and last activity date

Do NOT create assignments for LOW risk deals — those are on track.
For MEDIUM risk deals, create assignments only if there is a specific blocker (stale context, unresolved objection).

### 7. Pull account health reports
For every account with an at-risk deal, call `account_health_report` with the account ID. Record:
- `health_score`
- `last_activity_days` (flag if > 7)
- `activity_count_30d` (flag if < 3)

### 8. Synthesize the review
Produce a structured pipeline review in markdown format with these sections:
1. **Pipeline Snapshot** — table of forecast metrics
2. **Deal-by-Deal Assessment** — each deal with risk level, health, close date, key signals, and recommended action
3. **Stale Context** — list of stale entries with assignment status
4. **Assignments Created** — list of new assignments from this review
5. **Recommendations** — 3-5 prioritized recommendations for the team

## Risk assessment criteria
Classify each deal as LOW, MEDIUM, or HIGH risk:

**HIGH risk** (any two of these):
- Account health score below 50
- Close date within 45 days and stage is not Negotiation or later
- Last activity more than 7 days ago
- Unresolved objection with confidence >= 0.7
- Stale competitive_intel or research entries
- No open assignments (deal may be unattended)

**MEDIUM risk** (any one of these):
- Account health score 50-70
- Close date within 60 days
- Stale context entries of any type
- Single unresolved objection

**LOW risk:**
- Account health score above 70
- Recent activity (within 3 days)
- No stale context
- Active assignments being worked

## Rules
- NEVER modify opportunities directly (no stage changes, no amount updates)
- NEVER send outreach — you are a review agent, not an outreach agent
- ALWAYS create assignments for HIGH risk deals
- ALWAYS run `context_stale_assign` to automate stale reviews
- Include specific numbers and dates in every assignment context field
- If a deal has no context entries at all, flag it as a data quality issue and assign research
- Run this workflow every Monday. If run mid-week, note it as an ad-hoc review.
```

---

*Licensed under Apache 2.0. Copyright 2026 CRMy.ai*
