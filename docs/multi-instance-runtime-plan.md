# CRMy 1.0 Multi-Instance Runtime Plan

Status: **planned for 1.0 hosted production**.

This plan covers the gap behind the release-review finding: MCP sessions and
background workers are still partly process-local architecture concerns. The
goal is not to remove all in-memory objects. Live sockets, active abort
controllers, and SDK transport instances are naturally process-local. The 1.0
requirement is that durable ownership, retry decisions, permissions, recovery,
and user-visible work state survive multi-instance routing, deploys, worker
crashes, and serverless freezes.

## Scope

Applies to:

- Hosted multi-tenant production.
- Enterprise self-hosted deployments with more than one app instance.
- Worker deployments with more than one worker replica.
- External MCP clients using Streamable HTTP sessions.
- Workspace Agent turns, Raw Context processing, embeddings, sync, outbox,
  workflows, sequences, HITL, and writeback work.

Does not block:

- Local development.
- `crmy init --demo` first-run paths.
- Single-instance self-hosted deployments when documented as single-instance.
- Controlled beta deployments with explicit sticky routing and one worker
  replica.

## Current Code Signals

Current implementation details that make this a 1.0 concern:

- `packages/server/src/mcp/session-registry.ts` stores MCP sessions in an
  in-memory `Map<string, McpSession>`.
- `packages/server/src/mcp/session-registry.ts` sends MCP resource change
  notifications through the in-process event bus.
- `packages/server/src/index.ts` reuses MCP sessions only when the request lands
  on the process that owns the `StreamableHTTPServerTransport`.
- `packages/server/src/index.ts` starts the background worker loop inside the app
  process.
- `packages/server/src/index.ts` serializes many unrelated background tasks
  behind one global advisory lock and one 60-second tick.
- `packages/server/src/agent/turn-runner.ts` keeps active turn abort controllers
  in memory, but the durable turn state is already persisted.
- `packages/server/src/db/repos/agent.ts` already has the right foundation for
  agent turns: claim, heartbeat, lease expiry, attempt count, and
  `FOR UPDATE SKIP LOCKED` batch claiming.
- `packages/server/src/db/repos/context-outbox.ts` uses `FOR UPDATE SKIP LOCKED`
  but still needs stale-lock recovery, retry scheduling, and dead-letter state
  parity with newer durable queues.

## Release Posture

| Deployment shape | Acceptable before 1.0? | Requirement |
| --- | --- | --- |
| Local dev / demo | Yes | Current in-process sessions and workers are acceptable. |
| Single-instance self-hosted | Yes, if disclosed | One app process may run the worker loop; MCP sessions are process-local. |
| Hosted beta | Yes, with constraints | Require sticky MCP routing and a single worker leader or explicitly separated worker process. |
| Hosted multi-instance production | No | Requires the 1.0 architecture in this document. |

## Design Principles

- Persist **identity, ownership, permissions, leases, status, retries, and event
  cursors**. Do not attempt to persist live sockets or SDK transport objects.
- Make every mutating or long-running action recoverable by durable receipt,
  idempotency key, or queue row.
- Treat streamed responses as a delivery optimization. Durable state must be
  readable through polling after a dropped stream.
- Prefer small, named processors over one global maintenance loop.
- Use database-enforced tenant and actor scope before work is claimed or
  returned to a client.
- Keep the local setup path simple. Multi-instance controls should be production
  configuration, not mandatory local ceremony.

## Target Production Topology

1. **Web/API instances**
   - Serve REST, UI, auth, MCP HTTP requests, and Workspace Agent polling/SSE.
   - Do not run migrations by default in production.
   - Do not own broad background processing loops.
   - May hold live MCP transports and active SSE streams.

2. **Worker instances**
   - Run named processors for durable queues.
   - Claim work with leases and `FOR UPDATE SKIP LOCKED`.
   - Emit heartbeats and queue metrics.
   - Can be scaled independently per processor family.

3. **Migration job**
   - Runs explicitly before app rollout.
   - Uses a direct database connection path where required by the provider.
   - Uses an advisory lock or migration table lock to prevent concurrent
     migrations.

4. **Shared coordination layer**
   - PostgreSQL is the required baseline for durable state.
   - Optional Redis or provider-native pub/sub can be used for lower-latency
     cross-instance notifications.
   - Postgres `LISTEN/NOTIFY` is acceptable for best-effort notifications, but
     durable recovery must come from tables, not from notification delivery.

## MCP Session Architecture

### Current Risk

MCP Streamable HTTP sessions reuse an in-memory `McpServer` and transport. If a
client initializes on instance A and a later `GET`, `POST`, or `DELETE /mcp`
lands on instance B, instance B does not have the session. Deploys, instance
restarts, serverless freezes, or load-balancer changes can drop resource
subscriptions and produce confusing session failures.

### 1.0 Target

Create a durable MCP session catalog. Live transports remain process-local, but
session validity and recovery decisions become shared.

Recommended table shape:

