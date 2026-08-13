# grok-codex-plugin

Grok Build plugin that commands the local Codex CLI.

- Runtime lives in `plugins/codex/scripts/codex-companion.mjs`.
- Grok session transfer lives in `plugins/codex/scripts/lib/grok-session-transfer.mjs`.
- MCP is a thin stdio wrapper: `plugins/codex/scripts/mcp-server.mjs`.
- Do not add a second Codex invocation path.
- Tests: `npm test`.
