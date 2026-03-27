# Build a post-meeting agent with CRMy

An agent that runs after every sales call. It logs the meeting, extracts structured context from the transcript, updates any superseded beliefs, and creates a follow-up assignment for the rep.

**What you will build:** A post-meeting processing pipeline that turns a raw call transcript into structured CRM context, flags stale intelligence, and hands off next steps to the right human.

**Prerequisites:**

- A running CRMy instance with demo data seeded (`crmy seed-demo`)
- MCP connection configured (`claude mcp add crmy -- npx @crmy/cli mcp`)

---

## Step 1 — Identify yourself

Every agent session starts by confirming identity. This tells CRMy who is writing context entries and creating assignments.

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
  "actor_id": "d0000000-0000-4000-a000-000000000003",
  "actor_type": "agent",
  "role": "member"
}
```

The agent now knows it is the **Outreach Agent** (`d0000000-0000-4000-a000-000000000003`). All subsequent writes will be attributed to this actor.

---

## Step 2 — Pull the pre-meeting briefing

Before processing the transcript, pull what was already known about this contact. This gives you the baseline to compare against.

We are briefing on **Sarah Chen** (`d0000000-0000-4000-c000-000000000001`), VP Engineering at Acme Corp.

**MCP tool call:**

```
briefing_get {
  "subject_type": "contact",
  "subject_id": "d0000000-0000-4000-c000-000000000001",
  "context_radius": "direct",
  "format": "json"
}
```

**CLI equivalent:**

```bash
crmy briefing contact:d0000000-0000-4000-c000-000000000001 --context-radius direct
```

**Response:**

```json
{
  "briefing": {
    "record": {
      "id": "d0000000-0000-4000-c000-000000000001",
      "first_name": "Sarah",
      "last_name": "Chen",
      "email": "sarah.chen@acme.com",
      "title": "VP Engineering",
      "account_id": "d0000000-0000-4000-b000-000000000001",
      "lifecycle_stage": "prospect"
    },
    "related": {
      "account": {
        "id": "d0000000-0000-4000-b000-000000000001",
        "name": "Acme Corp"
      }
    },
    "activities": [
      {
        "id": "d0000000-0000-4000-e000-000000000001",
        "type": "outreach_email",
        "subject": "Initial outreach to Sarah Chen",
        "outcome": "replied",
        "occurred_at": "2026-03-12T00:00:00.000Z"
      }
    ],
    "open_assignments": [],
    "context": [
      {
        "id": "d0000000-0000-4000-f000-000000000005",
        "context_type": "preference",
        "title": "Sarah Chen communication preferences",
        "body": "Sarah Chen prefers async communication (Slack or email) over calls. She responds fastest to technical content — architecture diagrams, API documentation, and code examples. Avoid scheduling calls before 10am PT. She is the internal champion at Acme.",
        "confidence": 0.9,
        "is_current": true
      }
    ],
    "stale_warnings": [],
    "token_estimate": 420
  }
}
```

**What to notice:** The briefing shows one preference context entry and one prior outreach activity. There are no stale warnings. Save this response — you will compare it to the enriched briefing at the end.

---

## Step 3 — Log the meeting

Create an activity record for the call that just happened. Use `occurred_at` set to the actual call time, not "now."

**MCP tool call:**

```
activity_create {
  "type": "meeting_held",
  "subject": "Follow-up call — Sarah Chen, Acme Corp",
  "body": "30-minute follow-up with Sarah Chen. Discussed pricing concerns, confirmed preference for annual billing, and learned that their VP Sales (Dana Park) is now involved in evaluation. Sarah mentioned Acme's board approved a $200K budget for CRM tooling in Q2.",
  "contact_id": "d0000000-0000-4000-c000-000000000001",
  "account_id": "d0000000-0000-4000-b000-000000000001",
  "opportunity_id": "d0000000-0000-4000-d000-000000000001",
  "direction": "outbound",
  "custom_fields": {
    "duration_minutes": 30,
    "attendees": ["sarah.chen@acme.com", "cody@crmy.ai"]
  }
}
```

**CLI equivalent:**

```bash
crmy activities create \
  --type meeting_held \
  --subject "Follow-up call — Sarah Chen, Acme Corp" \
  --body "30-minute follow-up with Sarah Chen. Discussed pricing concerns, confirmed preference for annual billing, and learned that their VP Sales (Dana Park) is now involved in evaluation. Sarah mentioned Acme's board approved a \$200K budget for CRM tooling in Q2." \
  --contact-id d0000000-0000-4000-c000-000000000001 \
  --account-id d0000000-0000-4000-b000-000000000001 \
  --opportunity-id d0000000-0000-4000-d000-000000000001 \
  --direction outbound
