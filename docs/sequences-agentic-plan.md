# Agentic Sequences — Implementation Plan

**Status:** In progress  
**Created:** 2026-04-20  
**Replaces:** Email Sequences (email-only drip campaigns)

---

## Vision

Evolve "Email Sequences" into a general-purpose, AI-powered **Sequences** system that acts as a coordination primitive for agents and humans alike. Sequences should be multi-channel, AI-personalized, dynamically branching, and fully controllable by both the web UI and MCP-connected agents.

---

## Competitive Context

| Tool | Approach |
|---|---|
| Apollo / Outreach / Instantly | Time-based email scheduler with merge fields. Static templates, same content to every contact. |
| Clay | Enrichment as a step — LLM writes the email against a rich data profile at send time. |
| Attio | Automations as first-class CRM objects — steps can change attributes, create tasks, or send messages interchangeably. |
| **CRMy target** | Sequences as an agent coordination primitive: multi-channel, AI-generated at execution time, HITL-gated, reply-aware, goal-driven. |

---

## Current State Audit (as of 2026-04-20)

### Critical Bugs

- **Execution pump is never called.** `getDueEnrollments()` and `advanceEnrollment()` exist in the repo but nothing in `index.ts` calls them. Sequences are currently completely non-functional — steps are never sent.

### Schema Gaps

- `steps` JSONB has no `type` discriminator — email-only with hardcoded `delay_days/subject/body_text`
- `UNIQUE(sequence_id, contact_id)` on enrollments prevents re-enrollment after completion
- No per-step execution log — no record of what was sent, when, with what content
- No analytics columns anywhere

### Feature Gaps

| Gap | Detail |
|---|---|
| Email-only steps | No tasks, notifications, webhooks, wait-until, AI action, or branch steps |
| No branching | No reply-detection exit, no conditional jumps, no goal-event detection |
| No AI personalization | `variables.ts` interpolation engine exists in workflows but not wired to sequences |
| No HITL integration | Sequences bypass the approval flow |
| No analytics | No open/reply/completion rates at any level |
| Missing MCP tools | No pause, resume, advance, draft-step, enrollment-get, or analytics tools |

---

## Step Type Schema (Discriminated Union)

All new steps have a `type` discriminator. Steps without `type` default to `email` for backward compatibility.

```typescript
type SequenceStep =
  | { type: 'email';
      delay_days: number; delay_hours?: number;
      subject: string; body_text?: string; body_html?: string;
      require_approval?: boolean;
      ai_generate?: boolean; ai_prompt?: string; }

  | { type: 'notification';
      delay_days: number;
      channel_id?: string; message: string; }

  | { type: 'task';
      delay_days: number;
      title: string; description?: string;
      assign_to?: string;           // actor_id or 'contact_owner'
      priority?: 'low' | 'normal' | 'high'; }

  | { type: 'ai_action';
      delay_days: number;
      prompt: string;
      tool_names?: string[];
      require_approval?: boolean; }

  | { type: 'webhook';
      delay_days: number;
      url: string; method?: 'POST' | 'GET';
      headers?: Record<string, string>; body_template?: string; }

  | { type: 'wait';
      delay_days: number;
      condition?: {
        event: string;              // e.g. 'email.opened'
        timeout_days: number;
        timeout_branch?: number;    // step index to jump to on timeout
      }; }

  | { type: 'branch';
      conditions: Array<{
        trigger: 'replied' | 'opened' | 'clicked' | 'goal_met' | 'custom_event';
        event?: string;
        jump_to_step?: number;
        exit?: boolean;
      }>; }
```

---

## Database Changes

### Migration 037: `sequence_step_executions`

```sql
CREATE TABLE sequence_step_executions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL,
  step_index    INT NOT NULL,
  step_type     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|sent|failed|skipped|approval_pending
  executed_at   TIMESTAMPTZ,
  email_id      UUID REFERENCES emails(id),
  error         TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX seq_step_exec_enrollment_idx ON sequence_step_executions(enrollment_id);
CREATE INDEX seq_step_exec_tenant_idx    ON sequence_step_executions(tenant_id, created_at DESC);
```

### Migration 038: `sequences_v2` (schema evolution)

