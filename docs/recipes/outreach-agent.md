# Build a pre-outreach briefing agent with CRMy

An agent that runs before every outreach action. It pulls a briefing, checks for sensitivities, drafts a personalized message, and submits a HITL request for high-value sends.

**What you will build:** A pre-send pipeline that ensures every outreach message is grounded in CRM context, respects contact preferences, and gets human approval when the stakes are high.

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
  "actor_id": "d0000000-0000-4000-a000-000000000003",
  "actor_type": "agent",
  "role": "member"
}
```

The agent is the **Outreach Agent** (`d0000000-0000-4000-a000-000000000003`).

---

## Step 2 — Pull the contact briefing with account context

Before drafting any outreach, get a complete briefing on the target contact. Use `context_radius: "adjacent"` to pull in context from the parent account, and set a `token_budget` to keep the payload manageable for your LLM context window.

We are preparing outreach to **Priya Nair** (`d0000000-0000-4000-c000-000000000003`), CTO at Brightside Health.

**MCP tool call:**

```
briefing_get {
  "subject_type": "contact",
  "subject_id": "d0000000-0000-4000-c000-000000000003",
  "context_radius": "adjacent",
  "token_budget": 4000,
  "format": "json"
}
```

**CLI equivalent:**

```bash
crmy briefing contact:d0000000-0000-4000-c000-000000000003 \
  --context-radius adjacent \
  --token-budget 4000
