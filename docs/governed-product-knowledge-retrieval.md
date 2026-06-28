# Trusted Facts Retrieval Plan

## Status

Originally drafted before 0.9.1. **Revised for 0.9.3** to build on infrastructure
that has since landed rather than duplicate it. Phases 1-7 of the Trusted Fact
path have landed in 0.9.3; source-adapter automation and embedding-backed
retrieval remain follow-on work. Still an **optional** capability
alongside the [CRMy 0.9.3 Eval Harness Plan](eval-harness-0.9.3-plan.md); it does
not become a required dependency for customer Memory, briefings, Action Context,
or writeback.

This plan covers company, product, service, solution, pricing, implementation, roadmap,
security, compliance, and competitive facts that can improve GTM agent
outputs — retrieved through a governed, cited, freshness-aware, auditable layer.

## What Changed Since This Plan Was Drafted (and how it simplifies the design)

The pre-0.9.1 plan assumed governed knowledge needed a brand-new stack: a source
registry, retriever adapters, a receipt store, ranking, and proof wiring. Most of
that now exists for customer context and should be **reused**, not rebuilt:

| Landed since draft | What it gives Trusted Facts for free |
|---|---|
| **Context Sources spine** (0.9.2): `context_source_connections` / `context_source_objects`, S3 / local-folder / HTTP providers, content hashing, processing receipts, match/processing/review states, `context_source_connection_*` and `context_source_object_*` tools | The "knowledge source registry + retriever adapters + sync + freshness" the old plan wanted to invent. Source-adapter automation for docs should reuse this spine later; 0.9.3 stores governed facts as Trusted Facts. |
| **Signals → Memory lifecycle** with readiness, confidence decay, duplicate-source/independent-source corroboration, contradiction detection | A proven lifecycle to mirror for **Trusted Facts** (draft → reviewed → approved; conflict detection between competing facts). |
| **Source-grounding gate** (0.9.3, #31): a claim only auto-promotes when its evidence is present in the source | The exact governance primitive Trusted Facts need: a fact is "approved for external use" only when **grounded in its cited source**. Reuse the helper. |
| **Versioned Action Context packet** (0.9.x): `operating_mode`, `checks{}`, `proof{ expected_receipts }` | A first-class slot for a `knowledge` check and `used_knowledge_snippet_ids` / `knowledge_retrieval_receipt_ids` proof — no new contract needed. |
| **Token-budget profiles + `evidence_mode` + ranked packing** (briefing.ts) | Reuse for fact packing and dropped/excluded reporting. |
| **Per-session toolsets** (#30) | `knowledge_retrieve` slots into a focused toolset; agents only see it when the job needs it. |
| **Eval harness + `crmy.eval_case.v1` + exporters + CI gate** (#29, #35) | The proof mechanism: a knowledge eval suite (source attribution, no-unsupported-facts, freshness filtering, golden drafts) instead of bespoke test scaffolding. |
| **`email_draft_preview` carrying Action Context proof** (0.9.1) | The concrete draft-integration path for approved, cited Trusted Facts. |
| **`guide_search`** (read-only keyword search over CRMy's own docs) | Precedent for a corpus-retrieval tool. `knowledge_retrieve` is its **tenant-scoped, governed** sibling (approval, visibility, freshness, receipts). |

Net effect: this becomes mostly **new namespace + new service + reuse**, not a
second platform. That is the "simple but powerful" core of the revision.

## Decision (unchanged in spirit)

Support company, product, and competitive knowledge as an **optional governed retrieval
layer**, not a knowledge database users must maintain.

The core product stays: `Sources -> Signals -> Memory -> Briefing / Action
Context -> Handoff / Writeback -> Proof`. Trusted Facts are a **sibling
retrieval namespace** that follows the same lifecycle ideas and rides the same
ingestion, proof, and eval rails.

## Problem

Customer-aware agents still produce generic follow-ups when they cannot connect
customer Memory to current product capabilities, proof points, limitations,
implementation caveats, roadmap notes, pricing/packaging notes, and competitive
positioning. But that information changes fast. If CRMy forces users to copy and
maintain product content, it becomes a stale enablement CMS and weakens the core
promise.

The right question is not "where does knowledge live?" It is **"how does
an agent know which Trusted Facts are safe to use for *this* customer action?"**

## Goals

- Keep Trusted Facts optional and non-blocking (core flows unchanged when unconfigured).
- Keep external systems authoritative for company, product, competitive, and compliance content.
- Reuse the Context Sources spine, Action Context proof, grounding gate, token
  budgeting, and eval harness rather than parallel machinery.
- One backend `KnowledgeRetrievalService` behind MCP, REST, CLI, Workspace Agent,
  briefings, and Action Context.
- Improve follow-ups by matching customer pain/use-case/persona/industry/
  competitor context to **approved, grounded** Trusted Facts.
- Prevent unsupported customer-facing facts; surface freshness, approval,
  visibility, evidence, citations, conflicts.
- Record retrieval receipts as first-class proof, linked into Lineage and Action
  Context.

## Non-Goals

- Do not require Trusted Facts for core functionality.
- Do not make MCP the only internal path (the Workspace Agent calls the service directly).
- Do not become a generic CMS, battlecard platform, roadmap tool, or CPQ/pricing source of truth.
- Do not merge Trusted Facts into customer Memory; keep a separate namespace.
- Do not let customer-facing drafts use stale, unapproved, conflicting, or internal-only facts.
- Do not require pgvector/embeddings for v1.
- **Do not fork the source-ingestion model** — source-adapter automation should reuse Context Sources; governed retrieval should operate over Trusted Facts.

## Architecture: One Spine, Two Namespaces

The central design decision: **Trusted Facts stay in a governed knowledge
namespace instead of customer Memory.** Future source
adapters should reuse the Context Sources spine, but 0.9.3 does not require a
new source class to retrieve Trusted Facts.

```text
Customer context:   Source object -> Activity/Artifact -> Signals -> Memory
Knowledge:          Source text/tool -> Fact envelope -> Governed retrieval
                    Future adapters should reuse the source-object spine.
```

- Admins and trusted tools can author Trusted Facts directly through
  `knowledge_claim_upsert`; future source adapters should produce the same
  envelopes from product docs, battlecards, changelogs, company docs, and support/security
  materials.
- Processing a knowledge source object yields **fact candidates** (extracted, draft,
  reviewable) rather than customer Signals. A fact becomes a **Trusted Fact**
  only when it is reviewed/approved by policy **and grounded in its cited source**
  (reusing the 0.9.3 grounding gate).
- Retrieval, policy filtering, ranking, citations, warnings, and proof live in a
  shared `KnowledgeRetrievalService`, exposed identically to every surface.

This gives users **one mental model for how context enters CRMy**, one proof
model, and one eval harness — while keeping customer Memory and Trusted Facts in
separate namespaces.

### Components (most already exist)

| Component | Status | Responsibility |
|---|---|---|
| Context Sources connection/object spine | **exists** | Source registration, providers, sync, hashing, processing receipts, review state. Reuse for future source adapters; not required for 0.9.3 claim-envelope retrieval. |
| `KnowledgeRetrievalService` | **landed** | Retrieval, policy filtering, ranking, warning generation, proof creation. The one internal boundary. |
| Claim namespace (`knowledge_claims`) | **landed** | Source-derived facts with scope, evidence, freshness, approval, visibility, conflict, status. |
| Retrieval receipt store (`knowledge_retrieval_receipts`) | **landed** (mirrors Action Context receipts/Lineage) | Durable proof of query, filters, returned/excluded claims, warnings, citations, source versions, actor. |
| Grounding check | **reuse** (`extraction-grounding`) | A claim is external-safe only if grounded in its cited source text. |
| Action Context `knowledge` check + proof | **reuse slot** | Adds to existing `checks{}` / `proof{}`; no new contract. |
| Token-budget packer + `evidence_mode` | **reuse** | Packs facts within budget; reports dropped/excluded facts. |
| Eval knowledge suite | **reuse harness** | Source attribution, no-unsupported-facts, freshness, golden drafts via `crmy.eval_case.v1`. |
| Surface adapters (MCP/REST/CLI/UI/briefing/Action Context) | **new thin wrappers** | Call the one service. |

## Lifecycle: Claim Envelope (mirrors Signals → Memory)

| Customer side | Trusted Fact side |
|---|---|
| Source object | Product source object (same spine) |
| Signal (inferred, evidence, readiness) | **Claim signal** (extracted, draft, evidence, source ref) |
| Independent-source corroboration / readiness gate | **Grounding gate** (claim text supported by cited source) + approval policy |
| Memory (confirmed, decay-aware, stale-aware) | **Approved claim** (approved, external-use flag, freshness window, conflict state) |
| Contradiction detection | **Fact conflict detection** (competing facts for same scope) |
| Stale review assignments | **Claim freshness review** (per-category windows, owner) |

Reusing these patterns means governance behaviors (staleness, conflict, review,
proof) are familiar to users and largely reuse existing services.

## Source Of Truth Boundaries (unchanged — still correct)

| Belongs in CRMy core | Belongs in connectors/adapters | Belongs outside CRMy |
|---|---|---|
| Retrieval contract, policy, filtering | Source-specific fetch/sync, paging, auth | Product doc authoring |
| Approval/visibility/freshness metadata | Source version/hash, doc IDs, URLs | Roadmap & pricing systems of record |
| Retrieval receipts and proof | Incremental sync checkpoints | Competitive research authoring |
| Optional claim cache/index | Source deprecation/deletion signals | Legal/compliance approval systems |
| Briefing & Action Context integration | — | CPQ / packaging workflow |

Note the **distinction from Systems of Record**: SoR connectors (0.8) map and
write back *customer records*. Knowledge sources are **retrieval-only**
and never write back. They reuse connector *patterns* (health, sync, adapters),
not the customer-record mappings or writeback paths.

## Retrieval Contract: `knowledge_retrieve`

First-class external MCP tool (placed in a `knowledge` toolset, and added
to `customer_outreach` where drafting needs it). Retrieves with trust metadata;
never creates Memory or writes to systems of record.

Input (illustrative):

```json
{
  "query": "How should we respond to a vendor lock-in objection?",
  "subject_type": "account",
  "subject_id": "00000000-0000-0000-0000-000000000000",
  "audience": "customer_facing",
  "proposed_action": "customer_outreach",
  "product_scope": ["mcp", "self-hosted"],
  "competitor": "Attio",
  "persona": "VP Engineering",
  "industry": "Healthcare",
  "require_approved": true,
  "include_stale": false,
  "limit": 8
}
```

Output (illustrative):

```json
{
  "status": "available",
  "claims": [
    {
      "id": "claim_123",
      "category": "competitive_response",
      "title": "Approved response to vendor lock-in objection",
      "body": "Approved response text or summary.",
      "confidence": 0.92,
      "grounded": true,
      "approval_status": "approved",
      "approved_for_external_use": true,
      "visibility": "external",
      "effective_at": "2026-05-01T00:00:00Z",
      "valid_until": "2026-08-01T00:00:00Z",
      "source_priority": "authoritative",
      "citations": [
        { "source_label": "Competitive battlecard", "source_url": "https://example.invalid/battlecard", "source_ref": "battlecard:v3" }
      ]
    }
  ],
  "excluded_claims": [ { "id": "claim_456", "reason": "internal_only" } ],
  "warnings": [],
  "retrieval_receipt": { "id": "receipt_789", "policy": "customer_facing_approved_only", "retrieved_at": "2026-06-06T12:00:00Z" }
}
```

`status` values: `available`, `no_results`, `degraded` (source timeout),
`not_configured`. Callers that do not explicitly require Trusted Facts always
continue on any non-`available` status.

| Surface | Shape |
|---|---|
| MCP | `knowledge_retrieve`; later `knowledge_source_list`, `knowledge_receipt_get`. In a `knowledge` toolset. |
| REST | `POST /api/v1/knowledge/retrieve`; receipt detail route later. |
| CLI | `crmy knowledge retrieve` (and works via `crmy tools call knowledge_retrieve`). |
| Workspace Agent | Direct service call (not local MCP); same policy + receipts. |
| Briefings | Optional `include_knowledge`; `not_configured` never fails the briefing. |
| Action Context | `knowledge` check + proof when a proposed action may use facts. |
| UI | Trusted Facts in BriefingPanel / EmailDraftDrawer; connector setup under **Settings → Knowledge Sources**. |

## Briefing & Action Context Integration

Trusted Facts are a **sibling** to customer Memory, never mixed into it.

Briefing (available / unavailable):

```json
{ "knowledge": { "status": "available", "relevant_claims": [], "proof_points": [],
  "implementation_caveats": [], "competitive_context": [], "avoid_claims": [],
  "warnings": [], "citations": [], "retrieval_receipt_id": "receipt_789" } }
```
```json
{ "knowledge": { "status": "not_configured", "warnings": [] } }
```

Action Context reuses the existing `checks{}` and `proof{}` slots:

```json
{
  "checks": { "knowledge": { "status": "ready", "approved_claim_count": 4,
    "stale_claim_count": 0, "internal_only_excluded_count": 2, "conflicting_claim_count": 0,
    "ungrounded_excluded_count": 0, "reasons": [] } },
  "proof": { "used_knowledge_snippet_ids": ["claim_123"],
    "knowledge_retrieval_receipt_ids": ["receipt_789"], "expected_receipts": ["receipt_789"] }
}
```

## Policy, Freshness, Failure Behavior, Ranking

These sections from the original plan remain correct and are retained:

- **Customer-facing policy default**: require approved + **grounded**; exclude
  internal-only, stale, deprecated, and conflicting (unless allowed for internal
  analysis); include citations and relevant caveats; record a receipt.
- **Internal policy**: may include unapproved/stale/internal-only/conflicting/
  draft facts, each clearly labeled with warnings.
- **Freshness windows** (per category): competitive 30–60d; pricing/packaging
  14–30d; roadmap 14–30d; security/compliance 30–90d; implementation 60–120d;
  stable capabilities 90–180d; proof points 90–180d or source-specific.
- **Failure behavior**: `not_configured` / `degraded` / `no_results` never break
  the core flow; missing approval metadata = unapproved for customer-facing use;
  ungrounded = excluded from customer-facing output.
- **Ranking** (deterministic hybrid; no vectors required for v1): structured
  filters → source priority → lexical/full-text → optional embeddings → customer
  relevance (Memory, use case, pain, objections, persona, industry, competitor) →
  **reuse the existing token-budget packer** with dropped/excluded summaries.

## Edge-Compiled Knowledge

Actors may still compile knowledge outside CRMy. CRMy accepts optional
edge-provided citations (title, source_url/label, retrieved_at, customer_facing_used,
actor_attestation) and records them as **edge-provided, not CRMy-verified**. The
value is honest proof, not false certification. (Decision below: edge-provided
knowledge is *recorded* but does **not** satisfy customer-facing policy.)

## Proof & Evaluation (new, reusing 0.9.3 rails)

- **Receipts as proof**: `knowledge_retrieval_receipts` are emitted like Action
  Context receipts and surfaced in **Lineage** (`context_lineage_get`) so admins
  can trace which facts an agent used, why others were excluded, and from which
  source versions.
- **Eval suite**: add a knowledge suite to the eval harness, authored as
  `crmy.eval_case.v1` cases. Metrics:
  - `claim_source_attribution` — every returned customer-facing claim is grounded + cited;
  - `unsupported_fact_rate` — drafts never assert ungrounded/unapproved facts (target 0);
  - `freshness_exclusion_accuracy` — stale/expired facts excluded from customer-facing output;
  - `policy_exclusion_accuracy` — internal-only/conflicting/deprecated excluded;
  - `golden_draft_quality` — follow-ups use approved facts when present, draft conservatively when not.
- **CI gate**: include the deterministic parts of the suite in the eval workflow;
  the live-draft parts run under the live-model profile.

## Data Model Direction (lean; reuse first)

Reuse `context_source_connections` / `context_source_objects` (add a
knowledge source class when adapters land). Add only:

- `knowledge_claims` — source-derived facts:
  tenant_id, claim_id, category, title/body/summary, structured scope (product,
  competitor, persona, industry, use_case), source refs + source version/hash,
  `grounded` flag, confidence, approval_status, visibility, external_use flag,
  effective/expiry dates, last_verified_at, review_owner, status (active | stale |
  deprecated | conflicting | rejected), search_vector, optional embedding.
- `knowledge_retrieval_receipts` — query, normalized filters, returned/excluded
  claim IDs + reasons, warnings, citations, source versions, policy, actor, timestamps.
- optional `knowledge_claim_citations` if citations need their own rows.

Avoid v1 tables for a full product catalog, features, battlecards, pricing plans,
roadmap items, personas, industries, objections. **Start with facts +
scopes derived from sources**, not a hand-maintained catalog.

## Resolved Open Questions (decisions for this revision)

| Original question | Decision |
|---|---|
| Off by default per tenant until configured? | **Yes.** Governed retrieval is `not_configured` until Trusted Facts exist. |
| First source systems? | **Direct Trusted Facts first** through `knowledge_claim_upsert`; source adapters for docs, changelogs, battlecards, warehouses, and support KBs remain future work. |
| Can edge-provided knowledge satisfy customer-facing policy? | **No.** Recorded as not-verified proof only; never satisfies the approved+grounded customer-facing gate. |
| Should CRMy write approval state back to source systems? | **No** in v1 — Knowledge Sources are retrieval-only. |
| Categories requiring mandatory expiry? | Competitive, pricing/packaging, roadmap (short windows above); others get defaults with override. |
| Minimum UI for source setup? | Claim governance now lives in the **Knowledge** workspace. Settings is reserved for **Knowledge Sources**, starting with MCP connector setup rather than unsupported source placeholders. |

Still genuinely open: fact-approval ownership per category (competitive vs
pricing vs security/compliance); anonymization/approval workflow for
customer-evidence proof points; whether claim approval ever needs a dedicated
review queue separate from Handoffs.

## Implementation Phases (revised to reuse what exists)

### Phase 1 — Contracts + no-op service (landed)
Shared schemas (`knowledge_retrieve` I/O, fact, receipt, `crmy.eval_case`
knowledge cases). `KnowledgeRetrievalService` returns `not_configured` when no
facts exist. Regression tests prove core briefing/Action Context unchanged.

### Phase 2 — Fact envelopes + governed retrieval (landed)
Add `knowledge_claims` and `knowledge_retrieval_receipts` (migration 086).
Implement deterministic policy filtering, lexical retrieval, grounding gate on
facts, ranking, durable retrieval receipts, `knowledge_retrieve` over MCP, and
`POST /api/v1/knowledge/retrieve` over REST.

### Phase 3 — Briefing + Action Context enrichment (landed)
Optional `include_knowledge`; Trusted Facts briefing section; Action
Context `knowledge` check + proof using existing slots. Unavailable
Trusted Facts never fail the core response.

### Phase 4 — Workspace Agent + draft integration (landed)
Workspace Agent + `email_draft_preview` request Trusted Facts via the service;
drafts include only approved, grounded, external-safe facts with citations,
used-claim IDs, and receipt IDs in generation metadata.

### Phase 5 — UI + CLI (landed)
`crmy knowledge retrieve`; Trusted Facts in BriefingPanel / EmailDraftDrawer;
Trusted Fact governance in the Knowledge workspace; show warnings, exclusions,
approval, citations, and the `not_configured` state.

### Phase 6 — Freshness + index foundation (landed; adapters planned)
FTS over facts and freshness/deprecation handling have landed.
Embedding-backed retrieval and automated source adapters remain planned.

### Phase 7 — Governance (landed)
Reuse stale-review assignments for fact freshness; reuse contradiction patterns
for fact-conflict detection; source-priority conflict resolution; approval flows
for Trusted Facts.

## Tests Required

- **Core regression**: customer briefing, Action Context, drafts, writeback work with no product sources.
- **Contract**: MCP/REST/CLI/shared-schema shapes; `crmy.eval_case.v1` product cases load.
- **Policy**: customer-facing retrieval excludes stale, internal-only, deprecated, conflicting, ungrounded, and unapproved facts.
- **Grounding**: a claim is external-safe only when grounded in its cited source.
- **Edge-provided**: recorded as not-verified; does not satisfy customer-facing policy.
- **Retrieval**: filters, lexical fallback, optional embeddings, ranking, token packing, no-results.
- **Proof**: receipts link into Lineage, draft metadata, and Action Context proof.
- **Security**: tenant isolation, scoped access, source visibility, no leakage into customer-facing packets.
- **Eval suite (CI)**: source attribution, unsupported-claim-rate (0), freshness/policy exclusion accuracy, golden drafts.

## Product Principle

CRMy should not make agents use Trusted Facts through CRMy. It should make
agents *want* to — because the result is more specific, safer, grounded, cited,
policy-aware, and auditable, on the same rails as everything else CRMy governs.