```

**Response:**

```json
{
  "activity": {
    "id": "a1b2c3d4-0000-4000-e000-000000000099",
    "type": "meeting_held",
    "subject": "Follow-up call — Sarah Chen, Acme Corp",
    "body": "30-minute follow-up with Sarah Chen...",
    "contact_id": "d0000000-0000-4000-c000-000000000001",
    "account_id": "d0000000-0000-4000-b000-000000000001",
    "opportunity_id": "d0000000-0000-4000-d000-000000000001",
    "performed_by": "d0000000-0000-4000-a000-000000000003",
    "occurred_at": "2026-03-26T14:30:00.000Z",
    "direction": "outbound",
    "created_at": "2026-03-26T14:35:00.000Z"
  },
  "event_id": "evt_abc123"
}
```

Save the `activity.id` — you will reference it as `source_activity_id` in the context entries below.

---

## Step 4 — Extract structured context from the transcript

Now extract three distinct context entries from the call. Each entry gets its own `context_type`, `confidence` score, and tags.

### 4a — Objection: pricing concern

**MCP tool call:**

```
context_add {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000001",
  "context_type": "objection",
  "title": "Sarah Chen raised annual vs. monthly billing concern",
  "body": "Sarah asked whether CRMy offers annual billing with a discount. She said 'our finance team strongly prefers annual contracts with net-30 terms — monthly billing is a non-starter for tools over $50K ARR.' This is a procurement process concern, not a price objection. Confirm annual billing availability in the next proposal revision.",
  "confidence": 0.9,
  "source": "follow_up_call",
  "source_activity_id": "a1b2c3d4-0000-4000-e000-000000000099",
  "tags": ["billing", "procurement", "annual-contract"],
  "valid_until": "2026-05-26"
}
```

**CLI equivalent:**

```bash
crmy context add \
  --subject-type account \
  --subject-id d0000000-0000-4000-b000-000000000001 \
  --context-type objection \
  --title "Sarah Chen raised annual vs. monthly billing concern" \
  --body "Sarah asked whether CRMy offers annual billing with a discount..." \
  --confidence 0.9 \
  --source follow_up_call \
  --tags billing,procurement,annual-contract \
  --valid-until 2026-05-26
```

**Response:**

```json
{
  "context_entry": {
    "id": "f0000001-0000-4000-f000-000000000099",
    "subject_type": "account",
    "subject_id": "d0000000-0000-4000-b000-000000000001",
    "context_type": "objection",
    "title": "Sarah Chen raised annual vs. monthly billing concern",
    "body": "Sarah asked whether CRMy offers annual billing with a discount...",
    "confidence": 0.9,
    "authored_by": "d0000000-0000-4000-a000-000000000003",
    "source": "follow_up_call",
    "source_activity_id": "a1b2c3d4-0000-4000-e000-000000000099",
    "tags": ["billing", "procurement", "annual-contract"],
    "is_current": true,
    "valid_until": "2026-05-26T00:00:00.000Z",
    "created_at": "2026-03-26T14:36:00.000Z"
  },
  "event_id": "evt_abc124"
}
```

### 4b — Preference: annual billing

**MCP tool call:**

```
context_add {
  "subject_type": "contact",
  "subject_id": "d0000000-0000-4000-c000-000000000001",
  "context_type": "preference",
  "title": "Sarah Chen confirmed preference for annual billing",
  "body": "Sarah explicitly stated that annual contracts with net-30 terms are required by Acme's finance team for any tool over $50K ARR. She said this is non-negotiable and to factor it into the proposal. She also confirmed she prefers receiving proposals as Google Docs links, not PDF attachments.",
  "confidence": 0.95,
  "source": "follow_up_call",
  "source_activity_id": "a1b2c3d4-0000-4000-e000-000000000099",
  "tags": ["billing", "proposal-format", "procurement"]
}
```

**CLI equivalent:**

```bash
crmy context add \
  --subject-type contact \
  --subject-id d0000000-0000-4000-c000-000000000001 \
  --context-type preference \
  --title "Sarah Chen confirmed preference for annual billing" \
  --body "Sarah explicitly stated that annual contracts with net-30 terms are required..." \
  --confidence 0.95 \
  --source follow_up_call \
  --tags billing,proposal-format,procurement
