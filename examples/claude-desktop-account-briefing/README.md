# Claude Desktop Account Briefing

Use this example when you want Claude Desktop to prove CRMy's agent-facing value path in about a minute.

This is intentionally smaller than a recipe. It verifies that Claude Desktop can resolve a customer record, retrieve a briefing, check Action Context, inspect Signals, check lineage outcomes, and recommend a safe next action from CRMy evidence.

## Prerequisites

From the CRMy repo or any machine with access to your CRMy database:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
export CRMY_ADMIN_EMAIL=admin@example.com
export CRMY_ADMIN_PASSWORD=crmy-demo-123
npx -y @crmy/cli init --yes --demo
npx -y @crmy/cli quickstart --no-seed
```

`init --yes --demo` seeds the Northstar Labs demo. If you already initialized CRMy without demo data, run:

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
Use the CRMy MCP tools to resolve the account "Northstar Labs", get a briefing, get Action Context for customer outreach, list Signals that need attention, check lineage outcomes, and tell me the safest next action with the evidence you used.
```

## Expected Path

Claude Desktop should call:

1. `customer_record_resolve` for `Northstar Labs`.
2. `briefing_get` for the resolved account.
3. `action_context_get` with `proposed_action.action_type: "customer_outreach"`.
4. `context_signal_group_list` with `attention_only: true`.
5. `context_lineage_get` for the resolved account.

The answer should mention confirmed Memory separately from unconfirmed Signals, explain which Signal needs review, respect Action Context boundaries, and recommend a safe next action such as reviewing or routing the sensitive Signal to a Handoff.

## Troubleshooting

Run:

```bash
npx -y @crmy/cli quickstart --no-seed --json
npx -y @crmy/cli agent-smoke --json
npx -y @crmy/cli tools describe briefing_get
```

If this fails, fix local CRMy setup before debugging Claude Desktop.
