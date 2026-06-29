# Model Evaluation and Certification

Use this guide when you want a Workspace Agent model to enable automatic Memory.

CRMy can ingest customer context and create Signals with any configured model, but automatic Memory has a stricter gate. The model must either be a CRMy pre-certified recommendation or pass the live model certification suite for the exact provider, base URL, and model ID configured for the tenant.

Certification is intentionally evidence-based. It cannot be set by a UI toggle, API request, or hand-written config field.

## What Certification Unlocks

Certification allows a passing model to participate in the automatic Memory path when the other trust gates also pass:

- The claim is source-grounded.
- The claim type is eligible for its trust tier.
- Freshness and recency checks pass.
- Confidence is above the configured threshold.
- Tier-2 claims meet the configured Tier-2 policy.

If the model is not certified, CRMy still creates Signals and reviewable Memory candidates. It does not auto-promote them.

## Quick Path

Use the recommended model during init when you want automatic Memory with no extra eval step:

```bash
crmy init --demo
crmy models recommend
```

Recommended entries with `certified` status include CRMy-published run evidence. Unknown, custom, provider-discovered, or newly released models stay review-only until `crmy certify` passes.

For a bring-your-own model, run:

```bash
crmy models list
crmy models probe openai gpt-5.5 --base-url https://api.openai.com/v1
crmy certify --output ./eval-runs
```

Replace the provider, model, and base URL with the exact model configured in CRMy.

## Prerequisites

Before running certification, confirm:

1. `crmy init` has already created a tenant.
2. `DATABASE_URL` points at the CRMy database, or `.crmy.json` contains the database URL.
3. The Workspace Agent is enabled for the tenant.
4. The Workspace Agent model provider, base URL, model ID, and API key are configured.
5. The API key can call the selected model.
6. You are not using real customer content in custom eval cases.

Run a health check first:

```bash
crmy doctor
```

## Step 1: Choose a Candidate Model

List the built-in and locally discovered model catalog:

```bash
crmy models list
```

Show richer metadata when comparing candidates:

```bash
crmy models list --verbose
```

Refresh provider-discovered models when available:

```bash
crmy models refresh --provider openrouter
crmy models refresh --provider ollama
```

Discovery only adds selectable model metadata. It does not certify the model.

For release certification, prioritize:

- The current OpenAI flagship or primary low-latency model your deployment will recommend.
- The current Anthropic Sonnet or Opus model your deployment will recommend.
- One Gemini candidate if you expect Google-first customers.
- One Mistral or OpenRouter-routed candidate if you want a non-OpenAI/non-Anthropic option.

Do not mark a model CRMy-certified from provider documentation alone. Certification requires a passing `live_model` run.

### Current Certification Candidates

As of June 29, 2026, the CRMy-published certified defaults are still useful but should be refreshed before release if credentials and budget allow:

