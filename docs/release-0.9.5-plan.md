# CRMy 0.9.5 Development Plan — "Automatic by Default"

## Status

WS1 checkpoint implemented; WS2, WS3, and WS4 implemented in stacked checkpoints;
WS5-WS7 not started. This is the next milestone after 0.9.4 and the largest single step
toward a 1.0 production release. It is the
authoritative development plan for 0.9.5; the
[0.8–1.0 roadmap](roadmap-0.8-1.0.md) tracks the broader sequence and the
[Strategic Refocus](roadmap-0.8-1.0.md#strategic-refocus-the-governed-action--provenance-control-plane)
holds the durable decisions (D1–D8) this plan executes.

## One-line theme

**From raw source to safe agent action with zero required clicks** — make the
trust machinery that landed in 0.9.4 run *invisibly and automatically*, so a new
user gets an "ah-ha" within minutes and agents perform better with less human
hand-holding.

## Why this release, why now

0.9.4 delivered **trust integrity**: grounded promotion, claim-class tiers
(`memory-trust.ts`), per-type Memory freshness/decay, `grounding_method`, and a
model-certification gate for auto-promotion. That work was correct and necessary.

But it optimized for *safety*, and in doing so it made the product *less
automatic*:

- **Auto-promotion is now blocked by default and there is no way to unblock it in
  production.** `model_certification_status` defaults to `uncertified`; the gate
  defaults on (`CRMY_REQUIRE_MODEL_CERTIFIED_AUTOPROMOTE`); the only code path
  that sets `certified` is the agent API route, which 0.9.4 disabled in
  production (`allowManualCertification = false`). The eval runner only ever
  writes `uncertified` ([runner.ts:1588](../packages/server/src/evals/runner.ts)).
  Net: a fresh install ingests a transcript, produces Signals, and **promotes
  nothing** — every claim lands in a manual review queue.
- The review surfaces (`stale_context_review`, `signal_review`,
  `knowledge_claim_review`, `contradiction_review`) have **no prioritization,
  de-duplication, or auto-resolution**, so the queue only grows.
- Much of the loop still implies **human clicks in the web UI**.

The mission — *the best governed context and action solution for customer-facing
agents: simple to use, seemingly automatic, but incredibly powerful* — requires
closing this gap. 0.9.5 makes the safe path the automatic path.

## Design principles for 0.9.5

1. **Safe by default, automatic by default.** The recommended setup auto-promotes
   trustworthy Memory without a human step. Safety degrades to review only when
   the model or evidence is genuinely insufficient.
2. **Reduce required UI interaction to zero on the golden path.** Anything a human
   can do in the web app to advance the loop, an agent/automation can do through
   MCP/CLI/REST. The UI becomes optional oversight, not a required step.
3. **The queue should shrink itself.** Reviews are prioritized, de-duplicated, and
   auto-resolved when new grounded evidence answers them.
4. **Good defaults, tunable power.** Tiers, freshness windows, and promotion
   policy ship with strong defaults and are tenant-configurable for advanced use.
5. **Prove it with evals, not vibes.** Every new automatic path has an eval gate;
   high-risk false-allow stays at 0.

## Gaps this release closes

| Gap | Description | Workstream |
|---|---|---|
| **1** | "Automatic" blocked by the certification dead-end | WS1 |
| **2** | Review-queue sprawl (no triage / auto-resolve) | WS2 |
| **3** | Concept overload; too much required UI | WS3, WS5 |
| **4** | Portable Action Context contract not versioned/frozen | WS6 |
| **5** | Cross-CRM neutrality unproven | WS7 (scoped) |
| Calibration | Tier-2 auto-promote policy + hardcoded freshness windows | WS1, WS4 |

---

## Workstreams

### WS1 — Automatic, safe promotion out of the gate (Gap 1 + Tier-2 calibration)

The keystone. Until promotion auto-runs safely, nothing else feels automatic.

**Status:** Implemented in the WS1 checkpoint. `crmy certify` now runs the real
`live_model` eval profile and only writes `certified` through passing eval
evidence; CRMy pre-certified recommended models restore recorded provenance on
exact provider/base URL/model matches; arbitrary models remain review-only with a
`crmy certify` prompt. Tier-2 auto-promotion is governed by
`tier2_autopromote_policy` / `CRMY_TIER2_AUTOPROMOTE_POLICY` and the final group
promotion gate requires corroborated policy, at least two recent independent
sources, grounding, readiness, and confidence. Manual self-certification remains
closed.

**Deviation:** model-change handling implements the accepted "clear prompt" path
and exact-match pre-certified restoration, not background re-certification.

**Problem (verified):** no automated certification path exists; production cannot
certify a model; auto-promote is therefore permanently off in production.

**Deliverables:**

1. **Eval-driven certification (`crmy certify`).** Add a command + service that
   runs the `live_model` certification suite via the existing eval runner and, on
   passing the gate (score ≥ `MODEL_CERTIFICATION_MIN_SCORE`, profile
   `live_model`), writes `model_certification_status='certified'`,
   `model_certification_profile`, `model_certification_run_id`,
   `model_certification_score`, and `model_certified_at` to `agent_configs`.
   This is the missing automated path; it does not reopen manual self-certification.
2. **Pre-certified recommended models.** Ship a built-in registry of known-good
   models that satisfy the gate, so the recommended setup path has auto-promote
   **on and safe with zero eval step**. Unknown/local models prompt
   "run `crmy certify` to enable automatic Memory" and degrade gracefully to
   review-only (already the behavior; make the prompt first-class).
3. **Auto re-certify on model change.** `routes.ts` already resets to
   `uncertified` when the model identity changes; trigger a background re-cert
   (or clear prompt) so a model swap does not silently disable automation.
4. **Tier-2 calibration (calibration flag #1).** Replace the hardcoded
   `allowGroupCorroboration: true` at
   [extraction.ts:1438](../packages/server/src/agent/extraction.ts) with a
   governed setting `tier2_autopromote_policy`:
   - `corroborated` (default): Tier-2 auto-promotes only with ≥2 **independent**
     sources **and** recency **and** grounding **and** confidence ≥ threshold;
   - `human_only`: Tier-2 never auto-promotes (routes to one framed review).
   Tier-2 = forecast/commitment/deal_risk/risk/approval (see
   `TIER_2_CONTEXT_TYPES` in `memory-trust.ts`).

**Acceptance:** fresh `init --demo` with the recommended model auto-confirms
Tier-0/1 grounded Memory with no manual steps; Tier-2 routes per policy; eval
`action_context` high-risk false-allow rate = 0; `crmy certify` flips a passing
model to `certified` and auto-promotion turns on.

---

### WS2 — Self-maintaining review queue (Gap 2)

Make the queue small, ranked, and mostly self-clearing so "seemingly automatic"
survives contact with real data.

**Status:** Implemented in the WS2 checkpoint. Review assignment creation now
deduplicates/consolidates stale, signal, contradiction, and Trusted Fact review
work through a shared queue helper with per-subject caps. Signal promotion
auto-refreshes existing matching Memory on re-grounding, extends its review
window, retires supporting Signals, and completes linked review assignments with
audit receipts. Explicit `context_review`, batch review, Signal promotion,
supersede, and contradiction resolution also clear obsolete review assignments.
`assignment_review_queue` exposes the ranked "needs you" list over MCP/REST/CLI,
and `assignment_review_resolve` lets scoped agents clear grounded Tier-0/1
reviews while refusing Tier-2, contradiction, conflicted, or ungrounded cases.
Low-value aged review assignments auto-expire during existing review sweeps.

**Deviation:** review ranking uses assignment metadata for account-value scoring
when present; WS2 does not add a new account-value backfill or UI redesign.

**Deliverables:**

1. **Auto-resolve on re-grounding.** When new grounded evidence re-confirms a
   claim under stale/freshness/signal review, auto-clear the assignment and extend
   the review date (reuse `reviewContextEntry(extendDays)`), emitting a receipt
   instead of opening another task.
2. **De-duplicate + consolidate.** One open review per claim/subject; merge stale +
   freshness + signal reviews that target the same entry. Cap open reviews per
   subject.
3. **Prioritize.** Rank the queue by tier (Tier-2 + conflicts first), risk,
   recency, and account value. Expose one ranked "needs you" list, not N sweep
   outputs.
4. **Agent-resolvable low-risk reviews.** Allow scoped agents to resolve Tier-0/1
   reviews via MCP within policy (sufficient grounding + no conflict), so a human
   is not required in the web UI. Tier-2 still requires a human. *(Directly serves
   "reduce the need to do anything via the UI.")*
5. **Auto-expire** low-value reviews that age out without becoming relevant.

**Acceptance:** re-ingesting confirming evidence clears the related review; a
default demo run leaves a small ranked queue, not a pile; agents can clear Tier-0/1
reviews through MCP with audit receipts.

---

### WS3 — Automatic end-to-end ingestion (reduce UI dependence + the ah-ha)

The "drop a transcript → the agent is ready" loop, fully headless.

**Status:** Implemented in the WS3 checkpoint. `context_ingest_auto`, mailbox
sync, delivered outbound email processing, calendar artifact processing, and
context source objects already enter extraction/grouping/safe promotion
automatically. WS3 closes the remaining source-connection gap: creating a
transcript/raw-note source now queues the initial sync, so connect → sync →
source-object processing → meeting artifact extraction runs without a second
manual sync call. The headless audit found MCP/REST/CLI parity for the golden
path actions: ingest/source receipts, transcript source connections, source
object list/get/resolve/reprocess/ignore, Signal/Memory review and promotion,
review assignments, Handoffs, briefing, and Action Context.

**Deviation:** no new headless tool names were required; WS3 strengthened the
default automation on the existing Source Drop service and documented that
`context_source_connection_sync` / `crmy activities transcript-source sync` are
manual refresh/retry paths.

**Deliverables:**

1. **Auto-extract on ingest by default.** Ensure `context_ingest_auto`, source
   connections, transcript/notes drops, and email/calendar sync auto-trigger
   extraction → grouping → safe promotion with no manual "process" step.
2. **Source connections that just work.** Connect a source → it syncs, extracts,
   grounds, and surfaces Memory automatically; status is visible but not a
   required action.
3. **Headless parity audit.** Inventory every loop-advancing action that is
   currently UI-only and add an MCP/CLI/REST equivalent, so an agent or automation
   can run the whole loop without the web app. *(This is the concrete
   "reduce UI dependence" deliverable.)*

**Acceptance:** from a clean workspace, a single ingest or source-drop yields
agent-ready grounded Memory + a briefing with zero UI interaction; the headless
parity audit has no open UI-only gaps on the golden path.

---

### WS4 — Tenant-tunable trust (calibration flag #2 + power without complexity)

**Status:** Implemented in the WS4 checkpoint. Context type registry rows now carry
`default_freshness_days` and `claim_tier`, seeded from the previous built-in
freshness windows and Tier-1/Tier-2 sets. Stale Memory sweeps, review extension,
Signal group readiness, Tier-2 recency, and promotion metadata now use those
tenant settings with the old defaults as fallback. Admins can tune the settings
through REST/MCP/CLI and the web Settings registry, while the agent model settings
surface the governed Tier-2 policy next to the existing promotion threshold.

**Deviation:** no new background worker was added; setting changes are picked up
by the next existing freshness sweep or Signal group recompute.

**Deliverables:**

1. **Configurable freshness windows.** Move the hardcoded regex windows in
   `memory-trust.ts` (`memoryFreshnessWindowDays`) to a
   `default_freshness_days` column on `context_type_registry` (precedent: the
   per-type `priority_weight` / `confidence_half_life_days` columns added in
   migrations 021/029). Seed with the current defaults; tenants can override.
   Update the seed array and `getTypeWeightsMap`-style readers.
2. **Configurable tier mapping.** Make context-type → claim tier configurable in
   the registry (default = built-in `TIER_1`/`TIER_2` sets), so tenants can
   classify custom context types' risk.
3. **Governed promotion settings.** Surface promotion threshold + Tier-2 policy as
   governed settings with safe defaults.

**Acceptance:** a tenant can change a freshness window or a context-type's tier and
the sweep/gate respect it on the next run; defaults are unchanged for everyone else.

---

### WS5 — Core Profile as the default product (Gap 3 + agents perform better)

**Deliverables:**

1. **Core Profile is the install default.** Connector-free, lean default toolset.
   The `CORE_TOOLS` base already leads with `tool_guide`, `customer_record_resolve`,
   `briefing_get`, `action_context_get`; keep that and make the lean `standard`
   toolset the agent default everywhere.
2. **Finish the Sequences/Automations removal.** 0.9.4 only *labeled* them
   experimental. Remove them from default toolsets and first-run entirely; keep
   routes/data behind explicit opt-in.
3. **Progressive disclosure.** First-run shows only the core loop; tiers, grounding
   method, lineage internals, and advanced surfaces are opt-in. Onboarding copy
   explains Signals/Memory in one line each; it does not require understanding
   tiers to get value.

**Acceptance:** a new builder sees the ~5-tool loop, not the full catalog; the
`agent_runtime` eval shows correct safe-front-door first-tool selection; Sequences/
Automations are absent from the default path.

---

### WS6 — Portable, versioned Action Context contract (Gap 4)

**Deliverables:**

1. **Version + freeze the Action Context packet schema** (`operating_mode`,
   `readiness`, `policy`, `source_posture`, `allowed_actions`, `human_unblock`,
   `proof`, `next_tools`, `context_packing`). Add a `contract_version` field and
   document it as the stable agent preflight contract across MCP/REST/CLI/Workspace
   Agent.
2. **Contract eval coverage.** Add `action_context` eval cases asserting contract
   shape, operating-mode accuracy, and zero high-risk false-allow.

**Acceptance:** the contract is versioned, documented, and covered by shape +
safety evals; the same packet is returned identically across surfaces.

---

### WS7 — Neutrality by construction + parity harness (Gap 5, scoped)

Full live two-provider certification is heavy (needs Salesforce + HubSpot
sandboxes) and is **deferred to 0.9.7**. 0.9.5 delivers the testable foundation:

**Deliverables:**

1. **Neutrality by construction.** Assert (and test) that all SoR specifics live
   in adapters and that the core loop + Action Context contract are
   provider-agnostic.
2. **Parity harness.** Run the canonical flow
   (`resolve → briefing → action_context → writeback-preview → lineage`) against
   the connector-free path and at least one mocked/sandbox SoR adapter, proving an
   identical Action Context contract.
3. **SoR-defers-on-conflict invariant (D2).** On a conflict over a mapped SoR
   field, CRMy flags and defers — never overwrites.

**Acceptance:** the canonical flow yields an identical contract connector-free and
against a sandbox/mock adapter; a mapped-field conflict defers rather than
overwrites.

---

## Calibration decisions (the two 0.9.4 flags)

| Flag | 0.9.4 behavior | 0.9.5 decision |
|---|---|---|
| **Tier-2 auto-promote** | `allowGroupCorroboration: true` hardcoded → high-impact claims can auto-promote from 2 corroborating sources, no human | Governed `tier2_autopromote_policy`, default `corroborated` (≥2 **independent** sources + recency + grounding + confidence); `human_only` available. Validated by eval (false-allow = 0). |
| **Freshness windows** | Hardcoded regex in `memory-trust.ts` | Move to tenant-configurable `default_freshness_days` registry column; current values become defaults. |

## Reduce-UI-dependence audit (explicit deliverable)

Produce and close a checklist of loop-advancing actions and their headless
equivalents:

- ingest source / process source object — MCP/CLI/REST ✔; source-drop creation queues the initial sync and matched objects process automatically
- confirm Signal / promote Memory — MCP/CLI/REST ✔; Tier-0/1 agent-resolvable through assignment review policy
- resolve stale/freshness review — MCP/CLI/REST ✔; agent-resolvable within policy
- request human unblock / handoff — MCP ✔
- writeback preview/request — MCP/REST ✔
- briefing / action context — MCP/CLI/REST ✔

Any UI-only gap on the golden path is a release blocker.

---

## Target "ah-ha" experience (the wow)

> Paste a meeting transcript (or connect your notes source). Within a minute,
> with no forms and no clicking: your agent has a briefing grounded in what the
> customer actually said, knows the security review is the real blocker, drafts a
> follow-up that cites real evidence, and flags the *one* thing that needs your
> sign-off. You confirmed nothing by hand — and you can prove every line.

**Demo script (also the first-run smoke gate):**

```bash
crmy init --demo            # recommended model is pre-certified → auto-promote ON
crmy context ingest --subject "account:Northstar Labs" --file transcript.txt
# → Signals extracted, grounded Tier-0/1 auto-confirmed to Memory, Tier-2 framed for review
crmy briefing "account:Northstar Labs"          # grounded, current, evidence-backed
crmy action-context "account:Northstar Labs" --action customer_outreach
# → warn mode, cites the security blocker, drafts safe outreach, one review flagged
```

No web UI step is required to reach an agent-ready, governed briefing.

---

## Release acceptance criteria

- Fresh `init --demo` with the recommended model auto-confirms Tier-0/1 grounded
  Memory **with zero manual steps**; `crmy certify` enables auto-promotion for a
  passing BYO/local model.
- The golden path (ingest → grounded Memory → briefing → Action Context) requires
  **zero web-UI interaction**.
- Re-ingesting confirming evidence **clears** related reviews instead of adding
  them; a default demo leaves a small, ranked queue.
- Tier-2 high-impact claims follow the configured policy; eval high-risk
  false-allow rate = 0.
- Freshness windows and tier mapping are tenant-configurable; defaults unchanged.
- Sequences/Automations are absent from the default toolset and first-run.
- The Action Context contract is versioned and covered by shape + safety evals.
- The canonical flow yields an identical contract connector-free and against a
  sandbox/mock SoR adapter; mapped-field conflicts defer.
- README/roadmap "decay" claims are tightened to match the now-real mechanism.

## Eval gates (extend the 0.9.3 harness)

| Gate | Target |
|---|---|
| Action Context high-risk false-allow | 0 |
| Tier-2 unsafe auto-promote (forecast/commitment/etc. without policy) | 0 |
| Source-attribution unsupported-claim rate (drafts) | 0 |
| Auto-promotion recall for grounded Tier-0/1 with recommended model | ≥ 0.85 |
| Golden-path required manual UI actions | 0 |
| Scope-leak count | 0 |

## "Automatic" product metrics (track from 0.9.5 on)

- % of grounded Signals auto-confirmed with the recommended model (target: high for Tier-0/1).
- Median open reviews per active account after a standard ingest (target: small).
- Time from ingest to agent-ready briefing.
- Manual UI actions required on the golden path (target: 0).

---

## Sequencing within the release (and risks)

1. **WS1 first** — it unblocks everything; without certification, nothing is
   automatic. Pre-certified models + `crmy certify` are the critical path.
2. **WS2 + WS3 in parallel** — queue self-maintenance and headless auto-ingestion
   are what make the experience *feel* automatic once WS1 unblocks promotion.
3. **WS4 + WS5** — calibration/config and Core Profile default; mostly independent.
4. **WS6 + WS7** — contract versioning and the neutrality harness; independent and
   can trail slightly.

**Primary risk:** automating promotion re-opens the safety surface 0.9.4 closed.
Mitigation: the eval gates above are release-blocking, Tier-2 stays conservative
by default, and the grounding gate + certification gate remain mandatory — 0.9.5
makes the *certified, grounded* path automatic, it does not weaken any gate.

**Secondary risk:** WS2 adds query/sweep load. Pull forward the cheap index/query
hygiene for the new sweeps now; full resilience-at-scale stays in 0.9.8.

---

## What we deliberately did NOT pull into 0.9.5 (and why)

| Deferred | To | Why not 0.9.5 |
|---|---|---|
| Public benchmark vs RAG / Mem0-style memory (Gap 6) | 0.9.7 | Needs the frozen contract (WS6) + neutrality (WS7) first; it's a proof artifact, not an automation enabler. |
| Outcome-learning substrate (Gap 7) | 0.9.7 | Data-capture only; not required for the ah-ha. The learning loop itself is v1.1. |
| Full live Salesforce + HubSpot certification | 0.9.7 | Needs live sandboxes; 0.9.5 ships neutrality-by-construction + a parity harness instead. |
| Resilience at scale (Gap 8) | 0.9.8 | 1.0-RC hardening; 0.9.5 pulls forward only the index/query hygiene WS2 needs. |

Everything required for the "automatic, simple, wow" milestone is in 0.9.5;
nothing else needs to be pulled up.

## Handoff notes for implementers (file pointers)

- Certification gate + service: `packages/server/src/services/model-certification.ts`,
  agent config in `packages/server/src/agent/routes.ts` and `agent/types.ts`,
  eval runner in `packages/server/src/evals/runner.ts`, eval CLI in
  `packages/cli/src/commands/eval.ts`.
- Tiers, freshness windows, grounding method, promotion gate:
  `packages/server/src/services/memory-trust.ts`; auto-promote call sites in
  `packages/server/src/agent/extraction.ts` (cert gate ~1321, tier gate ~1430).
- Promotion writes: `packages/server/src/services/signal-groups.ts`
  (`promoteReadyGroup` ~514), `db/repos/context-entries.ts`.
- Review/staleness sweeps: `packages/server/src/services/staleness.ts`,
  `services/knowledge-governance.ts`, `db/repos/assignments.ts`.
- Freshness window config target: `db/repos/context-type-registry.ts` +
  a new migration (next number after 092) adding `default_freshness_days`.
- Toolsets / Core Profile: `packages/server/src/mcp/toolsets.ts`
  (`CORE_TOOLS`, `standard`, default selection ~262).
- Action Context contract: `packages/server/src/services/action-context.ts`,
  shared types in `@crmy/shared`.
- Eval gates: extend suites in `docs/eval-harness-0.9.3-plan.md` /
  `packages/server/src/evals/`.
