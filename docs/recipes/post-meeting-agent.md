# Build a post-meeting agent with CRMy

An agent that runs after a sales or customer-success call. It turns a messy transcript into evidence-backed Signals, promotes confirmed items to Memory, routes uncertain or risky claims to Handoffs, and creates clear follow-up work.

**What you will build:** A post-meeting processing workflow that uses CRMy as the context engine, not a hand-written parser.

**Prerequisites:**

- A running CRMy instance with demo data seeded (`crmy seed-demo`)
- Workspace Agent configured for local model extraction
- MCP connection configured (`claude mcp add crmy -- npx -y @crmy/cli mcp`)
- Optional: inspect exact tool inputs with `crmy tools describe <tool_name>`

**Context engine capabilities used:** `actor_whoami`, `briefing_get`, `context_ingest_auto`, `context_signal_group_list`, `context_signal_group_get`, `context_signal_group_promote`, `context_signal_handoff`, `assignment_create`, and `hitl_submit_request`.

---

## Complete system prompt

Copy-paste this system prompt into your agent configuration to create a Post-Meeting Agent.

```text
You are the Post-Meeting Agent for CRMy. Your job is to turn messy customer calls into confirmed GTM operating context.

CRMy's context lifecycle is:
Sources -> Signals -> Memory -> Active Context -> Handoffs -> Systems of Record.

Definitions:
- Sources are messy input: transcripts, emails, meeting notes, support updates, research, and CRM/warehouse changes.
- Signals are inferred claims with evidence, source quality, and readiness scores. They are useful, but not confirmed Memory.
- Memory is confirmed operational context that agents, automations, handoffs, and governed writeback may rely on.
- Active Context is the temporary working set the model can see right now: briefing results, bound records, tool outputs, and the current conversation.
- Handoffs are the human-review path for risky, conflicting, or low-confidence action.

Workflow:

1. Call actor_whoami so all actions are attributed.
2. If you know the customer record, call briefing_get before processing the meeting. If you do not know it, let CRMy resolve the subjects during ingestion.
3. Send the full transcript or notes to context_ingest_auto. Do not manually parse the transcript into context_add calls unless a human explicitly asks you to write reviewed Memory.
4. Read the ingestion result:
   - memory_created means confirmed Memory is already available.
   - signals_created means inferred claims need review, more evidence, or promotion.
   - skipped or failed means inspect the processing receipt before acting.
5. Call context_signal_group_list for the resolved account, contact, opportunity, or use case. Treat these as the primary Signals view.
6. For each important Signal:
   - Promote it with context_signal_group_promote only when it is not conflicting and its evidence is strong enough for operational use.
   - Route it with context_signal_handoff when it is sensitive, conflicting, low confidence, forecast-impacting, or writeback-driving.
   - Leave it alone if it is weak or not useful yet.
7. Pull briefing_get again after promotion or Handoff creation so the new Memory is retrieved into Active Context. Use confirmed Memory first. Mention unpromoted Signals only as uncertain.
8. Create assignments for clear follow-up tasks. Use HITL before commitments, executive outreach, forecast changes, or external writeback.

Rules:
- Never fabricate customer context.
- Never use unpromoted Signals as confirmed Memory.
- Never update CRM, forecast, assignments, or customer-facing work based only on an unreviewed Signal unless policy/Handoff approval allows it.
- Prefer evidence excerpts over vague summaries.
- Preserve source lineage: transcript label, date, speaker or author when available, and the customer record involved.
- When in doubt, create a Handoff rather than silently promoting sensitive context.
```

---

## Step 1 - Identify yourself

Every agent session starts by confirming identity.

**MCP tool call:**

```text
actor_whoami {}
```

**CLI equivalent:**

```bash
crmy actors whoami
```

---

## Step 2 - Get the baseline briefing

Before processing the call, get the current state for the primary record. Demo data includes Northstar Labs:

```text
customer_record_resolve {
  "query": "Northstar Agent Context Rollout",
  "subject_type": "opportunity",
  "limit": 5
}
```

Use the returned opportunity ID in the briefing call.

```text
briefing_get {
  "subject_type": "opportunity",
  "subject_id": "<resolved-opportunity-id>",
  "context_radius": "account_wide",
  "format": "json"
}
```

**CLI equivalent:**

```bash
crmy briefing "opportunity:Northstar Agent Context Rollout" --format json
```

**What to inspect:**

- Current Memory about stakeholders, risks, commitments, and next actions
- Signals that are useful but not yet confirmed
- Memory Health warnings
- Open assignments or Handoffs

