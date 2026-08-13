#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPANION = path.join(ROOT_DIR, "scripts", "codex-companion.mjs");
const PLUGIN_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "plugin.json"), "utf8"));

const TOOLS = [
  {
    name: "codex_setup",
    description: "Check whether the local Codex CLI is installed and authenticated. Optionally enable or disable the stop-time review gate.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string", description: "Workspace directory. Defaults to the current working directory." },
        enable_review_gate: { type: "boolean" },
        disable_review_gate: { type: "boolean" }
      }
    }
  },
  {
    name: "codex_review",
    description: "Run a read-only Codex review of uncommitted changes or a branch vs a base ref.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string" },
        base: { type: "string", description: "Base git ref for branch review." },
        scope: { type: "string", enum: ["auto", "working-tree", "branch"] },
        model: { type: "string" },
        background: { type: "boolean" }
      }
    }
  },
  {
    name: "codex_adversarial_review",
    description: "Run a steerable Codex review that challenges design choices. Accepts optional focus text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string" },
        base: { type: "string" },
        scope: { type: "string", enum: ["auto", "working-tree", "branch"] },
        model: { type: "string" },
        background: { type: "boolean" },
        focus: { type: "string", description: "Optional extra review focus." }
      }
    }
  },
  {
    name: "codex_rescue",
    description: "Delegate an investigation or implementation task to the local Codex CLI.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        cwd: { type: "string" },
        prompt: { type: "string" },
        write: { type: "boolean", description: "Allow workspace writes. Defaults to true for rescue." },
        resume: { type: "boolean" },
        fresh: { type: "boolean" },
        model: { type: "string" },
        effort: { type: "string", enum: ["none", "minimal", "low", "medium", "high", "xhigh"] },
        background: { type: "boolean" }
      }
    }
  },
  {
    name: "codex_transfer",
    description: "Transfer the current Grok session (or an explicit source) into a resumable Codex thread.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string" },
        source: { type: "string", description: "Grok session dir, chat_history.jsonl, or Claude JSONL." }
      }
    }
  },
  {
    name: "codex_status",
    description: "List Codex jobs for this repository, or inspect one job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string" },
        job_id: { type: "string" },
        all: { type: "boolean" },
        wait: { type: "boolean" }
      }
    }
  },
  {
    name: "codex_result",
    description: "Show the stored final output for a finished Codex job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string" },
        job_id: { type: "string" }
      }
    }
  },
  {
    name: "codex_cancel",
    description: "Cancel an active background Codex job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string" },
        job_id: { type: "string" }
      }
    }
  },
  {
    name: "codex_task_resume_candidate",
    description: "Check whether this Grok session has a resumable Codex rescue thread.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string" }
      }
    }
  }
];

function buildCompanionArgs(name, args = {}) {
  const cwd = args.cwd ? ["--cwd", args.cwd] : [];
  switch (name) {
    case "codex_setup": {
      const extra = [];
      if (args.enable_review_gate) extra.push("--enable-review-gate");
      if (args.disable_review_gate) extra.push("--disable-review-gate");
      return ["setup", "--json", ...cwd, ...extra];
    }
    case "codex_review": {
      const extra = [];
      if (args.base) extra.push("--base", args.base);
      if (args.scope) extra.push("--scope", args.scope);
      if (args.model) extra.push("--model", args.model);
      if (args.background) extra.push("--background");
      return ["review", "--json", ...cwd, ...extra];
    }
    case "codex_adversarial_review": {
      const extra = [];
      if (args.base) extra.push("--base", args.base);
      if (args.scope) extra.push("--scope", args.scope);
      if (args.model) extra.push("--model", args.model);
      if (args.background) extra.push("--background");
      if (args.focus) extra.push(args.focus);
      return ["adversarial-review", "--json", ...cwd, ...extra];
    }
    case "codex_rescue": {
      const extra = [];
      if (args.write !== false) extra.push("--write");
      if (args.resume) extra.push("--resume-last");
      if (args.fresh) extra.push("--fresh");
      if (args.model) extra.push("--model", args.model);
      if (args.effort) extra.push("--effort", args.effort);
      if (args.background) extra.push("--background");
      extra.push(args.prompt);
      return ["task", "--json", ...cwd, ...extra];
    }
    case "codex_transfer": {
      const extra = [];
      if (args.source) extra.push("--source", args.source);
      return ["transfer", "--json", ...cwd, ...extra];
    }
    case "codex_status": {
      const extra = [];
      if (args.all) extra.push("--all");
      if (args.wait) extra.push("--wait");
      if (args.job_id) extra.push(args.job_id);
      return ["status", "--json", ...cwd, ...extra];
    }
    case "codex_result":
      return ["result", "--json", ...cwd, ...(args.job_id ? [args.job_id] : [])];
    case "codex_cancel":
      return ["cancel", "--json", ...cwd, ...(args.job_id ? [args.job_id] : [])];
    case "codex_task_resume_candidate":
      return ["task-resume-candidate", "--json", ...cwd];
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function runCompanion(argv, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [COMPANION, ...argv], {
      cwd: cwd || process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout: "", stderr: error.message });
    });
  });
}

function textResult(text, isError = false) {
  return {
    content: [{ type: "text", text }],
    isError
  };
}

async function callTool(name, args = {}) {
  const argv = buildCompanionArgs(name, args);
  const result = await runCompanion(argv, args.cwd);
  const body = result.stdout.trim() || result.stderr.trim() || `Companion exited with code ${result.code}.`;
  return textResult(body, result.code !== 0);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    ok(id, {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "grok-codex-plugin",
        version: PLUGIN_MANIFEST.version ?? "0.0.0"
      }
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return;
  }
  if (method === "ping") {
    ok(id, {});
    return;
  }
  if (method === "tools/list") {
    ok(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (!TOOLS.some((tool) => tool.name === name)) {
      fail(id, -32601, `Unknown tool: ${name}`);
      return;
    }
    try {
      ok(id, await callTool(name, args));
    } catch (error) {
      ok(id, textResult(error instanceof Error ? error.message : String(error), true));
    }
    return;
  }
  if (id !== undefined) {
    fail(id, -32601, `Unknown method: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method) {
    handleRequest(message).catch((error) => {
      if (message.id !== undefined) {
        fail(message.id, -32603, error instanceof Error ? error.message : String(error));
      }
    });
  }
});