```

**Response:**

```json
{
  "briefing": {
    "record": {
      "id": "d0000000-0000-4000-c000-000000000003",
      "first_name": "Priya",
      "last_name": "Nair",
      "email": "p.nair@brightsidehealth.com",
      "title": "CTO",
      "account_id": "d0000000-0000-4000-b000-000000000002",
      "lifecycle_stage": "active"
    },
    "related": {
      "account": {
        "id": "d0000000-0000-4000-b000-000000000002",
        "name": "Brightside Health",
        "industry": "Healthcare",
        "health_score": 45
      },
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
    "activities": [
      {
        "id": "d0000000-0000-4000-e000-000000000005",
        "type": "outreach_call",
        "subject": "Follow-up call to Dr. Priya Nair",
        "outcome": "voicemail",
        "occurred_at": "2026-03-23T00:00:00.000Z"
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
        "body": "Dr. Nair raised concerns about MCP being a proprietary protocol controlled by Anthropic. She asked specifically whether CRMy would work with non-Anthropic models and whether the MCP specification is truly open. This objection can likely be addressed by showing the open-source MCP spec and demonstrating multi-model support, but we have not had the opportunity to do so yet.",
        "confidence": 0.7,
        "is_current": true,
        "valid_until": "2026-04-25T00:00:00.000Z"
      },
      {
        "id": "d0000000-0000-4000-f000-000000000003",
        "context_type": "competitive_intel",
        "title": "Brightside evaluating HubSpot and Attio",
        "body": "Brightside Health is actively evaluating HubSpot (Enterprise tier, $3,600/mo) and Attio (Growth plan, $1,200/mo) alongside CRMy. Neither has MCP support. Our differentiator is the open-source, self-hosted model with native MCP.",
        "confidence": 0.85,
        "is_current": true,
        "valid_until": "2026-05-10T00:00:00.000Z"
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
    "adjacent_context": [
      {
        "id": "d0000000-0000-4000-f000-000000000002",
        "context_type": "objection",
        "title": "Concern about vendor lock-in with proprietary MCP",
        "subject_type": "account",
        "subject_id": "d0000000-0000-4000-b000-000000000002"
      },
      {
        "id": "d0000000-0000-4000-f000-000000000003",
        "context_type": "competitive_intel",
        "title": "Brightside evaluating HubSpot and Attio",
        "subject_type": "account",
        "subject_id": "d0000000-0000-4000-b000-000000000002"
      }
    ],
    "token_estimate": 1850,
    "truncated": false
  }
}
```

---

## Step 3 — Read stale warnings and decide whether to act

The briefing includes a `stale_warnings` array. Each entry is a context entry whose `valid_until` has passed but remains `is_current: true`. Before drafting outreach, you need to decide what to do about stale data.

**How to interpret stale warnings:**

| Stale context type | Risk level | Action |
|---|---|---|
| `research` (org chart, tech stack) | Medium | Draft outreach that does not rely on stale facts. Flag for review. |
| `competitive_intel` | High | Do not reference competitor pricing or status from stale entries. |
| `objection` | High | Verify before addressing — the objection may have been resolved. |
| `preference` | Low | Preferences change slowly. Acceptable to use with caution. |

In our case, the stale entry is the Brightside org chart research (`d0000000-0000-4000-f000-000000000009`). The org chart is from January and mentions a "new CTO hire rumored for Q1 2026." Since Priya Nair is *still* the CTO (she is our contact), we should:

1. **Not reference specific org chart details** in the outreach (the team size and structure may have changed)
2. **Not block the outreach** — the stale data does not directly affect our messaging
3. **Let the existing assignment handle it** — there is already a pending assignment to review this research

---

## Step 4 — Use objection and preference context to shape the draft

The briefing surfaced two critical context entries that must shape the outreach:

### Objection: MCP vendor lock-in concern

Priya explicitly asked whether MCP is proprietary. The outreach should proactively address this by linking to the open MCP specification and highlighting multi-model support. Do not be defensive — lead with openness.

### Competitive intel: evaluating HubSpot and Attio

Brightside is comparing CRMy against HubSpot ($3,600/mo) and Attio ($1,200/mo). Neither has MCP support. The outreach should position the open-source, self-hosted model as the differentiator without directly attacking competitors.

**Draft the outreach based on these signals:**

```
Subject: CRMy's open MCP spec + multi-model support — quick follow-up

Dr. Nair,

Following up on our earlier conversation. You raised an important question about
MCP being a proprietary protocol — I wanted to share two things:

1. The MCP specification is fully open source (spec.modelcontextprotocol.io).
   CRMy implements the standard spec and works with any MCP-compatible model,
   not just Anthropic's.

2. CRMy is self-hosted and Apache 2.0 licensed. Your team keeps full control
   of the data and infrastructure — no vendor dependency on us either.

I know your team is evaluating several options right now. Happy to set up a
15-minute technical walkthrough showing multi-model MCP in action if that
would be useful.

Best,
Cody
```

---

## Step 5 — Log the outreach draft as an activity

**MCP tool call:**

```
activity_create {
  "type": "outreach_email",
  "subject": "Pre-outreach email draft to Dr. Priya Nair — MCP openness follow-up",
  "body": "Drafted personalized follow-up addressing Priya's MCP vendor lock-in concern. Linked to open MCP spec and highlighted self-hosted model. Positioned against HubSpot/Attio without naming them. Awaiting HITL approval before send.",
  "contact_id": "d0000000-0000-4000-c000-000000000003",
  "account_id": "d0000000-0000-4000-b000-000000000002",
  "opportunity_id": "d0000000-0000-4000-d000-000000000002",
  "direction": "outbound",
  "custom_fields": {
    "to": "p.nair@brightsidehealth.com",
    "subject_line": "CRMy's open MCP spec + multi-model support — quick follow-up",
    "channel": "email",
    "status": "draft_pending_approval"
  }
}
```

**CLI equivalent:**

```bash
crmy activities create \
  --type outreach_email \
  --subject "Pre-outreach email draft to Dr. Priya Nair — MCP openness follow-up" \
  --body "Drafted personalized follow-up addressing Priya's MCP vendor lock-in concern..." \
  --contact-id d0000000-0000-4000-c000-000000000003 \
  --account-id d0000000-0000-4000-b000-000000000002 \
  --opportunity-id d0000000-0000-4000-d000-000000000002 \
  --direction outbound
```

**Response:**

```json
{
  "activity": {
    "id": "e0000001-0000-4000-e000-000000000099",
    "type": "outreach_email",
    "subject": "Pre-outreach email draft to Dr. Priya Nair — MCP openness follow-up",
    "body": "Drafted personalized follow-up addressing Priya's MCP vendor lock-in concern...",
    "contact_id": "d0000000-0000-4000-c000-000000000003",
    "account_id": "d0000000-0000-4000-b000-000000000002",
    "opportunity_id": "d0000000-0000-4000-d000-000000000002",
    "performed_by": "d0000000-0000-4000-a000-000000000003",
    "occurred_at": "2026-03-26T15:00:00.000Z",
    "direction": "outbound",
    "created_at": "2026-03-26T15:00:00.000Z"
  },
  "event_id": "evt_def001"
}
```

---

## Step 6 — Submit HITL approval for high-value sends

This is a first-contact follow-up with a C-suite executive (CTO). The agent should not send autonomously — submit a human-in-the-loop approval request.

**When to require HITL approval:**

- First contact with a C-suite or VP-level executive
- Outreach to contacts at accounts with health score below 50
- Messages that reference pricing, contracts, or competitive positioning
- Any send where the contact has an unresolved objection

Priya Nair hits three of these four criteria. Submit the request with `auto_approve_after_seconds: 3600` so it does not block indefinitely.

**MCP tool call:**

```
hitl_submit_request {
  "action_type": "send_email",
  "action_summary": "Send follow-up email to Dr. Priya Nair (CTO, Brightside Health) addressing her MCP vendor lock-in concern. Email links to open MCP spec and positions self-hosted model. This is a C-suite contact at a low-health account (45) with an unresolved objection.",
  "action_payload": {
    "to": "p.nair@brightsidehealth.com",
    "subject": "CRMy's open MCP spec + multi-model support — quick follow-up",
    "body_text": "Dr. Nair, Following up on our earlier conversation. You raised an important question about MCP being a proprietary protocol — I wanted to share two things: 1. The MCP specification is fully open source (spec.modelcontextprotocol.io). CRMy implements the standard spec and works with any MCP-compatible model, not just Anthropic's. 2. CRMy is self-hosted and Apache 2.0 licensed. Your team keeps full control of the data and infrastructure — no vendor dependency on us either. I know your team is evaluating several options right now. Happy to set up a 15-minute technical walkthrough showing multi-model MCP in action if that would be useful. Best, Cody",
    "contact_id": "d0000000-0000-4000-c000-000000000003",
    "opportunity_id": "d0000000-0000-4000-d000-000000000002",
    "draft_activity_id": "e0000001-0000-4000-e000-000000000099"
  },
  "auto_approve_after_seconds": 3600
}
```

**CLI equivalent:**

```bash
crmy hitl submit \
  --action-type send_email \
  --action-summary "Send follow-up email to Dr. Priya Nair (CTO, Brightside Health)..." \
  --auto-approve-after 3600 \
  --payload '{"to":"p.nair@brightsidehealth.com","subject":"CRMy'\''s open MCP spec + multi-model support","contact_id":"d0000000-0000-4000-c000-000000000003"}'
```

**Response:**

```json
{
  "request_id": "hitl_00000001-0000-4000-9000-000000000099",
  "status": "pending_review"
}
```

---

## Step 7 — Poll for approval status

The agent should poll `hitl_check_status` on a schedule. A typical pattern is to check every 30-60 seconds, with a maximum wait time matching `auto_approve_after_seconds`.

**MCP tool call:**

```
hitl_check_status {
  "request_id": "hitl_00000001-0000-4000-9000-000000000099"
}
```

**CLI equivalent:**

```bash
crmy hitl status hitl_00000001-0000-4000-9000-000000000099
```

**Response (pending):**

```json
{
  "status": "pending_review",
  "review_note": null
}
```

**Response (approved):**

```json
{
  "status": "approved",
  "review_note": "Looks good. Add a PS about the upcoming webinar on April 10."
}
```

**Response (rejected):**

```json
{
  "status": "rejected",
  "review_note": "Too soon after the voicemail. Wait until Thursday."
}
```

**Recommended poll loop pattern:**

```python
import time

request_id = "hitl_00000001-0000-4000-9000-000000000099"
max_wait = 3600  # matches auto_approve_after_seconds
poll_interval = 60
elapsed = 0

while elapsed < max_wait:
    result = crmy.hitl_check_status(request_id=request_id)

    if result["status"] == "approved":
        # Proceed to send
        send_email(result)
        break
    elif result["status"] == "rejected":
        # Log rejection, do not send
        log_rejection(result)
        break
    else:
        time.sleep(poll_interval)
        elapsed += poll_interval
```

If the loop exits without a human decision, `auto_approve_after_seconds` triggers automatic approval server-side — the next poll will return `"status": "approved"`.

---

## Step 8 — On approval, log the final send

Once approved, send the email and log it as a second activity. This creates a clear audit trail: draft activity (Step 5) followed by sent activity (this step).

**MCP tool call:**

```
activity_create {
  "type": "outreach_email",
  "subject": "Sent: follow-up email to Dr. Priya Nair — MCP openness",
  "body": "Email sent to p.nair@brightsidehealth.com after HITL approval. Reviewer note: 'Looks good. Add a PS about the upcoming webinar on April 10.' PS was added before sending.",
  "contact_id": "d0000000-0000-4000-c000-000000000003",
  "account_id": "d0000000-0000-4000-b000-000000000002",
  "opportunity_id": "d0000000-0000-4000-d000-000000000002",
  "direction": "outbound",
  "custom_fields": {
    "to": "p.nair@brightsidehealth.com",
    "subject_line": "CRMy's open MCP spec + multi-model support — quick follow-up",
    "channel": "email",
    "status": "sent",
    "hitl_request_id": "hitl_00000001-0000-4000-9000-000000000099",
    "reviewer_note": "Looks good. Add a PS about the upcoming webinar on April 10."
  }
}
```

**CLI equivalent:**

```bash
crmy activities create \
  --type outreach_email \
  --subject "Sent: follow-up email to Dr. Priya Nair — MCP openness" \
  --body "Email sent to p.nair@brightsidehealth.com after HITL approval..." \
  --contact-id d0000000-0000-4000-c000-000000000003 \
  --account-id d0000000-0000-4000-b000-000000000002 \
  --opportunity-id d0000000-0000-4000-d000-000000000002 \
  --direction outbound
```

**Response:**

```json
{
  "activity": {
    "id": "e0000002-0000-4000-e000-000000000099",
    "type": "outreach_email",
    "subject": "Sent: follow-up email to Dr. Priya Nair — MCP openness",
    "body": "Email sent to p.nair@brightsidehealth.com after HITL approval...",
    "contact_id": "d0000000-0000-4000-c000-000000000003",
    "performed_by": "d0000000-0000-4000-a000-000000000003",
    "occurred_at": "2026-03-26T15:45:00.000Z",
    "direction": "outbound",
    "created_at": "2026-03-26T15:45:00.000Z"
  },
  "event_id": "evt_def003"
}
```

---

## Complete system prompt

Copy-paste this system prompt into your agent configuration to create a Pre-Outreach Briefing Agent.

```
You are the Outreach Agent for CRMy. You run before every outreach action to ensure messages are personalized, context-aware, and approved when necessary.

## Identity
- Call `actor_whoami` at the start of every session to confirm your actor ID.
- You are an agent actor — all activities and context entries are attributed to you.

## Workflow

### 1. Pull the briefing
For every outreach target, call `briefing_get` with:
- `subject_type`: "contact"
- `subject_id`: The target contact's UUID
- `context_radius`: "adjacent" (to include account-level context)
- `token_budget`: 4000 (adjust based on your model's context window)
- `format`: "json"

### 2. Evaluate stale warnings
Check the `stale_warnings` array in the briefing response. For each stale entry:
- If `context_type` is "competitive_intel" or "objection": Do NOT reference this information in outreach. It may be wrong.
- If `context_type` is "research": Avoid referencing specific facts from the stale entry (team sizes, org chart details).
- If `context_type` is "preference": Use with caution — preferences change slowly but do change.
- If there is no existing assignment to review the stale entry, consider creating one via `assignment_create`.

### 3. Draft the outreach
Use the context entries to personalize the message:

**Objections** → Address proactively. If the contact raised a concern, lead with the answer. Do not ignore known objections — that erodes trust.

**Preferences** → Match the contact's communication style. If they prefer brevity, be brief. If they want data, lead with numbers. If they prefer async, do not ask for a call.

**Competitive intel** → Position against competitors without naming them directly unless the contact already brought them up. Focus on CRMy's differentiators.

**Relationship map** → Reference shared connections or previous interactions. If a champion is involved, acknowledge their role.

### 4. Log the draft
Call `activity_create` with `type: "outreach_email"` to record the draft. Include:
- The full email text in `detail` or `custom_fields`
- Status as "draft_pending_approval"
- Links to the contact, account, and opportunity

### 5. Decide whether to request HITL approval
Submit a `hitl_submit_request` when ANY of these conditions are true:
- First contact with a C-suite or VP-level executive
- Account health score is below 50
- The message references pricing, contracts, or competitive positioning
- The contact has an unresolved objection
- The deal is in Negotiation or later stage
- The message is going to more than one recipient

Set `auto_approve_after_seconds` based on urgency:
- 3600 (1 hour) for standard outreach
- 7200 (2 hours) for first-contact C-suite
- 300 (5 minutes) for time-sensitive follow-ups where the context is well-established

If none of the above conditions are true, skip HITL and proceed to send.

### 6. Poll for approval
Call `hitl_check_status` every 60 seconds until the status changes from "pending_review".

On "approved":
- Incorporate any `review_note` feedback into the final message
- Proceed to send

On "rejected":
- Log the rejection reason
- Do NOT send
- If the reviewer included guidance (e.g., "wait until Thursday"), create an assignment or schedule a retry

### 7. Log the send
After sending, call `activity_create` again with:
- `type`: "outreach_email"
- Subject prefixed with "Sent: "
- Include the HITL request ID and reviewer note in `custom_fields`
- Status as "sent"

This creates a draft → approval → sent audit trail in the contact's timeline.

## Rules
- NEVER send outreach to a contact without first calling `briefing_get`
- NEVER ignore stale warnings — they exist for a reason
- NEVER send to C-suite contacts without HITL approval
- ALWAYS address known objections — ignoring them makes the next conversation harder
- ALWAYS log both the draft and the final send as separate activities
- If the briefing shows no context at all for a contact, create an assignment requesting research before drafting outreach
- Keep emails under 150 words unless the contact's preference context indicates they want detail
```

---

*Licensed under Apache 2.0. Copyright 2026 CRMy.ai*