```sql
-- Rename table (keep email_sequences as compat view)
ALTER TABLE email_sequences RENAME TO sequences;
CREATE VIEW email_sequences AS SELECT * FROM sequences WHERE 'email' = ANY(channel_types);

-- New columns on sequences
ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS channel_types  TEXT[]  NOT NULL DEFAULT ARRAY['email'],
  ADD COLUMN IF NOT EXISTS goal_event     TEXT,
  ADD COLUMN IF NOT EXISTS goal_object_type TEXT,
  ADD COLUMN IF NOT EXISTS exit_on_reply  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_persona     TEXT,
  ADD COLUMN IF NOT EXISTS tags           TEXT[]  NOT NULL DEFAULT '{}';

-- New columns on enrollments
ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS variables    JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS paused_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS goal_met_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exit_reason  TEXT;  -- replied|goal_met|manual|completed

-- Allow re-enrollment: drop hard unique, replace with partial index
ALTER TABLE sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_sequence_id_contact_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS sequence_enrollments_active_unique
  ON sequence_enrollments(sequence_id, contact_id)
  WHERE status IN ('active', 'paused');

-- Analytics rollup
CREATE TABLE IF NOT EXISTS sequence_analytics_rollup (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL,
  period_start    DATE NOT NULL,
  period_type     TEXT NOT NULL DEFAULT 'day',
  enrolled_count  INT NOT NULL DEFAULT 0,
  completed_count INT NOT NULL DEFAULT 0,
  exited_count    INT NOT NULL DEFAULT 0,
  emails_sent     INT NOT NULL DEFAULT 0,
  emails_opened   INT NOT NULL DEFAULT 0,
  emails_clicked  INT NOT NULL DEFAULT 0,
  replies_count   INT NOT NULL DEFAULT 0,
  tasks_created   INT NOT NULL DEFAULT 0,
  UNIQUE(sequence_id, period_start, period_type)
);
```

---

## Implementation Phases

### Phase 1 — Wire the Execution Engine ✅ Target: sequences actually send

**Files:**
- `packages/server/migrations/037_sequence_step_executions.sql` — NEW
- `packages/server/src/services/sequence-executor.ts` — NEW
- `packages/server/src/index.ts` — add `processSequenceDue(db)` to 60s loop

**Logic in `sequence-executor.ts`:**
1. `processSequenceDue(db)` — fetches due enrollments (limit 50), dispatches each to `executeStep()`
2. `executeStep()` — switch on `step.type ?? 'email'`:
   - `email`: create email record → `deliverEmail()` → log execution
   - `notification`: call message send service
   - `task`: create assignment record
   - `webhook`: fetch() with timeout
   - `wait`: if condition not yet met, reschedule (bump `next_send_at`)
   - `ai_action`: call Anthropic with contact context
   - `branch`: evaluate conditions → `setCurrentStep()`
3. Calls `advanceEnrollment()` after each successful step; marks completed when `current_step >= steps.length`
4. On error: logs to `sequence_step_executions`, increments retry count, exponential backoff on `next_send_at`

---

### Phase 2 — Multi-Channel Schema ✅ Target: typed steps, new DB columns

**Files:**
- `packages/server/migrations/038_sequences_v2.sql` — NEW
- `packages/server/src/db/repos/email-sequences.ts` — extend for new columns, add `logStepExecution()`, `pauseEnrollment()`, `resumeEnrollment()`, `getEnrollmentWithStepLog()`
- `packages/shared/src/schemas.ts` — discriminated union step type schema

---

### Phase 3 — Branching & Reply Detection ✅ Target: sequences exit on reply

**Files:**
- `packages/server/src/services/sequence-executor.ts` — add `handleSequenceReply()` and `handleGoalEvent()`
- `packages/server/src/index.ts` — register `eventBus.on` handlers for `email.received` and goal events
- `packages/server/src/rest/router.ts` — update inbound email handler to check for reply match

**Logic:**
- Inbound email: match `In-Reply-To` header against `sequence_step_executions.metadata.provider_msg_id`
- If matched and `exit_on_reply = true`: unenroll with `exit_reason = 'replied'`
- Else: find `branch` step with `trigger: 'replied'` → jump there
- Goal event: `eventBus.on` checks active enrollments for matching `goal_event`; marks `goal_met_at`

---

### Phase 4 — AI Personalization + HITL ✅ Target: LLM-drafted steps with approval gate

