# Governed Product Knowledge Retrieval Plan

## Status

Planned after the 0.9 release and before 1.0 as an optional capability.

This plan covers product, service, solution, pricing, implementation, roadmap,
security, compliance, and competitive knowledge that can improve GTM agent
outputs. It does not make product knowledge a required dependency for CRMy's
core customer Memory, briefing, Action Context, or writeback flows.

## Decision

CRMy should support product and competitive knowledge as an optional governed
retrieval layer, not as a product knowledge database that users must maintain.

The core product remains customer Memory for AI sales agents:

Raw Context -> Signals -> Memory -> Briefing / Action Context -> Handoff /
Writeback -> Proof.

Product knowledge should be additive:

- If no product knowledge is configured, CRMy works as it does today.
- If an actor compiles product knowledge at the edge, CRMy can accept optional
  proof that the actor used external knowledge.
- If an actor retrieves product knowledge through CRMy, CRMy provides value by
  filtering, ranking, citing, warning, and recording proof.

## Problem

Customer-aware agents still produce generic follow-ups when they cannot connect
customer Memory to current product capabilities, proof points, limitations,
implementation considerations, roadmap caveats, pricing/package notes, and
competitive positioning.

However, product and competitive information changes quickly. If CRMy requires
users to copy and maintain product information in CRMy, the system becomes a
stale enablement CMS and weakens the core product promise.

The right question is not "where does product knowledge live?" The right
question is "how does an agent know which product claims are safe to use for
this customer action?"

## Goals

- Keep product knowledge optional and non-blocking.
- Keep external systems authoritative for product content.
- Provide a governed retrieval contract that external MCP agents, REST clients,
  the Workspace Agent, email drafts, and briefings can all use.
- Improve generated follow-ups by matching customer pain, use case, persona,
  industry, and competitor context to approved product claims.
- Prevent unsupported customer-facing claims.
- Surface freshness, approval, visibility, evidence, and citations.
- Record retrieval receipts so admins can inspect what product knowledge was
  used by an agent.
- Preserve CRMy's identity as the governed customer context and action layer.

## Non-Goals

- Do not require product knowledge for core CRMy functionality.
- Do not require local agent integration for the Workspace Agent.
- Do not make MCP the only internal implementation path.
- Do not turn CRMy into a generic knowledge base, CMS, battlecard platform,
  roadmap system, or CPQ/pricing source of truth.
- Do not merge product truth into customer Memory without a separate namespace.
- Do not let customer-facing drafts use stale, unapproved, conflicting, or
  internal-only product claims.
- Do not require pgvector or embeddings for the first version.

## Existing Architecture Constraints

The current codebase is deliberately customer-subject scoped. Shared schemas
limit subjects to contacts, accounts, opportunities, and use cases. Context
entries, Signal groups, briefings, stale review, contradiction detection,
Action Context, CLI commands, MCP tools, REST routes, and UI Context surfaces
all revolve around customer records.

That shape is a strength for customer Memory, but it resists global product
truth. Reusing `context_entries` directly for global product claims would force
claims onto arbitrary customer subjects, duplicate facts across accounts, and
blur the distinction between:

- "This customer is evaluating Competitor X."
- "Our approved response to Competitor X is Y."

Product knowledge needs a separate retrieval namespace even if it reuses the
same lifecycle ideas: evidence, provenance, confidence, freshness, approval,
visibility, staleness, contradiction warnings, and proof.

## Operating Modes

| Mode | Behavior | CRMy responsibility |
|---|---|---|
| No product knowledge configured | Core briefings, Action Context, drafts, and writeback safety work as today. | Return `not_configured` or omit product context. |
| Edge-compiled knowledge | An actor retrieves product knowledge outside CRMy. | Optionally record edge-provided citations and mark them as not CRMy-verified. |
| CRMy-governed retrieval | An actor asks CRMy for product context. | Retrieve from configured sources, filter by policy, cite evidence, warn, and record proof. |
| Cached/indexed claims | CRMy stores source-derived snippets or claim envelopes. | Maintain freshness, source refs, approval metadata, visibility, search indexes, and retrieval receipts. |

## Recommended Architecture

