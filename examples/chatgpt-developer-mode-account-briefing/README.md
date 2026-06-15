# ChatGPT Developer Mode Account Briefing

Use this example when you want ChatGPT to prove CRMy's agent-facing value path through Developer Mode.

ChatGPT Developer Mode connects to remote MCP servers over SSE or streaming HTTP. Use this path when CRMy is running at a reachable HTTPS URL. For local-only testing, use the Claude Code, Claude Desktop, or Codex examples instead.

## Prerequisites

From the CRMy repo or any machine with access to your CRMy database:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
npx -y @crmy/cli init --yes
npx -y @crmy/cli agent-smoke
```

`init --yes` seeds the Northstar Labs demo. If you already initialized CRMy without demo data, run:

```bash
npx -y @crmy/cli seed-demo --reset
```

## Expose CRMy's MCP Server

ChatGPT cannot reach `localhost` on your machine. Run CRMy somewhere ChatGPT can reach it, or expose your local server through a secure HTTPS tunnel for development.

Your MCP endpoint should be:

```text
https://<your-crmy-host>/mcp
```

If your CRMy server requires an API key, configure the remote MCP app with the corresponding authentication option and use:

```text
Authorization: Bearer crmy_...
```

## Create The ChatGPT App

In ChatGPT:

1. Open Settings -> Apps.
2. Enable Developer Mode in Advanced settings.
3. Create an app from your CRMy remote MCP server.
4. Use CRMy from the composer's Developer Mode tool.

Keep write tools confirmation enabled while testing. CRMy tools are scoped to the current API key/user, but Developer Mode exposes read and write tools, so review tool calls before approving writes.

## Prompt

Paste this into ChatGPT after selecting the CRMy Developer Mode app:

```text
Use only the CRMy app tools. Resolve the account "Northstar Labs", get a briefing, get Action Context for customer outreach, list Signals that need attention, check lineage outcomes, and tell me the safest next action with the evidence you used. Do not use web browsing or built-in search.
```

If ChatGPT has trouble selecting tools, be explicit:

```text
First call CRMy customer_record_resolve for "Northstar Labs". Then call CRMy briefing_get for the resolved account. Then call CRMy action_context_get with proposed_action.action_type "customer_outreach". Then call CRMy context_signal_group_list with attention_only true and CRMy context_lineage_get for the account. Summarize confirmed Memory separately from unconfirmed Signals and respect Action Context boundaries.
```

## Expected Path

ChatGPT should call:

1. `customer_record_resolve` for `Northstar Labs`.
2. `briefing_get` for the resolved account.
3. `action_context_get` with `proposed_action.action_type: "customer_outreach"`.
4. `context_signal_group_list` with `attention_only: true`.
5. `context_lineage_get` for the resolved account.

The answer should mention confirmed Memory separately from unconfirmed Signals, explain which Signal needs review, respect Action Context boundaries, and recommend a safe next action such as reviewing or routing the sensitive Signal to a Handoff.

## Troubleshooting

Run:

```bash
npx -y @crmy/cli agent-smoke --json
npx -y @crmy/cli tools describe briefing_get
```

If this fails, fix local CRMy setup before debugging ChatGPT. If it passes but ChatGPT cannot connect, check that the MCP URL is public HTTPS, the auth mode matches your CRMy deployment, and the app tools were refreshed in ChatGPT settings.
