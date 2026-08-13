---
description: Transfer the current Grok session into a resumable Codex thread
argument-hint: "[--source <grok-session-dir-or-jsonl>]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${GROK_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" transfer "$ARGUMENTS"`

Present the command output to the user exactly as returned. Preserve the Codex session ID and the `codex resume <session-id>` command.