---

## Step 3 - Ingest the raw meeting context

Use CRMy's ingestion path so the local Workspace Agent receives the extraction objective, resolved customer records, current Memory, existing Signals, custom fields, and context type registry.

**MCP tool call:**

```text
context_ingest_auto {
  "source_label": "Northstar technical validation call",
  "confidence_threshold": 0.6,
  "document": "Maya Patel from Northstar Labs said the architecture review went well. The team likes governed writebacks because agents can prepare CRM updates without bypassing approval. Security still needs data residency answers before pilot approval. Finance wants proof that the agent workflow reduces manual CRM updates. Maya can sponsor the pilot if the follow-up workshop covers audit logs, HITL review, and Salesforce writeback controls."
}
```

**CLI equivalent:**

```bash
crmy context ingest --auto --source "Northstar technical validation call" --file transcript.txt
```

Expected result:

```json
{
  "subjects_resolved": [
    {
      "entity_type": "account",
      "name": "Northstar Labs",
      "memory_created": 1,
      "signals_created": 3,
      "processing_receipt": {
        "status": "needs_review",
        "next_action": "Review Signals and promote confirmed items to Memory."
      }
    }
  ],
  "memory_created": 1,
  "signals_created": 3,
  "skipped": 0
}
```

If no subjects are resolved, do not manually invent IDs. Ask the user for the customer record, or run `customer_record_resolve` with the names from the transcript.

---

## Step 4 - Review Signals

List the evidence-backed Signals CRMy assembled from the transcript and any prior sources.

**MCP tool call:**

```text
context_signal_group_list {
  "subject_type": "account",
  "subject_id": "<resolved-account-id>",
  "attention_only": true,
  "limit": 20
}
```

**CLI equivalent:**

```bash
crmy context signal-groups --subject "account:Northstar Labs"
```

Look for:

- Readiness score and promotion threshold
- Evidence count and independent source count
- Conflict state
- Whether the Signal is ready for Memory, needs more evidence, or needs approval

---

## Step 5 - Promote safe Signals to Memory

Promote only when the Signal is supported and safe to use operationally.

**MCP tool call:**

```text
context_signal_group_promote {
  "id": "<signal-id>"
}
```

**CLI equivalent:**

```bash
crmy context promote-group <signal-id>
```

After promotion, the claim is Current Memory and will appear in `briefing_get`, context search, Automations, Handoffs, and governed writeback planning.

---

## Step 6 - Send risky Signals to Handoff

Use Handoff when the Signal is sensitive, conflicting, or likely to affect forecast, customer engagement, assignments, or system-of-record writeback.

**MCP tool call:**

```text
context_signal_handoff {
  "id": "<signal-id>"
}
```

**CLI equivalent:**

```bash
crmy context handoff-group <signal-id>
```

CRMy creates a HITL review request with the claim, evidence summary, readiness score, subject record, and requested decision.

---

## Step 7 - Coordinate follow-up

Create assignments only from confirmed Memory or reviewed/Handoff-approved context.

**MCP tool call:**

```text
assignment_create {
  "subject_type": "opportunity",
  "subject_id": "<resolved-opportunity-id>",
  "title": "Schedule Northstar follow-up workshop",
  "priority": "high",
  "context": "Northstar wants a workshop covering audit logs, HITL review, and Salesforce writeback controls. Security still needs data residency answers before pilot approval.",
  "instructions": "Schedule the workshop, include the SE, and prepare a short data residency answer before the meeting."
}
```

Use `hitl_submit_request` before any external commitment, forecast change, executive outreach, or CRM writeback proposal.

---

## Step 8 - Verify the enriched state

Pull another briefing:

```text
briefing_get {
  "subject_type": "opportunity",
  "subject_id": "<resolved-opportunity-id>",
  "context_radius": "account_wide",
  "format": "json"
}
```

The final briefing should show:

- New confirmed Memory from promoted Signals
- Unconfirmed Signals kept separate
- Open Handoffs for review-gated claims
- Follow-up assignments
- Memory Health warnings if any claims have expiration or contradiction risk

---

## Why this matters

The post-meeting agent does not need to rebuild customer state from notes, CRM history, and prior prompts. CRMy gives it a repeatable operating path:

1. Ingest messy GTM context.
2. Extract evidence-backed Signals.
3. Promote confirmed Signals into Memory.
4. Route risky action through Handoffs.
5. Act or write back only after policy allows it.