```

**Response:**

```json
{
  "context_entry": {
    "id": "f0000002-0000-4000-f000-000000000099",
    "subject_type": "contact",
    "subject_id": "d0000000-0000-4000-c000-000000000001",
    "context_type": "preference",
    "title": "Sarah Chen confirmed preference for annual billing",
    "confidence": 0.95,
    "is_current": true,
    "created_at": "2026-03-26T14:36:30.000Z"
  },
  "event_id": "evt_abc125"
}
```

### 4c — Relationship map: new stakeholder

**MCP tool call:**

```
context_add {
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000001",
  "context_type": "relationship_map",
  "title": "VP Sales Dana Park now involved in Acme evaluation",
  "body": "Sarah Chen revealed that Acme's VP Sales, Dana Park, is now actively involved in the CRM evaluation. Dana will be the primary end user and has been asked by Marcus Webb to evaluate the pipeline reporting features specifically. Sarah described Dana as 'pragmatic — she will test it herself before giving a thumbs-up.' We need to identify Dana's contact info and loop her in.",
  "confidence": 0.85,
  "source": "follow_up_call",
  "source_activity_id": "a1b2c3d4-0000-4000-e000-000000000099",
  "tags": ["stakeholder-map", "vp-sales", "end-user"]
}
```

**CLI equivalent:**

```bash
crmy context add \
  --subject-type account \
  --subject-id d0000000-0000-4000-b000-000000000001 \
  --context-type relationship_map \
  --title "VP Sales Dana Park now involved in Acme evaluation" \
  --body "Sarah Chen revealed that Acme's VP Sales, Dana Park, is now actively involved..." \
  --confidence 0.85 \
  --source follow_up_call \
  --tags stakeholder-map,vp-sales,end-user
```

**Response:**

```json
{
  "context_entry": {
    "id": "f0000003-0000-4000-f000-000000000099",
    "subject_type": "account",
    "subject_id": "d0000000-0000-4000-b000-000000000001",
    "context_type": "relationship_map",
    "title": "VP Sales Dana Park now involved in Acme evaluation",
    "confidence": 0.85,
    "is_current": true,
    "created_at": "2026-03-26T14:37:00.000Z"
  },
  "event_id": "evt_abc126"
}
```

---

## Step 5 — Check for contradicted beliefs

Search existing context to see if anything we just learned contradicts what was previously recorded.

**MCP tool call:**

```
context_search {
  "query": "competitive evaluation Acme alternative CRM",
  "subject_type": "account",
  "subject_id": "d0000000-0000-4000-b000-000000000001",
  "current_only": true
}
```

**CLI equivalent:**

```bash
crmy context search "competitive evaluation Acme alternative CRM" \
  --subject-type account \
  --subject-id d0000000-0000-4000-b000-000000000001 \
  --current-only
