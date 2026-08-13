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
- Local Codex CLI, installed and logged in (`npm install -g @openai/codex` then `codex login`)
- ChatGPT subscription (incl. Free) or an OpenAI API key. Usage counts against your Codex limits.

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
/codex:rescue --model gpt-5.4-mini --effort medium investigate the flaky integration test
/codex:rescue --model spark fix the issue quickly
/codex:rescue --background investigate the regression
```

You can also just ask:

```text
Ask Codex to redesign the database connection to be more resilient.
让 Codex 把失败的单测修掉
```

Notes:

- if you do not pass `--model` or `--effort`, Codex chooses its own defaults.
- if you say `spark`, the plugin maps that to `gpt-5.3-codex-spark`
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

## Development

```bash
npm test
```

The companion talks to Codex through the app-server protocol. Tests use a fake Codex fixture, so you do not need a live login to run the suite.

## License

Apache-2.0.

Runtime design and a large part of the companion are derived from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Apache-2.0, Copyright 2026 OpenAI). See `NOTICE`.
