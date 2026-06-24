# CRMy Examples

Examples are copy-pasteable harness setups that prove a narrow CRMy path quickly.

Recipes in `docs/recipes/` explain broader agent workflows. Examples are smaller: connect one agent harness, run one prompt, and verify that CRMy can retrieve operational customer context.

## Before Debugging A Harness

Run these checks first:

```bash
npx -y @crmy/cli quickstart
npx -y @crmy/cli tools describe briefing_get
npx -y @crmy/cli tools describe context_signal_group_list
```

`quickstart` proves the seeded demo data and the core MCP path end to end, connector-free (it wraps the same checks as `agent-smoke`). `tools describe` shows the current input shape for a tool, which is useful when an agent harness is choosing the wrong arguments.

## Available Examples

- [Claude Code account briefing](claude-code-account-briefing/README.md)
- [Claude Desktop account briefing](claude-desktop-account-briefing/README.md)
- [ChatGPT Developer Mode account briefing](chatgpt-developer-mode-account-briefing/README.md)
- [Codex account briefing](codex-account-briefing/README.md)
- [Hermes Agent account briefing](hermes-agent-account-briefing/README.md)
- [OpenClaw plugin account briefing](openclaw-plugin-account-briefing/README.md)

These examples use the seeded Northstar Labs demo and verify:

1. record resolution by name,
2. `briefing_get`,
3. Signals needing attention,
4. a safe next action grounded in evidence.
