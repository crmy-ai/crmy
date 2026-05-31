# Codex Account Briefing

Use this example when you want Codex to prove CRMy's agent-facing value path in about a minute.

Codex can connect to CRMy through a local stdio MCP server or a streamable HTTP MCP endpoint. Local stdio is usually fastest for development; HTTP is useful when Codex runs somewhere separate from the CRMy server.

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

## Connect Codex With The CLI

```bash
codex mcp add crmy -- npx -y @crmy/cli mcp
```

If Codex runs outside the shell where `.crmy.json` is available, pass the required environment values:

```bash
codex mcp add crmy \
  --env DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy \
  --env CRMY_API_KEY=crmy_... \
  -- npx -y @crmy/cli mcp
```

In the Codex TUI, run `/mcp` to confirm the CRMy server is active.

## Or Configure `config.toml`

Add this to `~/.codex/config.toml` or a trusted project-scoped `.codex/config.toml`:

```toml
[mcp_servers.crmy]
command = "npx"
args = ["-y", "@crmy/cli", "mcp"]

[mcp_servers.crmy.env]
DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/crmy"
CRMY_API_KEY = "crmy_..."
```

For a remote CRMy server, use the HTTP MCP endpoint:

```toml
[mcp_servers.crmy]
url = "https://<your-crmy-host>/mcp"
bearer_token_env_var = "CRMY_API_KEY"
```

## Prompt

Paste this into Codex:

```text
Use the CRMy MCP tools to resolve the account "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.
```

## Expected Path

Codex should call:

1. `customer_record_resolve` for `Northstar Labs`.
2. `briefing_get` for the resolved account.
3. `context_signal_group_list` with `attention_only: true`.

The answer should mention confirmed Memory separately from unconfirmed Signals, explain which Signal needs review, and recommend a safe next action such as reviewing or routing the sensitive Signal to a Handoff.

## Troubleshooting

Run:

```bash
npx -y @crmy/cli agent-smoke --json
```

If this fails, fix local CRMy setup before debugging Codex. If it passes but Codex does not show CRMy tools, run `/mcp`, inspect `~/.codex/config.toml`, and restart the Codex session after config changes.