**Files:**
- `packages/server/src/workflows/variables.ts` — add `buildSequenceVariableContext()`
- `packages/server/src/services/sequence-executor.ts` — integrate LLM call for `ai_generate: true` email steps and `ai_action` steps
- Uses existing Anthropic provider at `packages/server/src/agent/providers/anthropic.ts`
- HITL: if `require_approval: true`, create `hitl_request` → pause enrollment → resume on approval via event bus

---

### Phase 5 — Agent-Native MCP Tools ✅ Target: agents fully control sequences

**New tools (added to `email-sequences.ts` tools file):**

| Tool | Description |
|---|---|
| `sequence_pause` | Pause active enrollment |
| `sequence_resume` | Resume paused enrollment |
| `sequence_advance` | Skip to next/specific step immediately |
| `sequence_enrollment_get` | Full state including step execution log |
| `sequence_draft_step` | Agent generates content for a pending step |
| `sequence_analytics` | Step-level metrics for a sequence |

Old `email_sequence_*` names kept as aliases.

**`sequence_draft_step`** is the key agentic primitive — an agent previews and iterates on outreach content before it fires, making HITL approval meaningful rather than rubber-stamping.

---

### Phase 6 — Analytics ✅ Target: open/reply/completion metrics

**Files:**
- `packages/server/src/services/sequence-analytics.ts` — NEW: `refreshSequenceAnalytics(db)` rollup function + `getSequenceAnalytics(db, tenantId, sequenceId)` live query
- `packages/server/src/index.ts` — add `refreshSequenceAnalytics(db)` to 60s loop
- Email opened/clicked events wired to update step execution records + rollup

---

### Phase 7 — UI Overhaul ✅ Target: full multi-channel sequence builder

**Files:**
- `packages/web/src/pages/EmailSequences.tsx` → `packages/web/src/pages/Sequences.tsx`
- `packages/web/src/api/hooks.ts` — add `useSequencePause`, `useSequenceResume`, `useSequenceAdvance`, `useSequenceAnalytics`

**UI changes:**
- Page rename: "Email Sequences" → "Sequences"; update sidebar
- `TypedStepBuilder`: type selector per step; fields change per type; AI-generate toggle + prompt
- New **Settings tab**: goal event, exit-on-reply toggle, AI persona, tags
- New **Analytics tab**: enrollment funnel, open/click/reply rates per step
- **Enrollment table**: step type icon, "sends in 2d" relative time, manual advance button, exit reason

---

### Phase 8 — Backward Compatibility ✅ Target: nothing breaks for existing agents/users

- `email_sequences` REST routes kept; add `/sequences` aliases
- `email_sequence_*` MCP tool names kept as thin wrappers
- Steps without `type` field default to `email` in executor
- Old `UNIQUE` constraint replaced by partial index (no data loss)

---

## Key Design Decisions

### Re-enrollment
Partial unique index on `(sequence_id, contact_id) WHERE status IN ('active', 'paused')` allows re-enrollment after completion. Enables quarterly nurture cycles.

### JSONB steps vs. normalized step table
Keep steps as JSONB — avoids join complexity, zero-migration for new step types. GIN index if needed later.

### Inline executor vs. dedicated worker
Single `setInterval` is fine for current scale (50 enrollments/tick). Extract to worker process later if throughput demands it.

### AI step generation: sync
LLM call happens inside the execution tick. Acceptable given 60s interval. If `require_approval: true`, enrollment pauses immediately — no blocking.

---

## File Change Summary

| File | Change |
|---|---|
| `migrations/037_sequence_step_executions.sql` | NEW |
| `migrations/038_sequences_v2.sql` | NEW |
| `src/services/sequence-executor.ts` | NEW |
| `src/services/sequence-analytics.ts` | NEW |
| `src/db/repos/email-sequences.ts` | Extended |
| `src/mcp/tools/email-sequences.ts` | 6 new tools + aliases |
| `src/index.ts` | Pump + event listeners |
| `src/rest/router.ts` | New routes + inbound reply hook |
| `src/workflows/variables.ts` | `buildSequenceVariableContext()` |
| `packages/shared/src/schemas.ts` | Step discriminated union |
| `packages/shared/src/types.ts` | New sequence types |
| `web/src/pages/Sequences.tsx` | Renamed + overhauled |
| `web/src/api/hooks.ts` | New sequence hooks |
| `web/src/App.tsx` | Updated import |
| `web/src/components/layout/Sidebar.tsx` | Rename label/icon |
