# Hermes Agent Account Briefing

Use this example when you want Hermes Agent to prove CRMy's agent-facing value path in about a minute.

Hermes registers MCP tools with a server prefix. If the server is named `crmy`, CRMy's `briefing_get` tool appears as `mcp_crmy_briefing_get`.

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

## Configure Hermes

Add CRMy to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  crmy:
    command: "npx"
    args: ["-y", "@crmy/cli", "mcp"]
    timeout: 120
    connect_timeout: 60
    tools:
      include:
        - entity_resolve
        - briefing_get
        - context_ingest_auto
        - context_signal_group_list
        - context_signal_group_get
        - context_signal_group_promote
        - context_signal_handoff
        - email_draft_preview
        - email_draft_save
        - record_draft_preview
```

If Hermes runs in a service or container that cannot see your local `.crmy.json`, add environment variables:

```yaml
    env:
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/crmy"
      CRMY_API_KEY: "crmy_..."
```

Then restart Hermes or run:

```text
/reload-mcp
```

## Prompt

Paste this into Hermes Agent:

```text
Use mcp_crmy_entity_resolve to resolve "Northstar Labs", call mcp_crmy_briefing_get, then call mcp_crmy_context_signal_group_list for Signals needing attention. Tell me the safest next action with the evidence you used.
```

## Expected Path

Hermes should call:

1. `mcp_crmy_entity_resolve` for `Northstar Labs`.
2. `mcp_crmy_briefing_get` for the resolved account.
3. `mcp_crmy_context_signal_group_list` with `attention_only: true`.

The answer should mention confirmed Memory separately from unconfirmed Signals, explain which Signal needs review, and recommend a safe next action such as reviewing or routing the sensitive Signal to a Handoff.

## Troubleshooting

Run:

```bash
npx -y @crmy/cli agent-smoke --json
```

If this fails, fix local CRMy setup before debugging Hermes.