```

**Response:**

```json
{
  "context_entries": [
    {
      "id": "d0000000-0000-4000-f000-000000000007",
      "context_type": "relationship_map",
      "title": "Acme Corp internal dynamics",
      "body": "Sarah Chen (VP Engineering) is the champion. Marcus Webb (CFO) is the economic buyer and final decision maker. There is a third stakeholder — their VP Sales (name unknown) who would be the primary end user.",
      "confidence": 0.8,
      "is_current": true,
      "authored_by": "d0000000-0000-4000-a000-000000000001"
    }
  ],
  "total": 1
}
```

**What to notice:** The existing relationship map entry (`d0000000-0000-4000-f000-000000000007`) says "VP Sales (name unknown)." We now know the VP Sales is Dana Park. However, since we added a *new* relationship_map entry with the updated info, both entries remain current. In this case we do not need to supersede — the new entry supplements the old one with the name. The old entry is still accurate (just incomplete).

Now let us check the stale competitive intel entry for Vertex that the demo seed data marks as outdated.

---

## Step 6 — Supersede stale competitive intelligence

The demo seed data includes a competitive_intel entry (`d0000000-0000-4000-f000-000000000004`) about Vertex Logistics considering Attio. The `valid_until` date has passed and the confidence is only 0.6. From the Vertex PoC results, we know this is no longer accurate.

**MCP tool call:**

```
context_supersede {
  "id": "d0000000-0000-4000-f000-000000000004",
  "title": "Vertex no longer evaluating Attio — CRMy selected after PoC",
  "body": "Vertex Logistics is no longer evaluating Attio as a CRM alternative. After the PoC exceeded throughput targets by 22%, Tomás Rivera confirmed CRMy is the selected vendor. The only remaining gate is CEO Keiko Yamamoto's sign-off on the annual contract. Previous intelligence about Attio evaluation is superseded.",
  "confidence": 0.95,
  "tags": ["competitive", "attio", "poc-complete", "vendor-selected"]
}
```

**CLI equivalent:**

```bash
crmy context supersede d0000000-0000-4000-f000-000000000004 \
  --title "Vertex no longer evaluating Attio — CRMy selected after PoC" \
  --body "Vertex Logistics is no longer evaluating Attio as a CRM alternative..." \
  --confidence 0.95 \
  --tags competitive,attio,poc-complete,vendor-selected
```

**Response:**

```json
{
  "context_entry": {
    "id": "f0000004-0000-4000-f000-000000000099",
    "subject_type": "account",
    "subject_id": "d0000000-0000-4000-b000-000000000003",
    "context_type": "competitive_intel",
    "title": "Vertex no longer evaluating Attio — CRMy selected after PoC",
    "body": "Vertex Logistics is no longer evaluating Attio as a CRM alternative...",
    "confidence": 0.95,
    "is_current": true,
    "tags": ["competitive", "attio", "poc-complete", "vendor-selected"],
    "created_at": "2026-03-26T14:38:00.000Z"
  },
  "superseded": {
    "id": "d0000000-0000-4000-f000-000000000004",
    "title": "Vertex considering Attio as alternative",
    "is_current": false,
    "superseded_by": "f0000004-0000-4000-f000-000000000099"
  },
  "event_id": "evt_abc127"
}
```

The old entry is now marked `is_current: false` and will no longer appear in briefings (unless `include_stale: true` is set).

---

## Step 7 — Create a follow-up assignment for the rep

Hand off the next action to the human rep (Cody, `d0000000-0000-4000-a000-000000000001`) with full context from the call.

**MCP tool call:**

```
assignment_create {
  "title": "Send revised proposal to Sarah Chen with annual billing terms",
  "assignee_actor_id": "d0000000-0000-4000-a000-000000000001",
  "subject_type": "opportunity",
  "subject_id": "d0000000-0000-4000-d000-000000000001",
  "instructions": "Send the revised Acme Corp proposal to Sarah Chen. Include annual billing with net-30 terms (required by their finance team). Send as a Google Docs link, not PDF. CC Dana Park (VP Sales) if we have her email — she is now part of the evaluation.",
  "priority": "high",
  "due_at": "2026-03-28T17:00:00.000Z",
  "context": "From the follow-up call on 2026-03-26: (1) Sarah confirmed annual billing is mandatory for tools over $50K ARR. (2) VP Sales Dana Park is now involved and will evaluate pipeline reporting features. (3) Sarah prefers Google Docs links over PDF attachments. (4) Acme board approved $200K Q2 budget for CRM tooling."
}
```

**CLI equivalent:**

```bash
crmy assignments create \
  --title "Send revised proposal to Sarah Chen with annual billing terms" \
  --assignee d0000000-0000-4000-a000-000000000001 \
  --subject-type opportunity \
  --subject-id d0000000-0000-4000-d000-000000000001 \
  --priority high \
  --due-at 2026-03-28T17:00:00.000Z \
  --instructions "Send the revised Acme Corp proposal to Sarah Chen..."