- OpenAI: certify `gpt-5.5` next. OpenAI's model docs list `gpt-5.5` as the flagship model for complex reasoning and coding, with `gpt-5.4-mini` or `gpt-5.4-nano` as lower-latency/cost options. The same docs mention `gpt-5.6` as partner preview with broad availability coming soon, so treat it as a watchlist candidate until it is available in the target account. See the [OpenAI model docs](https://platform.openai.com/docs/models).
- Anthropic: certify `claude-fable-5` first if the account has access, then `claude-opus-4-8` or `claude-sonnet-4-6` depending on whether the recommended default should optimize for maximum capability or speed/cost. See the [Claude model overview](https://docs.anthropic.com/en/docs/about-claude/models/all-models).
- Google Gemini: certify `gemini-3.5-flash` if Google-first customers matter for the release. Google's docs list it as stable and aimed at sustained frontier agentic and coding tasks. See the [Gemini model docs](https://ai.google.dev/gemini-api/docs/models).
- Mistral: certify `mistral-medium-3-5+2` or the current API ID behind Mistral Medium 3.5 if you want an additional non-OpenAI/non-Anthropic path. Mistral lists Medium 3.5 and Small 4 as current featured generalist models. See the [Mistral model overview](https://docs.mistral.ai/models/overview).

Only add one of these to the pre-certified registry after the exact provider, base URL, and model ID passes `crmy certify`.

## Step 2: Probe the Model

Probe verifies that CRMy can resolve the catalog entry and shows whether automatic Memory is currently enabled or review-only.

```bash
crmy models probe openai gpt-5.5 --base-url https://api.openai.com/v1
```

Expected review-only shape for an uncertified model:

```text
Provider: openai
Model: gpt-5.5
Certification: uncertified
Automatic Memory: review_only_until_certified
Next step: Run `crmy certify --output ./eval-runs` after configuring this exact model to enable automatic Memory.
```

If the model is missing from the catalog, you can still configure it as a custom model, but it remains review-only until certification passes.

## Step 3: Configure the Workspace Agent

For non-interactive setup, configure the model before init:

```bash
export CRMY_AGENT_PROVIDER=openai
export CRMY_AGENT_BASE_URL=https://api.openai.com/v1
export CRMY_AGENT_MODEL=gpt-5.5
export CRMY_AGENT_API_KEY=sk-...
crmy init --yes
```

For an existing tenant, use the web UI:

```text
Settings -> Model
```

When the model identity changes, CRMy resets certification for that tenant. If the new model exactly matches a CRMy pre-certified registry entry, CRMy restores the recorded certification evidence. Otherwise, it prompts you to run `crmy certify`.

## Step 4: Run Certification

Run certification against the tenant's configured Workspace Agent model:

```bash
crmy certify --output ./eval-runs
```

For a specific tenant:

```bash
crmy certify --tenant default --output ./eval-runs
```

The command loads the configured model, runs the real `live_model` eval profile with live credentials, and writes certification evidence only if the run passes the gate.

The gate requires:

- Eval profile is `live_model`.
- Eval status is pass.
- No failed, errored, or skipped cases.
- Certification score is at least `0.85`.
- Run ID and score are persisted as evidence.

Passing output looks like:

```text
CERTIFIED openai · gpt-5.5
Run: crmy_eval_... (live_model)
Cases: 12 | passed: 12 | failed: 0 | errored: 0 | skipped: 0
Score: 0.91
Model certified by live_model eval crmy_eval_... with score 0.91. Automatic Memory can run when grounding and trust-tier gates pass.
```

Failed output leaves automatic Memory blocked:

```text
FAILED openai · gpt-5.5
Run: crmy_eval_... (live_model)
Cases: 12 | passed: 10 | failed: 2 | errored: 0 | skipped: 0
Score: 0.78
Certification did not pass the live_model gate. Automatic Memory remains disabled.
```

## Step 5: Keep the Artifacts

Use `--output` for every certification run:

```bash
crmy certify --output ./eval-runs
```

The artifacts are useful for:

- Release notes.
- Audit review.
- Comparing models before changing the recommended defaults.
- Debugging failed extraction cases.

Optional export formats can be added when you need external eval tooling:

```bash
crmy certify --output ./eval-runs --export openai,ragas,langsmith
```

## Step 6: Verify Automatic Memory

After certification passes, run:

```bash
crmy doctor
crmy agent-smoke --with-model
```

Then process grounded demo context and check that eligible Tier-0 or Tier-1 claims can auto-confirm without manual review:

```bash
crmy seed-demo --reset
crmy quickstart
```

Automatic Memory should still be blocked for:

- Ungrounded claims.
- Stale claims.
- Low-confidence claims.
- High-risk or human-only claim types.
- Tier-2 claims that fail corroboration, recency, grounding, or threshold checks.

Certification proves model capability. It does not bypass source grounding or governance.

## Troubleshooting

### Certification says no tenant exists

Run init first, or pass the tenant explicitly:

```bash
crmy init
crmy certify --tenant default
```

### Certification cannot find a database URL

Set `DATABASE_URL` or pass a config file:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
crmy certify
```

```bash
crmy certify --config ./.crmy.json
```

### The eval is skipped

`crmy certify` runs with live-model credentials and fails closed. A skipped run does not certify the model. Confirm that the Workspace Agent has a usable API key and that the provider can call the exact model ID.

### The model passes normal smoke tests but fails certification

Smoke tests prove basic runtime wiring. Certification scores extraction quality, evidence alignment, persisted Signals, proposed records, attempt telemetry, and Source receipt status. Review the output artifacts and fix either the model choice, prompt behavior, or failing eval case.

### The model was certified, then became review-only again

Certification is tied to exact model identity:

```text
provider + base URL + model ID
```

Changing any part resets the tenant to review-only unless the new identity exactly matches a CRMy pre-certified registry entry.

## Publishing a New CRMy-Certified Default

Maintainers should use this process before adding or updating a pre-certified recommended model:

1. Refresh the model catalog.
2. Probe the candidate.
3. Configure a clean tenant to use the exact provider, base URL, model ID, and API key.
4. Run `crmy certify --output ./eval-runs`.
5. Confirm score is at least `0.85`, no cases failed, no cases errored, and no cases skipped.
6. Record the run ID, score, certification timestamp, provider, base URL, and exact model ID.
7. Add the entry to the CRMy pre-certified registry only with that recorded evidence.
8. Re-run `crmy models recommend`, `crmy doctor`, `crmy agent-smoke --with-model`, and the test suite.

Never copy certification from a neighboring model, provider route, or alias. If `openai/gpt-5.5` passes through OpenRouter, that does not certify direct OpenAI `gpt-5.5`, and the reverse is also true.
