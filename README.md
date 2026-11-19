# Grok Codex Plugin

Grok Build 指挥本地 [Codex CLI](https://github.com/openai/openai-codex) 干活的开源插件。

它把 OpenAI 官方 [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) 的 companion 运行时、任务队列、review / rescue / transfer / review-gate 逻辑移植到 Grok：走你本机已经登录的 `codex`，不是另一套 API。

A Grok Build plugin that delegates reviews and coding tasks to the **local Codex CLI**, following the same companion-runtime logic as OpenAI's Claude Code plugin.

## What you get

- `/codex:review` for a normal read-only Codex review
- `/codex:adversarial-review` for a steerable challenge review
- `/codex:rescue`, `/codex:transfer`, `/codex:status`, `/codex:result`, and `/codex:cancel` to delegate work, hand off sessions, and manage background jobs
- MCP tools (`codex_setup`, `codex_review`, `codex_rescue`, …) so Grok can command Codex without shelling out
- A `codex:codex-rescue` subagent that only forwards to the companion

## Requirements

- [Grok Build](https://github.com/xai-org/grok-build) (`grok`)
- Node.js 18.18 or later
- Local Codex CLI 0.170 or a current release, installed and logged in (`npm install -g @openai/codex` then `codex login`)
- ChatGPT subscription (incl. Free) or an OpenAI API key. Usage counts against your Codex limits. API-key sessions can still name older models; ChatGPT sign-in uses the models Codex currently advertises.

## Install

Add the marketplace in Grok Build, then install and trust the plugin:

```bash
grok plugin marketplace add jinxlzc/grok-codex-plugin
grok plugin install codex --trust
```

Or install straight from the repo:

```bash
grok plugin install jinxlzc/grok-codex-plugin --trust
```

Reload plugins (`r` in the Plugins tab, or start a new session), then run:

```text
/codex:setup
```

`/codex:setup` will tell you whether Codex is ready. If Codex is missing and npm is available, it can offer to install Codex for you.

If Codex is installed but not logged in yet, run:

```bash
codex login
```

After install you should see the slash commands below, the `codex:codex-rescue` subagent, and (when the plugin is trusted) the `codex` MCP server.

## Usage

### `/codex:setup`

Checks whether Codex is installed and authenticated.

```text
/codex:setup
/codex:setup --enable-review-gate
/codex:setup --disable-review-gate
```

When the review gate is enabled, a `Stop` hook runs a targeted Codex review of Grok's last turn. If that review finds issues, the stop is blocked so Grok can address them first.

### `/codex:review`

Runs a normal Codex review on your current work. It gives you the same quality of code review as running `/review` inside Codex directly.

```text
/codex:review
/codex:review --base main
/codex:review --background
```

This command is read-only and will not perform any changes.

### `/codex:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design. It uses the same review target selection as `/codex:review`, including `--base <ref>` for branch review.

```text
/codex:adversarial-review
/codex:adversarial-review --base main challenge whether this was the right caching and retry design
```

### `/codex:rescue`

Hands a task to Codex through the `codex:codex-rescue` subagent.

Use it when you want Codex to:

- investigate a bug
- try a fix
- continue a previous Codex task
- take a faster or cheaper pass with a smaller model

```text
/codex:rescue investigate why the tests started failing
/codex:rescue --resume apply the top fix from the last run
/codex:rescue --model gpt-6-luna --effort medium investigate the flaky integration test
/codex:rescue --model spark fix the issue quickly
/codex:rescue --background investigate the regression
```

You can also just ask:

```text
Ask Codex to redesign the database connection to be more resilient.
让 Codex 把失败的单测修掉
```

Notes:

- if you do not pass `--model` or `--effort`, Codex chooses its own defaults. On a current CLI with no `model` in `config.toml`, that default is `gpt-6.2-sol`.
- if you say `spark`, the plugin maps that shortcut to `gpt-6-luna`, the current fast model. An explicit id such as `gpt-6.2-sol` or an older API-key id is passed through unchanged.
- `gpt-5.3-codex-spark` retired from Codex on 2026-09-14. Do not put that id in new config. `gpt-5.4` and `gpt-5.4-mini` left ChatGPT-signed-in Codex on 2026-08-31; their documented replacements are `gpt-6-sol` and `gpt-6-luna`.
- accepted `--effort` values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. `light` maps to `low`. Current bundled models advertise `low` through `ultra`; `gpt-6-luna` has no `ultra`. `none` and `minimal` remain so older models and API-key sessions keep working.
- follow-up rescue requests can continue the latest Codex task in the repo

### `/codex:transfer`

Creates a persistent Codex thread from the current Grok session and prints a `codex resume <session-id>` command.

```text
/codex:transfer
/codex:transfer --source ~/.grok/sessions/%2Fpath%2Fto%2Frepo/<session-id>
```

Claude Code JSONL under `~/.claude/projects` is still accepted and uses Codex's native importer.

### `/codex:status`

Shows running and recent Codex jobs for the current repository.

```text
/codex:status
/codex:status task-abc123
```

### `/codex:result`

Shows the final stored Codex output for a finished job.

### `/codex:cancel`

Cancels an active background Codex job.

## How it works

```
Grok session
    │  slash command / skill / MCP / rescue subagent
    ▼
codex-companion.mjs
    │  Codex app-server JSON-RPC (same local binary + auth + config)
    ▼
local `codex` CLI
```

The plugin is not a separate Codex runtime. It uses:

- the same `codex` binary you already have
- the same local authentication
- the same `~/.codex/config.toml` and project `.codex/config.toml`

Background jobs are tracked per workspace under `GROK_PLUGIN_DATA` (falling back to `CLAUDE_PLUGIN_DATA`).

## Configuration

The plugin does not keep its own model or API key. Codex reads:

- `~/.codex/config.toml` for the user
- `.codex/config.toml` in the workspace
- the same login created by `codex login` or `CODEX_API_KEY` for API-key auth

A typical user config only needs a model when you do not want Codex's default:

```toml
model = "gpt-6.2-sol"
model_reasoning_effort = "medium"
```

Leave `model` unset unless you want to pin one. `spark` is a plugin shortcut, not a Codex model id.

## Environment variables

Grok sets these when the plugin is installed and trusted. Claude-compatible aliases still work.

| Variable | Who sets it | Meaning |
| --- | --- | --- |
| `GROK_PLUGIN_ROOT` | Grok, for hooks and `${GROK_PLUGIN_ROOT}` in `.mcp.json` | Absolute path of the installed plugin directory. |
| `CLAUDE_PLUGIN_ROOT` | Grok, same value | Alias so older command text keeps working. |
| `GROK_PLUGIN_DATA` | Grok | Writable directory for this plugin's state, job logs, and session sidecars. |
| `CLAUDE_PLUGIN_DATA` | Grok, same value | Alias used when `GROK_PLUGIN_DATA` is unset. |
| `GROK_HOME` | You, optional | Overrides `~/.grok`. Session transfer looks under `$GROK_HOME/sessions`. |
| `GROK_SESSION_ID` | Grok, on the session | Session id used by `/codex:transfer` when you do not pass `--source`. |
| `CODEX_HOME` | You, optional | Codex config and auth directory. Defaults to `~/.codex`. |

Job state lives in `$GROK_PLUGIN_DATA/state/<workspace-slug>-<hash>/`. If neither plugin-data variable is set, the companion stores state under the system temp directory. Install through Grok so the variables exist.

Long workspace paths: Grok stores the session group as a URL-encoded cwd, and switches to a short `{slug}-{hash}` directory plus a `.cwd` file when that encoding exceeds 255 bytes. Transfer follows both layouts.

## Troubleshooting

`/codex:setup` is the first check. It reports whether `codex` is on `PATH` and whether app-server auth sees a ChatGPT account or an API key.

| Symptom | What to do |
| --- | --- |
| `codex` is missing | `npm install -g @openai/codex`, then open a new shell so `PATH` updates. |
| Setup says not authenticated | `codex login`. API-key users can export `CODEX_API_KEY` before starting Grok. |
| Slash commands are missing | Press `r` in the Plugins tab, or start a new Grok session. |
| MCP tools are missing | The plugin must be trusted. `grok plugin install jinxlzc/grok-codex-plugin --trust` |
| `spark` or `gpt-5.3-codex-spark` fails at turn time | Use `spark` (mapped to `gpt-6-luna`) or an id from `codex` `/model`. The old spark id is retired for ChatGPT sign-in. |
| Review gate never blocks | Current Grok fails open when a Stop hook times out or crashes. The hook timeout in `hooks/hooks.json` is 900 seconds. The gate also skips session-close Stop events (`reason` of `shutdown` or `channel_closed`) and runs only for `end_turn`. |
| Transfer cannot find the session | Pass `--source` to the session directory or `chat_history.jsonl`. Confirm `GROK_HOME` if you moved Grok's data directory. |

## Development

```bash
npm test
npm run check-version
grok plugin validate plugins/codex
```

The companion talks to Codex through the app-server protocol. `npm test` uses a fake Codex fixture, so it does not need a login. `tests/codex-protocol.test.mjs` is skipped unless `codex` is on `PATH`. Set `REQUIRE_CODEX=1` in CI so a missing binary fails the job instead of skipping.

What that test covers without a login: `codex --version`, `codex app-server` `initialize`, `account/read`, `model/list`, and an ephemeral `thread/start` using the same `approvalPolicy` and `sandbox` the companion sends.

## Manual end-to-end check

These steps need a logged-in Grok Build and a logged-in Codex. They are not run in CI.

```bash
npm install -g @openai/codex@latest
codex login
curl -fsSL https://x.ai/cli/install.sh | bash
grok plugin marketplace add jinxlzc/grok-codex-plugin
grok plugin install codex --trust
```

In a git checkout, start `grok` and run:

```text
/codex:setup
/codex:review --wait
/codex:rescue --model spark --effort low what does this repository do? do not edit files
/codex:status
/codex:transfer
```

Confirm setup reports `ready: true`, the review returns text without changing files, the spark rescue uses `gpt-6-luna`, and transfer prints `codex resume <session-id>`. Then `codex resume <session-id>` in a terminal should reopen that thread.

## Typical flows

Review before shipping:

```text
/codex:review
```

Hand a problem to Codex:

```text
/codex:rescue investigate why the build is failing in CI
```

Start something long-running:

```text
/codex:adversarial-review --background
/codex:rescue --background investigate the flaky test
```

Then check in with `/codex:status` and `/codex:result`.

## License

Apache-2.0.

Runtime design and a large part of the companion are derived from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Apache-2.0, Copyright 2026 OpenAI). See `NOTICE`.