Build a shared backend `KnowledgeRetrievalService` and expose it through MCP,
REST, CLI, UI, and the Workspace Agent.

MCP should be the first-class external agent interface, but not the internal
dependency boundary. The Workspace Agent should call the same backend service
directly through the server. REST and CLI should call the same service through
normal API routes. This avoids making the product depend on local MCP or local
agent setup.

### Components

| Component | Responsibility |
|---|---|
| `KnowledgeRetrievalService` | Shared retrieval, policy filtering, ranking, warning generation, and proof creation. |
| Knowledge source registry | Configured external sources, source priority, source type, visibility defaults, and health. |
| Retriever adapters | Pluggable readers for docs, changelogs, battlecards, websites, warehouses, support KBs, or custom APIs. |
| Claim cache/index | Optional source-derived snippets or normalized claim envelopes for fast retrieval. |
| Retrieval receipt store | Durable proof of query, filters, returned claims, excluded claims, warnings, citations, source versions, and actor. |
| Product context policy | External-use, approval, freshness, source priority, conflict, and internal-only rules. |
| Surface adapters | MCP tool, REST endpoint, CLI command, briefing enrichment, Action Context enrichment, Workspace Agent use, and UI display. |

## Source Of Truth Boundaries

| Belongs in CRMy core | Belongs in connectors/adapters | Belongs outside CRMy |
|---|---|---|
| Retrieval contract | Source-specific fetch and sync logic | Product doc authoring |
| Policy and filtering | Source freshness and version metadata | Roadmap management |
| Approval/visibility metadata | Source document IDs, hashes, URLs | Pricing system of record |
| Retrieval receipts and proof | Incremental sync checkpoints | Competitive research authoring |
| Optional claim cache/index | Adapter-specific auth and paging | Legal/compliance approval systems |
| Briefing and Action Context integration | Source-specific deletion/deprecation signals | CPQ and packaging workflow |

## MCP-First External Path

Add an MCP tool such as `knowledge_retrieve`.

The tool should retrieve product, service, solution, and competitive context
with trust metadata. It should not silently create Memory or write to systems
of record.

Illustrative input:

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

Illustrative output:

```json
{
  "status": "available",
  "claims": [
    {
      "id": "claim_123",
      "category": "competitive_response",
      "title": "Approved response to vendor lock-in objection",
      "body": "Use the approved response text or summary here.",
      "confidence": 0.92,
      "approval_status": "approved",
      "approved_for_external_use": true,
      "visibility": "external",
      "effective_at": "2026-05-01T00:00:00Z",
      "valid_until": "2026-08-01T00:00:00Z",
      "source_priority": "authoritative",
      "citations": [
        {
          "source_label": "Competitive battlecard",
          "source_url": "https://example.invalid/battlecard",
          "source_ref": "battlecard:v3"
        }
      ]
    }
  ],
  "excluded_claims": [
    {
      "id": "claim_456",
      "reason": "internal_only"
    }
  ],
  "warnings": [],
  "retrieval_receipt": {
    "id": "receipt_789",
    "policy": "customer_facing_approved_only",
    "retrieved_at": "2026-06-06T12:00:00Z"
  }
}
```

## REST, CLI, UI, And Workspace Agent

The MCP tool should be backed by the same server-side service used by other
surfaces.

| Surface | Recommended shape |
|---|---|
| MCP | `knowledge_retrieve`, later `knowledge_source_list` and `knowledge_receipt_get`. |
| REST | `POST /api/v1/knowledge/retrieve`; optional receipt detail route later. |
| CLI | `crmy knowledge retrieve` plus `crmy tools call knowledge_retrieve` support. |
| Workspace Agent | Internal service call, not local MCP. Uses the same policy and receipts. |
| Briefings | Optional `include_product_context`; omission or `not_configured` does not fail the briefing. |
| Action Context | Optional product checks and proof when a proposed action may use product claims. |
| UI | Display product context in BriefingPanel and EmailDraftDrawer when present; keep setup under Context Sources or Settings. |

## Briefing And Action Context Integration

Product context should be a sibling to customer Memory, not mixed into Memory.

Optional briefing shape:

