# Record Resolution Hardening Plan

CRMy’s context engine depends on one thing being boringly correct: messy customer references must resolve to the right customer record, or remain reviewable when CRMy is not sure. This plan hardens record resolution without widening the product surface.

## Current Assessment

Current score: 8/10 for 0.9 self-hosted readiness.

The foundation is real:

- `entity_resolve` resolves contacts and accounts by email, domain, name, aliases, partial match, fuzzy match, and actor affinity.
- `customer_record_resolve` exposes the account-first Subject Graph resolver through MCP/REST and is the preferred agent-facing lookup path for messy GTM references.
- Raw Context subject detection, reprocess, file ingestion, Customer Email association, Customer Activity association, CLI subject references, and Workspace Agent guidance share the same account-first resolver semantics.
- Contacts, opportunities, and use cases resolve inside a matched account scope when evidence is strong.
- Scoped access filters prevent member/manager actors from resolving hidden records.
- Raw Context and source-association receipts include matched subjects, account scope, examined record counts, skipped candidates, ambiguity counts, and proposed records.

The remaining gap is no longer the basic resolver foundation. The remaining work is launch proof and richer real-world calibration:

- More contributed fixtures from messy calls, emails, meeting transcripts, and source-system syncs.
- Formal account-local ranking explainability for recency, open/recent child status, linked contact, and activity affinity.
- Better user-facing ambiguity copy in every UI receipt, not only structured metadata.
- More alias/domain/history support for subsidiaries, renamed accounts, merged records, and stale CRM references.
- Continued regression tests for “do not over-link” as connectors and new source types evolve.

## Principles

- Resolve when evidence is strong.
- Prefer account-local child records when an account is known.
- Return ambiguity instead of linking multiple plausible records.
- Never resolve hidden records for scoped users.
- Proposed records are reviewable; they are not automatic creates.
- Resolution tests should be corpus-driven, repeatable, and independent of live LLMs.

## Phase 1: Deterministic Safety Fixes

Status: complete for the first hardening slice.

- Exclude merged/stale contacts and accounts from `entity_resolve`.
- Apply contact `company_name` and `title` hints to exact-name and alias matches, not only partial matches.
- Return linked `account_id` and `account_name` in contact candidates so ambiguity is explainable.
- Include aliases in the Raw Context subject directory for contacts and accounts.
- Use account aliases/domains while building Raw Context account scope.
- Do not over-link same-named contacts, opportunities, or use cases when no account scope disambiguates them.
- Do not over-link duplicate child records inside a matched account scope.
- Add regression tests for these cases.

## Phase 2: Golden Resolution Corpus

Status: implemented for the current 0.9 corpus, with ongoing fixture expansion.

Build `record-resolution-golden-corpus.json` with deterministic fixtures for:

- same first name across two accounts;
- same full name across two accounts;
- same opportunity name across two accounts;
- same use-case name across two accounts;
- account alias and domain references;
- subsidiary / parent account references;
- merged contact and merged account exclusion;
- hidden peer-owned record exclusion;
- partial transcript references with known account scope;
- unresolved child under matched account becoming a proposed record.

Corpus coverage now includes account name, alias, and domain scoping; same first-name, same full-name, same opportunity-name, and same use-case-name ambiguity; account-scoped use-case resolution; merged/stale record exclusion; hidden peer-owned record exclusion; and unresolved child records under a matched account becoming proposed records.

Additional test coverage now verifies that model-suggested child records cannot over-link duplicate contacts, opportunities, or use cases, and that account-only deterministic matches can produce reviewed child-record proposals when the model identifies a net-new opportunity/use case/contact under that account.

Each fixture should assert:

- resolved subjects;
- skipped candidates and reasons;
- ambiguity receipts;
- proposed records;
- records examined;
- no hidden record leakage.

## Phase 3: Account-Local Ranking

Status: partially implemented through conservative account-scoped candidate selection and ambiguity detection. Formal ranked explainability remains polish.

- Replace “first match wins” child lookup with ranked account-local candidates.
- Rank by exact ID/email, exact name, alias, account scope, recency, open/recent status, linked contact, and activity affinity.
- Treat equal top candidates as ambiguous, not resolved.
- Preserve conservative behavior for child records outside a matched account.

## Phase 4: Resolver Surface Alignment

Status: implemented for Raw Context, Customer Email, Customer Activity, MCP/REST, CLI subject references, Workspace Agent guidance, and examples/docs.

- Keep `entity_resolve` focused on simple account/contact lookup and expose account-first child resolution through `customer_record_resolve`.
- Align REST, MCP, CLI, Workspace Agent, record draft preview, Customer Email, Customer Activity, and Raw Context ingestion on the same resolver semantics.
- Update MCP tool descriptions so they only claim abbreviation and typo support when aliases or fuzzy matching are actually available.

Initial cleanup: `customer_record_resolve` is exposed through MCP and REST, CLI subject references use it for opportunity/use-case names, Workspace Agent guidance prefers it for GTM source text, examples/docs point to it as the primary lookup path, and `entity_resolve` MCP copy now describes stored aliases/abbreviations and fuzzy names instead of implying generic abbreviation intelligence.

Email and calendar follow-up: Customer Email and Customer Activity still use deterministic source-specific anchors first (known contact email, reply chains, attendee email, and account domain), then call the shared Subject Graph resolver to add account-scoped opportunity/use-case/contact links when the message or meeting content names them. Ambiguous child records remain reviewable and are recorded in association metadata instead of being guessed.

## Phase 5: Receipts And UX

Status: implemented in structured receipts and association metadata; continue polishing UI copy and next-action placement.

- Add explicit ambiguity receipt fields where needed:
  - `ambiguity_reason`;
  - `candidate_count`;
  - `candidate_records`;
  - `recommended_action`.
- Show user-friendly messages:
  - `Matched Nike, but Pegasus could refer to 2 opportunities.`
  - `Matched the account, but no existing child record fit this context.`
  - `This looks like a new contact under Nike and needs review.`
- Keep Add Context and MCP responses actionable without requiring users to know record IDs.

## Release Bar

Record resolution is v0.9-ready when:

- golden corpus passes in CI; **met for current corpus**
- merged/stale records do not resolve; **met in tests**
- account aliases/domains disambiguate child records; **met in tests**
- same-name child records do not over-link; **met in tests**
- ambiguous references produce reviewable receipts; **met structurally, UI polish ongoing**
- scoped actors cannot resolve hidden records; **met in current parity tests**
- Raw Context, MCP, CLI, Email, Activity, and Workspace Agent flows share the same behavior; **met for current first-class flows**

Current launch posture: record resolution is ready for 0.9 self-hosted/local release confidence, assuming ongoing fixture collection remains part of contributor and release QA. Hosted enterprise GA should add larger live connector and transcript corpora before treating the resolver as production-calibrated at scale.
