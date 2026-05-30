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
Use only the CRMy app tools. Resolve the account "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used. Do not use web browsing or built-in search.
```

If ChatGPT has trouble selecting tools, be explicit:

```text
First call CRMy entity_resolve for "Northstar Labs". Then call CRMy briefing_get for the resolved account. Then call CRMy context_signal_group_list with attention_only true. Summarize confirmed Memory separately from unconfirmed Signals.
```

## Expected Path

ChatGPT should call:

1. `entity_resolve` for `Northstar Labs`.
2. `briefing_get` for the resolved account.
3. `context_signal_group_list` with `attention_only: true`.

The answer should mention confirmed Memory separately from unconfirmed Signals, explain which Signal needs review, and recommend a safe next action such as reviewing or routing the sensitive Signal to a Handoff.

## Troubleshooting

Run:

```bash
npx -y @crmy/cli agent-smoke --json
```

If this fails, fix local CRMy setup before debugging ChatGPT. If it passes but ChatGPT cannot connect, check that the MCP URL is public HTTPS, the auth mode matches your CRMy deployment, and the app tools were refreshed in ChatGPT settings.
