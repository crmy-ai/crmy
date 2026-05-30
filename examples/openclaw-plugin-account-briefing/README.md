# OpenClaw Plugin Account Briefing

Use this example when you want OpenClaw to prove CRMy's agent-facing value path in about a minute.

OpenClaw support is plugin-based, not MCP-native in this repo. CRMy ships `@crmy/openclaw-plugin`, which registers one compact `crmy` tool. The agent calls that tool with an `action` string and `params` object instead of calling many separate MCP tools.

## Prerequisites

From the CRMy repo or any machine with access to your CRMy server:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy
npx -y @crmy/cli init --yes
npx -y @crmy/cli agent-smoke
```

`init --yes` seeds the Northstar Labs demo. If you already initialized CRMy without demo data, run:

```bash
npx -y @crmy/cli seed-demo --reset
```

## Install The Plugin

Install the CRMy OpenClaw plugin:

```bash
openclaw plugins install @crmy/openclaw-plugin
```

If your OpenClaw setup uses an explicit tool allow-list, allow the single CRMy plugin tool:

```bash
openclaw config set tools.alsoAllow '["crmy"]'
```

The plugin reads config from:

1. plugin config values `serverUrl` and `apiKey`,
2. `CRMY_SERVER_URL` and `CRMY_API_KEY`,
3. local `.crmy.json`,
4. `~/.crmy/config.json`,
5. `~/.crmy/auth.json`.

For service/container OpenClaw installs, the most predictable setup is:

```bash
export CRMY_SERVER_URL=http://localhost:3000
export CRMY_API_KEY=crmy_...
```

## Prompt

Paste this into OpenClaw:

```text
Use the CRMy plugin to brief the account "Northstar Labs". First call crmy with action "account.search" to find the account, then call action "briefing.get" with context_radius "account_wide", then call action "context.signal_groups" with attention_only true. Tell me the safest next action with the evidence you used.
```

## Expected Tool Calls

OpenClaw should use the single `crmy` tool with these actions:

```js
crmy({ action: "account.search", params: { q: "Northstar Labs", limit: 5 } })
```

```js
crmy({
  action: "briefing.get",
  params: {
    subject_type: "account",
    subject_id: "<resolved-account-id>",
    context_radius: "account_wide",
    token_budget: 3000,
    format: "json"
  }
})
```

```js
crmy({
  action: "context.signal_groups",
  params: {
    attention_only: true,
    limit: 5
  }
})
```

The answer should mention confirmed Memory separately from unconfirmed Signals, explain which Signal needs review, and recommend a safe next action such as reviewing or routing the sensitive Signal to a Handoff.

## Why This Is Different From MCP Examples

Claude Code and Hermes Agent connect to CRMy through MCP. OpenClaw uses the CRMy plugin package in this repo. The plugin intentionally exposes one `crmy` tool to keep OpenClaw's tool context small; detailed action guidance lives in `packages/openclaw-plugin/SKILL.md`.

## Troubleshooting

Run:

```bash
npx -y @crmy/cli agent-smoke --json
```

If this fails, fix CRMy setup before debugging OpenClaw.
