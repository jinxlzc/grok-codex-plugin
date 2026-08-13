---
name: codex-delegate
description: >
  Delegate coding, review, diagnosis, or follow-up work to the local Codex CLI
  from Grok Build. Use when the user asks to command Codex, hand work to Codex,
  run /codex, /codex:rescue, /codex:review, or says 让 Codex 干、叫 Codex 审查、
  指挥 Codex.
user-invocable: true
---

# Delegate to local Codex

This skill is the Grok-facing entry point for the local Codex companion.

Prefer the plugin's first-class tools when they are available:

- MCP tools from the `codex` server (`codex_setup`, `codex_review`, `codex_adversarial_review`, `codex_rescue`, `codex_transfer`, `codex_status`, `codex_result`, `codex_cancel`)
- Slash commands `/codex:setup`, `/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:transfer`, `/codex:status`, `/codex:result`, `/codex:cancel`

If MCP is not attached, invoke the companion directly:

```bash
node "${GROK_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" <subcommand>
```

Routing:

- Setup / login / review-gate → `setup`
- Ordinary code review of the working tree or a branch → `review` (read-only)
- Challenge the design / approach → `adversarial-review`
- Investigate, fix, implement, or continue previous Codex work → `rescue` via `codex:codex-rescue` or `task --write`
- Move this Grok conversation into Codex → `transfer`
- Check background work → `status` / `result` / `cancel`

Rules:

- Do not reimplement the task yourself after a successful Codex handoff.
- Return companion / MCP output verbatim.
- After a review, do not apply fixes unless the user asks.
- If Codex is missing or logged out, stop and tell the user to run `/codex:setup`.