```sql
CREATE TABLE mcp_sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  actor_type TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  auth_subject_hash TEXT NOT NULL,
  owning_instance_id TEXT,
  transport_state TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX mcp_sessions_tenant_active_idx
  ON mcp_sessions (tenant_id, expires_at DESC)
  WHERE closed_at IS NULL;
```

Optional subscription/event cursor table:

```sql
CREATE TABLE mcp_session_subscriptions (
  session_id UUID NOT NULL REFERENCES mcp_sessions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  resource_uri TEXT NOT NULL,
  last_event_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, resource_uri)
);
```

### Request Flow

1. **Initialize**
   - Authenticate the request.
   - Compute a stable actor/scope hash.
   - Create the SDK server and Streamable HTTP transport in the current process.
   - Insert `mcp_sessions` with `owning_instance_id`, actor identity, scope hash,
     and TTL.
   - Return the MCP `mcp-session-id`.

2. **Subsequent request**
   - Authenticate every request.
   - Load the session row.
   - Reject if expired, closed, wrong tenant, wrong actor, or wrong scope hash.
   - If the request lands on the owning instance, use the live transport.
   - If the request lands on another instance, one of these must be true:
     - load balancer routes by `mcp-session-id` to the owning instance;
     - the app forwards the request through an internal instance RPC;
     - the session is marked expired and the client receives a clear
       reinitialize response.

3. **Resource notifications**
   - Persist CRMy domain events as the source of truth.
   - Publish best-effort cross-instance notification messages by tenant and
     resource type.
   - The owning instance pushes `resources/listChanged` to live sessions.
   - Clients must be able to recover by listing resources again after reconnect.

4. **Close and expiry**
   - `DELETE /mcp` closes the local transport and marks the durable session
     closed.
   - Idle expiry closes the local transport if present and marks the session
     expired.
   - An instance heartbeat or startup sweep marks sessions owned by dead
     instances expired.

### MCP Acceptance Gates

- Two app instances can serve MCP clients with sticky routing by
  `mcp-session-id`.
- A session request with a mismatched actor or scope hash is rejected without
  leaking resource names or IDs.
- Killing the owning app instance causes a clear session-expired response, not a
  silent hang or cross-actor reuse.
- Resource updates generated on one app or worker instance notify MCP sessions
  connected to another app instance, or clients recover by refetching resources.
- Tool calls that create or update CRMy records remain scoped and idempotent
  after client reconnect/reinitialize.

## Background Worker Architecture

### Current Risk

The app runtime currently starts a 60-second loop that runs many unrelated tasks
behind one advisory lock. That protects against duplicate work in simple
deployments, but it creates production problems:

- One slow processor can delay unrelated work.
- Scaling app instances does not scale background throughput.
- App deploys can interrupt work that should be owned by workers.
- Some queues have stronger lease/retry semantics than others.
- Queue health is hard to reason about per workload.

### 1.0 Target

Move from one in-process maintenance loop to named durable processors.

Required processors:

| Processor | Work owned |
| --- | --- |
| `agent_turns` | Workspace Agent turn execution and recovery |
| `raw_context` | Raw Context extraction, repair, and reprocess jobs |
| `context_outbox` | Search indexing / context propagation outbox |
| `embeddings` | Embedding backfill, repair, stale embedding refresh |
| `mailbox_sync` | Email sync pages, provider retries, skipped-source stats |
| `calendar_sync` | Calendar sync pages, provider retries, association review |
| `webhook_retries` | Retryable outbound webhook deliveries |
| `workflow_backlog` | Persisted workflow event catch-up and replay |
| `sequence_due` | Due sequence steps, sends, and wait/branch transitions |
| `hitl_sla` | HITL expiry, SLA reminders, auto-approval policy checks |
| `writeback_execution` | External writeback execution and retry |
| `maintenance` | Low-priority cleanup, retention, rollups, analytics |

Each processor needs:

- independent enable/disable configuration;
- batch size and concurrency limit;
- statement timeout and overall job timeout;
- per-tenant fairness or quota controls;
- retry/backoff policy;
- dead-letter state;
- stale lease recovery;
- worker heartbeat;
- queue metrics;
- safe operator actions.

### Queue Contract

Every durable queue, whether shared or table-specific, should expose equivalent
columns or derived fields:

```sql
status              -- pending | running | succeeded | failed | retrying | dead_lettered | cancelled
attempt_count
max_attempts
locked_by
locked_at
lease_expires_at
heartbeat_at
next_retry_at
last_error
last_error_code
idempotency_key
tenant_id
actor_id
created_at
updated_at
completed_at
metadata
```

Processor claim pattern:

```sql
WITH claim AS (
  SELECT id
  FROM queue_table
  WHERE tenant_id = $1
    AND (
      status = 'pending'
      OR (status = 'retrying' AND next_retry_at <= now())
      OR (status = 'running' AND lease_expires_at < now())
    )
  ORDER BY priority DESC, created_at ASC, id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
UPDATE queue_table q
SET status = 'running',
    locked_by = $3,
    locked_at = now(),
    lease_expires_at = now() + ($4::int || ' milliseconds')::interval,
    heartbeat_at = now(),
    attempt_count = attempt_count + 1,
    updated_at = now()
FROM claim
WHERE q.id = claim.id
RETURNING q.*;
```