```json
{
  "product_context": {
    "status": "available",
    "relevant_claims": [],
    "proof_points": [],
    "implementation_caveats": [],
    "competitive_context": [],
    "avoid_claims": [],
    "warnings": [],
    "citations": [],
    "retrieval_receipt_id": "receipt_789"
  }
}
```

If product context is unavailable, the briefing should still succeed:

```json
{
  "product_context": {
    "status": "not_configured",
    "warnings": []
  }
}
```

Action Context should add a product knowledge check only when product context
is requested or when a proposed action asks to use product claims:

```json
{
  "checks": {
    "product_knowledge": {
      "status": "ready",
      "approved_claim_count": 4,
      "stale_claim_count": 0,
      "internal_only_excluded_count": 2,
      "conflicting_claim_count": 0,
      "reasons": []
    }
  },
  "proof": {
    "used_knowledge_claim_ids": ["claim_123"],
    "knowledge_retrieval_receipt_ids": ["receipt_789"]
  }
}
```

## Edge-Compiled Knowledge

Actors may still compile product knowledge outside CRMy. This should remain
allowed.

For trust and audit value, CRMy should accept optional edge-provided knowledge
metadata:

```json
{
  "external_knowledge_used": [
    {
      "title": "Vendor lock-in response",
      "source_url": "https://example.invalid/source",
      "source_label": "External battlecard",
      "retrieved_at": "2026-06-06T12:00:00Z",
      "customer_facing_used": true,
      "actor_attestation": "retrieved_at_edge"
    }
  ]
}
```

CRMy should mark this as edge-provided and not CRMy-verified. The value is
honest proof, not false certification.

## Policy Rules

Customer-facing retrieval should default to:

- require approved claims
- exclude internal-only claims
- exclude stale claims
- exclude deprecated claims
- exclude conflicting claims unless specifically allowed for internal analysis
- include citations
- include implementation caveats and limitations when relevant
- record a retrieval receipt

Internal retrieval may include:

- unapproved claims with warning
- stale claims with warning
- internal-only content
- conflicting claims for analysis
- draft or pending claims, clearly labeled

## Freshness And Reliability

Product claims should carry:

- source type, ID, ref, URL, label, and version/hash
- source updated timestamp
- retrieved timestamp
- effective date
- valid-until or expiry date
- last verified date
- review owner
- confidence
- source priority
- approval status
- external-use flag
- internal-only flag
- deprecation status
- conflict status

Volatile categories should require short freshness windows:

| Category | Suggested default |
|---|---|
| Competitive claims | 30-60 days |
| Pricing/package notes | 14-30 days |
| Roadmap caveats | 14-30 days |
| Security/compliance claims | 30-90 days |
| Implementation requirements | 60-120 days |
| Stable capabilities | 90-180 days |
| Proof points | 90-180 days, or source-specific |

## Retrieval Ranking

Start with deterministic hybrid retrieval:

1. Structured filters: audience, approval, visibility, product, competitor,
   persona, industry, use case, category, freshness.
2. Source priority: authoritative docs before notes or informal sources.
3. Keyword/full-text search.
4. Optional embeddings when configured.
5. Customer relevance: match to customer Memory, use case, pain point,
   objections, industry, persona, implementation stage, and competitor context.
6. Token budget packing with dropped/excluded claim summaries.

Do not require vector search for the first version.

## Failure Behavior

| Scenario | Behavior |
|---|---|
| No sources configured | Return `not_configured`; core flow continues. |
| Source timeout | Return `degraded`; continue unless caller explicitly requires product context. |
| No relevant claims | Return `no_results`; do not invent. |
| Stale claims found | Exclude from customer-facing output and warn. |
| Internal-only claims found | Exclude from customer-facing output and count exclusions. |
| Conflicting claims found | Exclude or require review, depending on audience and policy. |
| Edge-provided claims | Record as not CRMy-verified. |
| Missing approval metadata | Treat as unapproved for customer-facing use. |

## Generated Follow-Up Requirements

A draft should improve only when product context is safely available. The draft
service should:

- match customer pain or objection to an approved capability or response
- include only approved external-safe claims for customer-facing drafts
- include proof points only when they are approved and scoped
- include implementation caveats when relevant
- avoid stale, deprecated, internal-only, or conflicting claims
- cite sources in generation metadata
- record used claim IDs and retrieval receipt IDs
- draft conservatively when no product context is found
- never invent pricing, capabilities, roadmap commitments, security posture, or
  competitive claims

