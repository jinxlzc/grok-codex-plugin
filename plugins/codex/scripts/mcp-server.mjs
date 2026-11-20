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

const CWD_SCHEMA = {
  type: "string",
  description: "Absolute workspace directory. Defaults to the MCP server process cwd, which Grok sets to the session workspace."
};
const REVIEW_SCOPE_SCHEMA = {
  type: "string",
  enum: ["auto", "working-tree", "branch"],
  description: "auto picks a branch review when base is set, otherwise the working tree. working-tree reviews uncommitted changes. branch reviews base...HEAD."
};
const MODEL_SCHEMA = {
  type: "string",
  description: "Codex model id passed through to the local CLI. Omit it to use the user's Codex default (currently gpt-6.2-sol when unset). The alias spark maps to gpt-6-luna. Explicit ids, including older API-key models, are not rewritten."
};
const EFFORT_SCHEMA = {
  type: "string",
  enum: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
  description: "Reasoning effort for this Codex turn. Current bundled models advertise low, medium, high, xhigh, max, and ultra; gpt-6-luna has no ultra. none and minimal remain for older models. The CLI alias light is accepted and mapped to low."
};

const TOOLS = [
  {
    name: "codex_setup",
    title: "Check Codex setup",
    description: "Check whether the local Codex CLI is installed and logged in, and optionally toggle the stop-time review gate. Use this before codex_review, codex_rescue, or codex_transfer when setup is unknown. Do not use it to run a review or edit files. Enabling the gate writes plugin state and makes the Stop hook spend Codex usage on later turns; disabling it only clears that flag. Returns JSON with ready, auth detail, and reviewGateEnabled.",
    annotations: {
      title: "Check Codex setup",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: CWD_SCHEMA,
        enable_review_gate: {
          type: "boolean",
          description: "Persist the stop-time review gate on for this workspace. Ignored when omitted. Do not set this together with disable_review_gate."
        },
        disable_review_gate: {
          type: "boolean",
          description: "Persist the stop-time review gate off for this workspace. Ignored when omitted."
        }
      }
    }
  },
  {
    name: "codex_review",
    title: "Read-only Codex review",
    description: "Run a read-only Codex review of the working tree or of a branch against a base ref. Use it for a normal code review with no extra challenge text. Use codex_adversarial_review instead when the review should question the design, and codex_rescue when Codex should investigate or edit. This tool does not modify the workspace. It consumes Codex usage and returns Codex's review text, or a job id when background is true.",
    annotations: {
      title: "Read-only Codex review",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: CWD_SCHEMA,
        base: {
          type: "string",
          description: "Git ref to diff against, such as main. Required for a useful branch review. Omit it for uncommitted changes."
        },
        scope: REVIEW_SCOPE_SCHEMA,
        model: MODEL_SCHEMA,
        background: {
          type: "boolean",
          description: "When true, enqueue the review and return immediately with a job id. Poll codex_status or read codex_result. Defaults to false, which waits for the review."
        }
      }
    }
  },
  {
    name: "codex_adversarial_review",
    title: "Adversarial Codex review",
    description: "Run a read-only Codex review that challenges the chosen design, with the same target selection as codex_review. Use it when the user wants a steerable critique or passes focus text. Use codex_review for an ordinary review, and codex_rescue to change code. This tool does not modify the workspace. The optional focus string is the only review instruction; it is not a shell command.",
    annotations: {
      title: "Adversarial Codex review",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: CWD_SCHEMA,
        base: {
          type: "string",
          description: "Git ref to diff against, such as main. Omit it to review uncommitted changes."
        },
        scope: REVIEW_SCOPE_SCHEMA,
        model: MODEL_SCHEMA,
        background: {
          type: "boolean",
          description: "When true, enqueue the review and return a job id instead of waiting. Defaults to false."
        },
        focus: {
          type: "string",
          description: "Extra review focus in natural language, for example 'challenge the caching and retry design'. Omit it for the default adversarial prompt."
        }
      }
    }
  },
  {
    name: "codex_rescue",
    title: "Delegate a task to Codex",
    description: "Hand an investigation or implementation task to the local Codex CLI. Use it to debug, edit, or continue a previous Codex thread in this repo. Use codex_review or codex_adversarial_review for read-only reviews, and codex_task_resume_candidate before assuming a thread exists. Writes are on unless write is false. resume continues the latest Codex task thread; fresh forces a new thread. Returns the final Codex message, or a job id when background is true.",
    annotations: {
      title: "Delegate a task to Codex",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        cwd: CWD_SCHEMA,
        prompt: {
          type: "string",
          description: "The task Codex should carry out. Do not include routing flags such as --resume or --model; pass those as separate fields."
        },
        write: {
          type: "boolean",
          description: "Allow Codex to edit the workspace. Defaults to true. Set false for a read-only investigation."
        },
        resume: {
          type: "boolean",
          description: "Continue the latest Codex task thread in this workspace. Do not combine with fresh."
        },
        fresh: {
          type: "boolean",
          description: "Start a new Codex thread even if an earlier task exists. Do not combine with resume."
        },
        model: MODEL_SCHEMA,
        effort: EFFORT_SCHEMA,
        background: {
          type: "boolean",
          description: "When true, enqueue the task and return a job id. Defaults to false, which waits for Codex to finish."
        }
      }
    }
  },
  {
    name: "codex_transfer",
    title: "Transfer a session into Codex",
    description: "Create a persistent Codex thread from the current Grok session, or from an explicit Grok or Claude Code transcript, and return a codex resume command. Use it when the user wants to keep working in Codex itself. Use codex_rescue to continue inside Grok, and codex_review for a review. This writes a Codex session on disk. It does not edit the git workspace. Claude JSONL under ~/.claude/projects uses Codex's importer; Grok chat_history.jsonl is summarized into a handoff prompt.",
    annotations: {
      title: "Transfer a session into Codex",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: CWD_SCHEMA,
        source: {
          type: "string",
          description: "Optional Grok session directory, chat_history.jsonl, or Claude Code JSONL. Omit it to use GROK_SESSION_ID / the newest session for cwd, including long-path buckets stored with a .cwd marker."
        }
      }
    }
  },
  {
    name: "codex_status",
    title: "Show Codex job status",
    description: "List Codex jobs tracked for this repository, or inspect one job by id. Use it to see whether a background review or rescue is still running. Use codex_result for the stored final text of a finished job, and codex_cancel to stop one. This only reads local job state. It does not start Codex. wait polls until the selected job finishes or the companion timeout elapses.",
    annotations: {
      title: "Show Codex job status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: CWD_SCHEMA,
        job_id: {
          type: "string",
          description: "Job id returned by a background tool, such as task-abc123. Omit it to list recent jobs."
        },
        all: {
          type: "boolean",
          description: "When true, include jobs from other sessions in this workspace. Defaults to false, which prefers the current Grok session."
        },
        wait: {
          type: "boolean",
          description: "When true and job_id is set, poll until that job leaves the running state. Defaults to false."
        }
      }
    }
  },
  {
    name: "codex_result",
    title: "Read a finished Codex job",
    description: "Show the stored final output of one finished Codex job. Use it after codex_status reports a completed background review or rescue. Use codex_status to list jobs, and codex_cancel for a job that is still running. This reads the local job file and does not start a new Codex turn. Omit job_id only when the companion can infer the latest finished job.",
    annotations: {
      title: "Read a finished Codex job",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: CWD_SCHEMA,
        job_id: {
          type: "string",
          description: "Job id to read. Omit it to read the newest finished job in this workspace."
        }
      }
    }
  },
  {
    name: "codex_cancel",
    title: "Cancel a Codex job",
    description: "Cancel one active background Codex job and interrupt its app-server turn when the thread id is known. Use it to stop a review or rescue started with background true. Use codex_status to find the id, and codex_result only after the job has finished. Cancelling marks the local job cancelled and signals its process; it does not revert files Codex already wrote. Passing no job_id cancels the current session's active job when one exists.",
    annotations: {
      title: "Cancel a Codex job",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: CWD_SCHEMA,
        job_id: {
          type: "string",
          description: "Active job id to cancel. Omit it to cancel the active job for the current session."
        }
      }
    }
  },
  {
    name: "codex_task_resume_candidate",
    title: "Find a resumable Codex thread",
    description: "Check whether this Grok session already has a Codex rescue thread that codex_rescue can resume. Use it before starting a follow-up rescue so you can ask the user whether to continue or start fresh. Do not use it as a substitute for codex_status, which lists background jobs, or for codex_rescue, which actually runs Codex. This only reads local job metadata and returns JSON with available true or false.",
    annotations: {
      title: "Find a resumable Codex thread",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: CWD_SCHEMA
      }
    }
  }
];

export function buildCompanionArgs(name, args = {}) {
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
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: "grok-codex-plugin",
        title: "Grok Codex",
        version: PLUGIN_MANIFEST.version ?? "0.0.0"
      },
      instructions:
        "These tools drive the local Codex CLI through codex-companion. They need Node.js and a codex binary on PATH. Reviews are read-only. codex_rescue can edit the workspace unless write is false. Login is the user's existing Codex auth (codex login); this server stores no API key."
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

if (import.meta.main ?? (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
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
}