### Worker Runtime Behavior

- Workers claim small batches and heartbeat long jobs.
- Workers stop claiming new work during shutdown.
- If a worker loses its lease, it must stop committing side effects for that job.
- Side-effecting processors must use idempotency keys tied to tenant, actor,
  subject, operation, destination, and field set where applicable.
- Partial external side effects must write receipts before marking work
  complete.
- Retryable provider failures move to `retrying` with backoff.
- Permanent validation or permission failures move to `failed` or
  `dead_lettered` with an operator-readable reason.
- Every recovery action writes an audit event or operational recovery log row.

### Worker Acceptance Gates

- Two worker replicas can process the same queue without duplicate claims.
- Killing a worker mid-agent-turn, mid-extraction, mid-outbox batch, and
  mid-sync page eventually recovers or dead-letters the work.
- One failing processor does not block unrelated processors.
- Queue metrics identify oldest pending age, oldest running age, retry rate,
  dead-letter count, and last successful processor heartbeat.
- Operator recovery can retry, park, dead-letter, or inspect failed work without
  direct database edits.
- App instances can run with background processing disabled.

## Deployment Modes

| Mode | App instances | Worker instances | MCP sessions | Background work |
| --- | ---: | ---: | --- | --- |
| Local dev | 1 | 0 or in-app | In memory | In app |
| Single-instance self-hosted | 1 | 0 or 1 | In memory, documented | In app or worker |
| Hosted beta | 2+ | 1+ | Sticky by `mcp-session-id` | Dedicated worker preferred |
| 1.0 hosted production | 2+ | 2+ | Durable catalog + sticky/forward/expire behavior | Dedicated named processors |

Production configuration should include:

- `CRMY_RUN_WORKERS=false` for web/API processes.
- `CRMY_WORKER_QUEUES=agent_turns,raw_context,...` for worker processes.
- `CRMY_INSTANCE_ID` for app and worker identity.
- `CRMY_MCP_SESSION_MODE=sticky` or `durable`.
- `CRMY_MCP_SESSION_TTL_SECONDS`.
- Queue-specific batch, timeout, and concurrency settings.

Exact environment variable names can change during implementation, but the
production distinction between web runtime, worker runtime, and migration job
should not.

## Observability And Operations

1.0 should expose:

- MCP active sessions by tenant and instance.
- MCP expired sessions, rejected actor/scope mismatches, and reconnects.
- Resource notification publish/delivery counts.
- Per-processor queue depth, oldest pending age, oldest locked age, retry rate,
  failure rate, dead-letter count, and last heartbeat.
- Worker claim latency and job duration.
- Worker shutdown and lease-loss events.
- Duplicate idempotency-key suppression counts.
- Operator recovery actions and outcomes.

Required runbooks:

- MCP session routing failure.
- Worker stuck or no heartbeat.
- Queue backlog growth.
- Provider outage/backoff.
- Dead-letter triage.
- Failed deployment with active agent turns.
- Database connection exhaustion.

## Test Plan

Add release-gate tests for:

- MCP initialization on instance A and subsequent request routing by
  `mcp-session-id`.
- MCP actor/scope mismatch rejection against a durable session row.
- MCP owner instance killed during active session; client receives clear
  expiration/reinitialize behavior.
- Resource update on instance A notifies or is recoverable by a client connected
  to instance B.
- Two workers claim from the same queue without duplicate work.
- Worker crash after claim before completion returns work to retry after lease
  expiry.
- Worker crash after external side effect but before completion does not
  duplicate the side effect on retry when an idempotency key is available.
- App process starts with workers disabled and still serves REST/UI/MCP.
- Migration job runs separately from app startup.
- Queue metrics and recovery actions report the expected state for pending,
  running, retrying, failed, and dead-lettered jobs.

## Fastest Implementation Path

1. Add a production flag to disable in-app workers and document split app/worker
   startup.
2. Extract the current 60-second loop into named processors while preserving
   existing behavior for local dev.
3. Standardize queue columns and stale recovery for context outbox and remaining
   durable queues.
4. Add per-processor metrics and operator recovery views/tools.
5. Add `mcp_sessions` durable catalog, actor/scope validation, TTL, and explicit
   stale-session errors.
6. Add sticky routing guidance and tests for hosted beta.
7. Add cross-instance resource notification delivery or recovery behavior.
8. Add multi-instance release tests with two app instances and two worker
   instances.

## 1.0 Definition Of Done

CRMy is 1.0-ready for hosted multi-instance production when:

- app instances can be scaled horizontally without running duplicate worker
  loops;
- workers can be scaled horizontally without duplicate durable side effects;
- MCP session identity, ownership, actor/scope validation, and expiry are
  durable;
- MCP live stream loss is recoverable without losing customer work;
- Workspace Agent, Raw Context, embeddings, source sync, workflows, sequences,
  HITL, and writebacks have explicit queue ownership, retries, and recovery;
- production docs describe the required app, worker, migration, and session
  routing topology;
- release tests prove crash, deploy, reconnect, and retry behavior.
