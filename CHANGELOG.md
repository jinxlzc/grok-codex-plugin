# Changelog

## 1.1.0

- Track current Grok Build 1.0.x and Codex CLI 0.170.
- Map the `spark` shortcut to `gpt-6-luna`. `gpt-5.3-codex-spark` retired on 2026-09-14. Explicit model ids are still passed through.
- Accept reasoning efforts `max` and `ultra`, and map `light` to `low`. Keep `none` and `minimal` for older models.
- Find Grok sessions when the cwd encoding contains `!'()*`, and when a long cwd is stored as a slug directory plus a `.cwd` file.
- Read current `chat_history.jsonl` items (`type: user|assistant`) and legacy `{role, content}` records.
- Skip the stop-time review gate on session-close Stop events (`shutdown`, `channel_closed`). Keep reviewing `end_turn`, including when `reason` is omitted by an older host.
- Document `GROK_PLUGIN_ROOT`, `GROK_PLUGIN_DATA`, and the `CLAUDE_PLUGIN_*` aliases, plus install, config, and troubleshooting.
- Publish `glama.json` with maintainer `jinxlzc`.
- Expand MCP tool titles, descriptions, input schemas, and annotations.
- Run `npm test` and `grok plugin validate` in GitHub Actions. The Codex app-server handshake runs without a login when `codex` is on `PATH`.

## 1.0.0

- Initial Grok Build port of the Codex companion runtime.
- Delegate reviews, rescues, and transfers to the local Codex CLI.
- Add a Grok session importer and a bundled MCP server.
