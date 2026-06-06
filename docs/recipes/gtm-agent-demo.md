# Run the GTM agent demo

This recipe is the fastest way to see CRMy's purpose: a GTM agent can inspect account state, ingest messy customer context, see Signals emerge, promote confirmed Memory, route risky work to Handoff, and prepare governed system-of-record action.

**Use this when:** you are evaluating CRMy for the first time or building your first agent on top of it.

**Prerequisites:**

- CRMy initialized locally
- Demo data seeded with `crmy seed-demo`
- Web UI open at `/app`
- Optional: MCP connected to your agent runtime

---

## Complete system prompt

```text
You are a GTM Agent using CRMy.

Your job is to help a sales or customer-success team act on customer context safely.

Use CRMy's lifecycle:
Raw Context -> Signals -> Memory -> Active Context -> Handoffs -> Systems of Record.

Rules:
- Start with briefing_get before recommending action so confirmed Memory is loaded into Active Context.
- Use context_ingest_auto for messy transcripts, emails, notes, or research.
- Treat Signals as unconfirmed until promoted to Memory or approved by Handoff.
- Use confirmed Memory for recommendations, assignments, and writeback planning.
- Use Handoffs for sensitive, uncertain, or high-impact decisions.
- Never write to a system of record without governed writeback preview, policy, and approval when required.
```

---

## Step 1 - Seed the demo workspace

```bash
crmy seed-demo --reset
```

You should see counts for accounts, contacts, opportunities, Raw Context sources, Signals, Memory, and Handoffs.

---

## Step 2 - Inspect the opportunity

```bash
crmy briefing opportunity:d0000000-0000-4000-d000-000000000101 --format text
```

In the web UI, open:

```text
/app/opportunities
```

Look for the Northstar Labs opportunity and inspect the detail drawer. The important question is: what does the agent know, and what does it still need to verify?

---

## Step 3 - Inspect Raw Context processing

```bash
crmy context raw-sources
```

In the web UI:

```text
/app/context?tab=observations
```

Raw Context shows the source material CRMy received before it became Signals or Memory.

---

## Step 4 - Review Signals

```bash
crmy context signal-groups --subject account:d0000000-0000-4000-b000-000000000101
```

In the web UI:

```text
/app/context?tab=signals
```

Signals show inferred GTM claims with readiness score, evidence count, source count, and blockers. CRMy combines related evidence across sources so users do not have to review every extracted line manually.

---

## Step 5 - Promote or hand off

Promote a safe Signal:

```bash
crmy context promote-group <signal-id>
```

Route a risky Signal to human review:

```bash
crmy context handoff-group <signal-id>
crmy hitl list
```

The product intent is exception-based review: high-confidence, low-risk context should become Memory automatically or with one click; risky context should land in Handoffs.

---

## Step 6 - Ask for a new briefing

```bash
crmy briefing account:d0000000-0000-4000-b000-000000000101 --format text
```

Confirmed Memory should now be available to agents. Unpromoted Signals remain separate and should be referenced as uncertain.

---

## Step 7 - Prepare governed action

From here, an agent can:

- create an assignment for the owner
- draft a follow-up email
- request a governed writeback to a connected CRM or warehouse
- create a Handoff before forecast, executive outreach, or external-system updates

CRMy's value is not just remembering context. It tells agents what is true enough to act on, what needs review, and what can safely move back to a system of record.