## Data Model Direction

Prefer a small source and receipt model first:

- `knowledge_sources`
- `knowledge_retrieval_receipts`
- optional `knowledge_claim_cache`
- optional `knowledge_claim_citations`

If cached claims are added, they should be source-derived claim envelopes, not
a manually maintained catalog.

Possible cached claim fields:

- tenant ID
- claim ID
- claim category
- title/body/summary
- structured scope
- source refs and source version/hash
- confidence
- approval status
- visibility
- external-use flag
- effective/expiry dates
- last verified date
- review owner
- status: active, stale, deprecated, conflicting, rejected
- search vector
- optional embedding

Avoid first-version tables for full product catalog, features, battlecards,
pricing plans, roadmap items, personas, industries, and objections. Start with
claim envelopes and scopes.

## Implementation Phases

### Phase 1: Contracts And No-Op Service

- Add shared schemas for product knowledge retrieval.
- Add backend service interface.
- Return `not_configured` when no sources exist.
- Add MCP and REST shape behind a feature flag if needed.
- Add tests that core briefing and Action Context behavior is unchanged.

### Phase 2: MCP And REST Retrieval

- Add `knowledge_retrieve`.
- Add REST route.
- Add deterministic policy filtering.
- Add retrieval receipts.
- Support manually configured simple HTTP/document source adapters if needed.

### Phase 3: Briefing And Action Context Enrichment

- Add optional `include_product_context`.
- Add product context section to briefing payloads.
- Add optional Action Context product checks and proof fields.
- Ensure unavailable product context never fails the core response.

### Phase 4: Workspace Agent And Draft Integration

- Let Workspace Agent request product context through the backend service.
- Add email draft packet support for approved product claims.
- Add generation metadata for used claims, citations, warnings, and receipts.
- Add customer-facing policy defaults.

### Phase 5: UI And CLI

- Add CLI retrieval command.
- Add product context display in BriefingPanel and EmailDraftDrawer.
- Add source setup under Context Sources or Settings, not primary navigation.
- Show warnings, exclusions, approval status, and citations.

### Phase 6: Claim Cache And Source Adapters

- Add optional cache/index for source-derived claims.
- Add FTS and optional embedding support.
- Add source freshness and deprecation handling.
- Add adapters only for sources users actually need.

### Phase 7: Governance

- Add stale review assignments for claims with owners.
- Add conflict detection for competing product claims.
- Add source priority conflict resolution.
- Add admin review flows for approval and external-use status if CRMy becomes
  responsible for claim envelopes.

## Tests Required

- Core regression tests: customer briefing, Action Context, drafts, and writeback
  still work with no product sources.
- Contract tests: MCP, REST, shared schemas, and CLI output.
- Policy tests: customer-facing retrieval excludes stale, internal-only,
  deprecated, conflicting, and unapproved claims.
- Edge-provided tests: CRMy records external citations as not verified.
- Retrieval tests: structured filters, lexical fallback, optional embeddings,
  ranking, token packing, and no-results behavior.
- Proof tests: retrieval receipts link to draft metadata and Action Context
  proof.
- Security tests: tenant isolation, scoped access, source visibility, no leakage
  into customer-facing packets.
- UI tests: warnings, citations, approval status, and unavailable-state display.
- Golden draft tests: follow-ups use approved claims when present and draft
  conservatively when not.

## Open Questions

- Which source systems should be supported first?
- Who owns approval for competitive, pricing, roadmap, security, and compliance
  claims?
- Should CRMy ever write approval state back to source systems?
- Which categories require mandatory expiry?
- How should customer evidence in proof points be anonymized and approved?
- Should product context be off by default for all tenants until configured?
- Should edge-provided knowledge be allowed to satisfy customer-facing policy, or
  only recorded as not verified?
- What should be the minimum UI for source setup without creating a new primary
  product area?

## Product Principle

CRMy should not make agents use product knowledge through CRMy. It should make
agents want to use product knowledge through CRMy because the result is more
specific, safer, cited, policy-aware, and auditable.
