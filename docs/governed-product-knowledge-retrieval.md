# Governed Product Knowledge Retrieval Plan

## Status

Originally drafted before 0.9.1. **Revised for 0.9.3** to build on infrastructure
that has since landed rather than duplicate it. Still an **optional** capability
alongside the [CRMy 0.9.3 Eval Harness Plan](eval-harness-0.9.3-plan.md); it does
not become a required dependency for customer Memory, briefings, Action Context,
or writeback.

This plan covers product, service, solution, pricing, implementation, roadmap,
security, compliance, and competitive knowledge that can improve GTM agent
outputs — retrieved through a governed, cited, freshness-aware, auditable layer.

## What Changed Since This Plan Was Drafted (and how it simplifies the design)

The pre-0.9.1 plan assumed product knowledge needed a brand-new stack: a source
registry, retriever adapters, a receipt store, ranking, and proof wiring. Most of
that now exists for customer context and should be **reused**, not rebuilt:

| Landed since draft | What it gives product knowledge for free |
|---|---|
| **Context Sources spine** (0.9.2): `context_source_connections` / `context_source_objects`, S3 / local-folder / HTTP providers, content hashing, processing receipts, match/processing/review states, `context_source_connection_*` and `context_source_object_*` tools | The "knowledge source registry + retriever adapters + sync + freshness" the old plan wanted to invent. Product docs/battlecards/changelogs ingest through the **same spine**, just routed to a different namespace. |
| **Signals → Memory lifecycle** with readiness, confidence decay, duplicate-source/independent-source corroboration, contradiction detection | A proven lifecycle to mirror for **claim envelopes** (draft → reviewed → approved; conflict detection between competing claims). |
| **Source-grounding gate** (0.9.3, #31): a claim only auto-promotes when its evidence is present in the source | The exact governance primitive product claims need — a claim is "approved for external use" only when **grounded in its cited source**. Reuse the helper. |
| **Versioned Action Context packet** (0.9.x): `operating_mode`, `checks{}`, `proof{ expected_receipts }` | A first-class slot for a `product_knowledge` check and `used_knowledge_claim_ids` / `knowledge_retrieval_receipt_ids` proof — no new contract needed. |
| **Token-budget profiles + `evidence_mode` + ranked packing** (briefing.ts) | Reuse for product-context packing and "dropped/excluded claim" reporting. |
| **Per-session toolsets** (#30) | `knowledge_retrieve` slots into a focused toolset; agents only see it when the job needs it. |
| **Eval harness + `crmy.eval_case.v1` + exporters + CI gate** (#29, #35) | The proof mechanism: a `product_knowledge` eval suite (source attribution, no-unsupported-claims, freshness filtering, golden drafts) instead of bespoke test scaffolding. |
| **`email_draft_preview` carrying Action Context proof** (0.9.1) | The concrete draft-integration seam for approved, cited product claims. |
| **`guide_search`** (read-only keyword search over CRMy's own docs) | Precedent for a corpus-retrieval tool. `knowledge_retrieve` is its **tenant-scoped, governed** sibling (approval, visibility, freshness, receipts). |

Net effect: this becomes mostly **new namespace + new service + reuse**, not a
second platform. That is the "simple but powerful" core of the revision.

## Decision (unchanged in spirit)

Support product and competitive knowledge as an **optional governed retrieval
layer**, not a product-knowledge database users must maintain.

The core product stays: `Raw Context -> Signals -> Memory -> Briefing / Action
Context -> Handoff / Writeback -> Proof`. Product knowledge is a **sibling
retrieval namespace** that follows the same lifecycle ideas and rides the same
ingestion, proof, and eval rails.

## Problem

Customer-aware agents still produce generic follow-ups when they cannot connect
customer Memory to current product capabilities, proof points, limitations,
implementation caveats, roadmap notes, pricing/packaging notes, and competitive
positioning. But that information changes fast. If CRMy forces users to copy and
maintain product content, it becomes a stale enablement CMS and weakens the core
promise.

The right question is not "where does product knowledge live?" It is **"how does
an agent know which product claims are safe to use for *this* customer action?"**

## Goals

- Keep product knowledge optional and non-blocking (core flows unchanged when unconfigured).
- Keep external systems authoritative for product content.
- Reuse the Context Sources spine, Action Context proof, grounding gate, token
  budgeting, and eval harness rather than parallel machinery.
- One backend `KnowledgeRetrievalService` behind MCP, REST, CLI, Workspace Agent,
  briefings, and Action Context.
- Improve follow-ups by matching customer pain/use-case/persona/industry/
  competitor context to **approved, grounded** product claims.
- Prevent unsupported customer-facing claims; surface freshness, approval,
  visibility, evidence, citations, conflicts.
- Record retrieval receipts as first-class proof, linked into Lineage and Action
  Context.

## Non-Goals

- Do not require product knowledge for core functionality.
- Do not make MCP the only internal path (the Workspace Agent calls the service directly).
- Do not become a generic CMS, battlecard platform, roadmap tool, or CPQ/pricing source of truth.
- Do not merge product truth into customer Memory; keep a separate namespace.
- Do not let customer-facing drafts use stale, unapproved, conflicting, or internal-only claims.
- Do not require pgvector/embeddings for v1.
- **Do not fork the source-ingestion model** — extend Context Sources with a knowledge source class.

## Architecture: One Spine, Two Namespaces

The central design decision: **product knowledge enters through the same Context
Sources pipeline as customer context, but lands in a product-knowledge namespace
of claim envelopes instead of customer Memory.**

```text
Customer context:   Source object -> Activity/Artifact -> Signals -> Memory
Product knowledge:  Source object -> Claim Signal      -> Claim envelope (approved)
                    \____________ same connections/objects spine ____________/
```

- A `context_source_connections` row gains a **source class** of `product_knowledge`
  (alongside today's customer transcript/note drops). Same S3/local/HTTP providers,
  same sync, same content hashing, same processing receipts and review states.
- Processing a product source object yields **claim signals** (extracted, draft,
  reviewable) rather than customer Signals. A claim becomes an **approved claim**
  only when it is reviewed/approved by policy **and grounded in its cited source**
  (reusing the 0.9.3 grounding gate).
- Retrieval, policy filtering, ranking, citations, warnings, and proof live in a
  shared `KnowledgeRetrievalService`, exposed identically to every surface.

This gives users **one mental model for how context enters CRMy**, one proof
model, and one eval harness — while keeping customer truth and product truth in
separate namespaces.

### Components (most already exist)

| Component | Status | Responsibility |
|---|---|---|
| Context Sources connection/object spine | **exists** | Source registration, providers, sync, hashing, processing receipts, review state. Add a `product_knowledge` source class. |
| `KnowledgeRetrievalService` | **new** | Retrieval, policy filtering, ranking, warning generation, proof creation. The one internal boundary. |
| Claim namespace (`knowledge_claims`) | **new** | Source-derived claim envelopes with scope, evidence, freshness, approval, visibility, conflict, status. |
| Retrieval receipt store (`knowledge_retrieval_receipts`) | **new** (mirrors Action Context receipts/Lineage) | Durable proof of query, filters, returned/excluded claims, warnings, citations, source versions, actor. |
| Grounding check | **reuse** (`extraction-grounding`) | A claim is external-safe only if grounded in its cited source text. |
| Action Context `product_knowledge` check + proof | **reuse slot** | Adds to existing `checks{}` / `proof{}`; no new contract. |
| Token-budget packer + `evidence_mode` | **reuse** | Packs product context within budget; reports dropped/excluded claims. |
| Eval `product_knowledge` suite | **reuse harness** | Source attribution, no-unsupported-claims, freshness, golden drafts via `crmy.eval_case.v1`. |
| Surface adapters (MCP/REST/CLI/UI/briefing/Action Context) | **new thin wrappers** | Call the one service. |

## Lifecycle: Claim Envelope (mirrors Signals → Memory)

| Customer side | Product-knowledge side |
|---|---|
| Raw Context object | Product source object (same spine) |
| Signal (inferred, evidence, readiness) | **Claim signal** (extracted, draft, evidence, source ref) |
| Independent-source corroboration / readiness gate | **Grounding gate** (claim text supported by cited source) + approval policy |
| Memory (confirmed, decay-aware, stale-aware) | **Approved claim** (approved, external-use flag, freshness window, conflict state) |
| Contradiction detection | **Claim conflict detection** (competing claims for same scope) |
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
write back *customer records*. Product-knowledge sources are **retrieval-only**
and never write back. They reuse connector *patterns* (health, sync, adapters),
not the customer-record mappings or writeback paths.

## Retrieval Contract: `knowledge_retrieve`

First-class external MCP tool (placed in a `product_knowledge` toolset, and added
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
`not_configured`. Callers that do not explicitly require product context always
continue on any non-`available` status.

| Surface | Shape |
|---|---|
| MCP | `knowledge_retrieve`; later `knowledge_source_list`, `knowledge_receipt_get`. In a `product_knowledge` toolset. |
| REST | `POST /api/v1/knowledge/retrieve`; receipt detail route later. |
| CLI | `crmy knowledge retrieve` (and works via `crmy tools call knowledge_retrieve`). |
| Workspace Agent | Direct service call (not local MCP); same policy + receipts. |
| Briefings | Optional `include_product_context`; `not_configured` never fails the briefing. |
| Action Context | `product_knowledge` check + proof when a proposed action may use claims. |
| UI | Product context in BriefingPanel / EmailDraftDrawer; setup under **Context → Sources** (its natural home now). |

## Briefing & Action Context Integration

Product context is a **sibling** to customer Memory, never mixed into it.

Briefing (available / unavailable):

```json
{ "product_context": { "status": "available", "relevant_claims": [], "proof_points": [],
  "implementation_caveats": [], "competitive_context": [], "avoid_claims": [],
  "warnings": [], "citations": [], "retrieval_receipt_id": "receipt_789" } }
```
```json
{ "product_context": { "status": "not_configured", "warnings": [] } }
```

Action Context reuses the existing `checks{}` and `proof{}` slots:

```json
{
  "checks": { "product_knowledge": { "status": "ready", "approved_claim_count": 4,
    "stale_claim_count": 0, "internal_only_excluded_count": 2, "conflicting_claim_count": 0,
    "ungrounded_excluded_count": 0, "reasons": [] } },
  "proof": { "used_knowledge_claim_ids": ["claim_123"],
    "knowledge_retrieval_receipt_ids": ["receipt_789"], "expected_receipts": ["receipt_789"] }
}
```

## Policy, Freshness, Failure Behavior, Ranking

These sections from the original plan remain correct and are retained:

- **Customer-facing policy default**: require approved + **grounded**; exclude
  internal-only, stale, deprecated, and conflicting (unless allowed for internal
  analysis); include citations and relevant caveats; record a receipt.
- **Internal policy**: may include unapproved/stale/internal-only/conflicting/
  draft claims, each clearly labeled with warnings.
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

Actors may still compile product knowledge outside CRMy. CRMy accepts optional
edge-provided citations (title, source_url/label, retrieved_at, customer_facing_used,
actor_attestation) and records them as **edge-provided, not CRMy-verified**. The
value is honest proof, not false certification. (Decision below: edge-provided
knowledge is *recorded* but does **not** satisfy customer-facing policy.)

## Proof & Evaluation (new, reusing 0.9.3 rails)

- **Receipts as proof**: `knowledge_retrieval_receipts` are emitted like Action
  Context receipts and surfaced in **Lineage** (`context_lineage_get`) so admins
  can trace which claims an agent used, why others were excluded, and from which
  source versions.
- **Eval suite**: add a `product_knowledge` suite to the eval harness, authored as
  `crmy.eval_case.v1` cases. Metrics:
  - `claim_source_attribution` — every returned customer-facing claim is grounded + cited;
  - `unsupported_claim_rate` — drafts never assert ungrounded/unapproved claims (target 0);
  - `freshness_exclusion_accuracy` — stale/expired claims excluded from customer-facing output;
  - `policy_exclusion_accuracy` — internal-only/conflicting/deprecated excluded;
  - `golden_draft_quality` — follow-ups use approved claims when present, draft conservatively when not.
- **CI gate**: include the deterministic parts of the suite in the eval workflow;
  the live-draft parts run under the live-model profile.

## Data Model Direction (lean; reuse first)

Reuse `context_source_connections` / `context_source_objects` (add a
`source_class = 'product_knowledge'`). Add only:

- `knowledge_claims` — source-derived claim envelopes:
  tenant_id, claim_id, category, title/body/summary, structured scope (product,
  competitor, persona, industry, use_case), source refs + source version/hash,
  `grounded` flag, confidence, approval_status, visibility, external_use flag,
  effective/expiry dates, last_verified_at, review_owner, status (active | stale |
  deprecated | conflicting | rejected), search_vector, optional embedding.
- `knowledge_retrieval_receipts` — query, normalized filters, returned/excluded
  claim IDs + reasons, warnings, citations, source versions, policy, actor, timestamps.
- optional `knowledge_claim_citations` if citations need their own rows.

Avoid v1 tables for a full product catalog, features, battlecards, pricing plans,
roadmap items, personas, industries, objections. **Start with claim envelopes +
scopes derived from sources**, not a hand-maintained catalog.

## Resolved Open Questions (decisions for this revision)

| Original question | Decision |
|---|---|
| Off by default per tenant until configured? | **Yes.** Product context is `not_configured` until a `product_knowledge` source exists. |
| First source systems? | **HTTP/document + S3/local drops first** (already supported providers); changelog/battlecard URLs next. Warehouse/support-KB adapters later, by demand. |
| Can edge-provided knowledge satisfy customer-facing policy? | **No.** Recorded as not-verified proof only; never satisfies the approved+grounded customer-facing gate. |
| Should CRMy write approval state back to source systems? | **No** in v1 — product-knowledge sources are retrieval-only. |
| Categories requiring mandatory expiry? | Competitive, pricing/packaging, roadmap (short windows above); others get defaults with override. |
| Minimum UI for source setup? | Reuse **Context → Sources**; no new primary nav (consistent with `what-belongs-where.md`). |

Still genuinely open: claim-approval ownership per category (competitive vs
pricing vs security/compliance); anonymization/approval workflow for
customer-evidence proof points; whether claim approval ever needs a dedicated
review queue separate from Handoffs.

## Implementation Phases (revised to reuse what exists)

### Phase 1 — Contracts + no-op service
Shared schemas (`knowledge_retrieve` I/O, claim envelope, receipt, `crmy.eval_case`
product cases). `KnowledgeRetrievalService` returns `not_configured`. Regression
tests prove core briefing/Action Context unchanged. Feature-flagged.

### Phase 2 — Source class + retrieval over sources
Add `product_knowledge` source class to Context Sources (reuse connection/object
spine, providers, hashing, receipts). Implement deterministic policy filtering,
lexical retrieval, grounding gate on claims, and `knowledge_retrieval_receipts`.
Ship `knowledge_retrieve` (MCP) + `POST /api/v1/knowledge/retrieve`.

### Phase 3 — Briefing + Action Context enrichment
Optional `include_product_context`; product-context briefing section; Action
Context `product_knowledge` check + proof using existing slots. Unavailable
product context never fails the core response.

### Phase 4 — Workspace Agent + draft integration
Workspace Agent + `email_draft_preview` request product context via the service;
drafts include only approved, grounded, external-safe claims with citations,
used-claim IDs, and receipt IDs in generation metadata.

### Phase 5 — UI + CLI
`crmy knowledge retrieve`; product context in BriefingPanel / EmailDraftDrawer;
source setup under Context → Sources; show warnings, exclusions, approval,
citations, and the `not_configured` state.

### Phase 6 — Claim cache/index + adapters
Optional FTS + embeddings on claim envelopes; freshness/deprecation handling;
additional source adapters only where users need them.

### Phase 7 — Governance
Reuse stale-review assignments for claim freshness; reuse contradiction patterns
for claim-conflict detection; source-priority conflict resolution; approval flows
only if CRMy becomes responsible for claim approval.

## Tests Required

- **Core regression**: customer briefing, Action Context, drafts, writeback work with no product sources.
- **Contract**: MCP/REST/CLI/shared-schema shapes; `crmy.eval_case.v1` product cases load.
- **Policy**: customer-facing retrieval excludes stale, internal-only, deprecated, conflicting, ungrounded, and unapproved claims.
- **Grounding**: a claim is external-safe only when grounded in its cited source.
- **Edge-provided**: recorded as not-verified; does not satisfy customer-facing policy.
- **Retrieval**: filters, lexical fallback, optional embeddings, ranking, token packing, no-results.
- **Proof**: receipts link into Lineage, draft metadata, and Action Context proof.
- **Security**: tenant isolation, scoped access, source visibility, no leakage into customer-facing packets.
- **Eval suite (CI)**: source attribution, unsupported-claim-rate (0), freshness/policy exclusion accuracy, golden drafts.

## Product Principle

CRMy should not make agents use product knowledge through CRMy. It should make
agents *want* to — because the result is more specific, safer, grounded, cited,
policy-aware, and auditable, on the same rails as everything else CRMy governs.