```

**Response:**

```json
{
  "assignment": {
    "id": "a0000001-0000-4000-f100-000000000099",
    "title": "Send revised proposal to Sarah Chen with annual billing terms",
    "assignee_actor_id": "d0000000-0000-4000-a000-000000000001",
    "assigner_actor_id": "d0000000-0000-4000-a000-000000000003",
    "subject_type": "opportunity",
    "subject_id": "d0000000-0000-4000-d000-000000000001",
    "status": "pending",
    "priority": "high",
    "due_at": "2026-03-28T17:00:00.000Z",
    "context": "From the follow-up call on 2026-03-26: (1) Sarah confirmed annual billing is mandatory...",
    "created_at": "2026-03-26T14:39:00.000Z"
  },
  "event_id": "evt_abc128"
}
```

---

## Step 8 — Pull the enriched briefing

Call `briefing_get` again on the same contact. Compare the response to Step 2.

**MCP tool call:**

```
briefing_get {
  "subject_type": "contact",
  "subject_id": "d0000000-0000-4000-c000-000000000001",
  "context_radius": "direct",
  "format": "json"
}
```

**CLI equivalent:**

```bash
crmy briefing contact:d0000000-0000-4000-c000-000000000001 --context-radius direct
```

**Response:**

```json
{
  "briefing": {
    "record": {
      "id": "d0000000-0000-4000-c000-000000000001",
      "first_name": "Sarah",
      "last_name": "Chen",
      "email": "sarah.chen@acme.com",
      "title": "VP Engineering",
      "account_id": "d0000000-0000-4000-b000-000000000001",
      "lifecycle_stage": "prospect"
    },
    "related": {
      "account": {
        "id": "d0000000-0000-4000-b000-000000000001",
        "name": "Acme Corp"
      }
    },
    "activities": [
      {
        "id": "a1b2c3d4-0000-4000-e000-000000000099",
        "type": "meeting_held",
        "subject": "Follow-up call — Sarah Chen, Acme Corp",
        "outcome": null,
        "occurred_at": "2026-03-26T14:30:00.000Z"
      },
      {
        "id": "d0000000-0000-4000-e000-000000000001",
        "type": "outreach_email",
        "subject": "Initial outreach to Sarah Chen",
        "outcome": "replied",
        "occurred_at": "2026-03-12T00:00:00.000Z"
      }
    ],
    "open_assignments": [
      {
        "id": "a0000001-0000-4000-f100-000000000099",
        "title": "Send revised proposal to Sarah Chen with annual billing terms",
        "status": "pending",
        "priority": "high",
        "due_at": "2026-03-28T17:00:00.000Z"
      }
    ],
    "context": [
      {
        "id": "f0000002-0000-4000-f000-000000000099",
        "context_type": "preference",
        "title": "Sarah Chen confirmed preference for annual billing",
        "confidence": 0.95,
        "is_current": true
      },
      {
        "id": "d0000000-0000-4000-f000-000000000005",
        "context_type": "preference",
        "title": "Sarah Chen communication preferences",
        "confidence": 0.9,
        "is_current": true
      }
    ],
    "stale_warnings": [],
    "token_estimate": 780
  }
}
```

**What changed:**

| Field | Before | After |
|---|---|---|
| Activities | 1 (outreach email) | 2 (+ follow-up meeting) |
| Context entries | 1 (communication prefs) | 2 (+ annual billing preference) |
| Open assignments | 0 | 1 (send revised proposal) |
| Token estimate | 420 | 780 |

The briefing now reflects everything the agent learned. The next agent — or the human rep — can call `briefing_get` and get the full picture in a single request.

---

## Complete system prompt

Copy-paste this system prompt into your agent configuration to create a Post-Meeting Agent.

```
You are the Post-Meeting Agent for CRMy. You run after every sales call to process the transcript and update the CRM.

