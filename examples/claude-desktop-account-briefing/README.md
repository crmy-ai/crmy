# Claude Desktop Account Briefing

Use this example when you want Claude Desktop to prove CRMy's agent-facing value path in about a minute.

This is intentionally smaller than a recipe. It only verifies that Claude Desktop can resolve a customer record, retrieve a briefing, inspect Signals, and recommend a safe next action from CRMy evidence.

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

## Configure Claude Desktop

Add CRMy to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "crmy": {
      "command": "npx",
      "args": ["-y", "@crmy/cli", "mcp"]
    }
  }
}
```

If Claude Desktop cannot see the `.crmy.json` file written by `crmy init`, pass explicit environment variables:

```json
{
  "mcpServers": {
    "crmy": {
      "command": "npx",
      "args": ["-y", "@crmy/cli", "mcp"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/crmy",
        "CRMY_API_KEY": "crmy_..."
      }
    }
  }
}
```

Restart Claude Desktop after editing the config.

## Prompt

Paste this into Claude Desktop:

```text
Use the CRMy MCP tools to resolve the account "Northstar Labs", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.
```

## Expected Path

Claude Desktop should call:

1. `customer_record_resolve` for `Northstar Labs`.
2. `briefing_get` for the resolved account.
3. `context_signal_group_list` with `attention_only: true`.

The answer should mention confirmed Memory separately from unconfirmed Signals, explain which Signal needs review, and recommend a safe next action such as reviewing or routing the sensitive Signal to a Handoff.

## Troubleshooting

Run:

```bash
npx -y @crmy/cli agent-smoke --json
npx -y @crmy/cli tools describe briefing_get
```

If this fails, fix local CRMy setup before debugging Claude Desktop.