## Identity
- Call `actor_whoami` at the start of every session to confirm your actor ID.
- All context entries and assignments you create will be attributed to your actor.

## Workflow

### 1. Pre-meeting baseline
Call `briefing_get` with `context_radius: "direct"` on the primary contact from the meeting. Save this response — you will compare it to the enriched version at the end.

### 2. Log the meeting
Call `activity_create` with:
- `type`: "meeting_held"
- `subject`: A concise title including the contact name and company
- `body`: A 2-3 sentence summary of the call
- `contact_id`, `account_id`, `opportunity_id`: Link to all relevant CRM objects
- `occurred_at`: The actual time the call happened (not the current time if processing is delayed)

Save the returned `activity.id` for use as `source_activity_id` in context entries.

### 3. Extract context entries
Parse the transcript for these context types. Create one `context_add` call per entry:

- **objection**: Any concern, pushback, or blocker raised. Set confidence 0.8-0.95 based on how explicit the objection was.
- **preference**: Communication preferences, decision-making style, scheduling constraints, format preferences. Set confidence 0.85-0.95.
- **relationship_map**: New stakeholders mentioned, reporting structures, influence dynamics. Set confidence 0.7-0.9 depending on whether the info is firsthand or secondhand.
- **competitive_intel**: Mentions of other vendors, pricing comparisons, feature gaps. Set confidence based on recency and source reliability.
- **meeting_notes**: A structured summary of the call itself. Set confidence 1.0.

For every context entry:
- Always set `source_activity_id` to the meeting activity you just created
- Always set `source` to a descriptive label like "follow_up_call" or "discovery_call"
- Set `valid_until` for time-sensitive facts (competitive intel, budget windows, headcount)
- Tag entries with 2-4 lowercase, hyphenated tags for searchability

### 4. Check for contradictions
Call `context_search` with keywords from your new entries to find potentially contradicted existing context. Look for:
- Relationship maps that are now incomplete or wrong
- Competitive intel that has been overtaken by events
- Preferences that have changed
- Objections that have been resolved

### 5. Supersede stale entries
For each contradicted entry, call `context_supersede` with:
- The `id` of the stale entry
- Updated `body` explaining what changed
- A new `confidence` score (usually higher, since the new info is fresher)
- Updated `tags`

Do NOT supersede entries that are merely incomplete — only supersede when the old information is actually wrong or misleading.

### 6. Create follow-up assignments
Call `assignment_create` for each actionable next step. Include:
- `assignee_actor_id`: The human rep who should act (use the account owner or the meeting host)
- `subject_type` and `subject_id`: Link to the relevant opportunity or contact
- `priority`: "urgent" for time-sensitive items, "high" for important follow-ups, "normal" for routine
- `due_at`: A reasonable deadline (usually 1-3 business days)
- `context`: A summary of WHY this action matters, drawn from the call. Include specific quotes or facts.
- `instructions`: Clear, specific instructions on WHAT to do

### 7. Verify enrichment
Call `briefing_get` again with the same parameters as Step 1. Compare the before/after to confirm all context was stored correctly.

## Confidence scoring guidelines
- 1.0: Direct quote or explicit statement from the contact
- 0.9-0.95: Clear implication from the conversation with high certainty
- 0.8-0.9: Reasonable inference supported by multiple signals
- 0.7-0.8: Secondhand information or educated guess
- 0.5-0.7: Weak signal, needs verification
- Below 0.5: Do not store — request verification instead

## Rules
- Never fabricate context that was not in the transcript
- Never set confidence higher than the evidence warrants
- Always link context entries to the source activity
- If unsure about a fact, create an assignment asking the rep to verify rather than storing low-confidence context
- Process every meeting, even short ones — a 5-minute call can contain critical context updates
```

---

*Licensed under Apache 2.0. Copyright 2026 CRMy.ai*
