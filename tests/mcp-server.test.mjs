import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir } from "./helpers.mjs";
import { buildCompanionArgs } from "../plugins/codex/scripts/mcp-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "plugins", "codex", "scripts", "mcp-server.mjs");

function startServer(env) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const rl = readline.createInterface({ input: child.stdout });
  let nextId = 1;
  const pending = new Map();

  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    const message = JSON.parse(line);
    if (message.id != null && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });

  function request(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 10000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  return {
    request,
    close() {
      child.kill();
      rl.close();
    }
  };
}

test("MCP server lists companion tools and can run setup", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir);
  const repo = makeTempDir();
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");

  const server = startServer(buildEnv(binDir));
  try {
    const listed = await server.request("tools/list", {});
    const names = listed.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "codex_adversarial_review",
      "codex_cancel",
      "codex_rescue",
      "codex_result",
      "codex_review",
      "codex_setup",
      "codex_status",
      "codex_task_resume_candidate",
      "codex_transfer"
    ]);

    const setup = await server.request("tools/call", {
      name: "codex_setup",
      arguments: { cwd: repo }
    });
    assert.equal(setup.result.isError, false);
    const payload = JSON.parse(setup.result.content[0].text);
    assert.equal(payload.ready, true);
  } finally {
    server.close();
  }
});

test("MCP tools build the locked companion argv shapes", () => {
  const cwd = "/tmp/mcp-workspace";
  const cases = [
    {
      name: "codex_setup",
      args: { cwd, enable_review_gate: true },
      expected: ["setup", "--json", "--cwd", cwd, "--enable-review-gate"]
    },
    {
      name: "codex_review",
      args: { cwd, base: "main", scope: "branch", model: "spark", background: true },
      expected: [
        "review",
        "--json",
        "--cwd",
        cwd,
        "--base",
        "main",
        "--scope",
        "branch",
        "--model",
        "spark",
        "--background"
      ]
    },
    {
      name: "codex_adversarial_review",
      args: { cwd, base: "develop", scope: "working-tree", model: "spark", background: true, focus: "auth only" },
      expected: [
        "adversarial-review",
        "--json",
        "--cwd",
        cwd,
        "--base",
        "develop",
        "--scope",
        "working-tree",
        "--model",
        "spark",
        "--background",
        "auth only"
      ]
    },
    {
      name: "codex_rescue",
      args: { cwd, prompt: "Fix it", resume: true, model: "spark", effort: "high", background: true },
      expected: [
        "task",
        "--json",
        "--cwd",
        cwd,
        "--write",
        "--resume-last",
        "--model",
        "spark",
        "--effort",
        "high",
        "--background",
        "Fix it"
      ]
    },
    {
      name: "codex_transfer",
      args: { cwd, source: "/tmp/grok-session/chat_history.jsonl" },
      expected: [
        "transfer",
        "--json",
        "--cwd",
        cwd,
        "--source",
        "/tmp/grok-session/chat_history.jsonl"
      ]
    },
    {
      name: "codex_status",
      args: { cwd, job_id: "task-123", all: true, wait: true },
      expected: ["status", "--json", "--cwd", cwd, "--all", "--wait", "task-123"]
    },
    {
      name: "codex_result",
      args: { cwd, job_id: "task-123" },
      expected: ["result", "--json", "--cwd", cwd, "task-123"]
    },
    {
      name: "codex_cancel",
      args: { cwd, job_id: "task-123" },
      expected: ["cancel", "--json", "--cwd", cwd, "task-123"]
    },
    {
      name: "codex_task_resume_candidate",
      args: { cwd },
      expected: ["task-resume-candidate", "--json", "--cwd", cwd]
    }
  ];

  for (const { name, args, expected } of cases) {
    assert.deepEqual(buildCompanionArgs(name, args), expected, name);
  }
});

test("MCP rescue write and thread-selection flags preserve explicit caller intent", () => {
  assert.deepEqual(buildCompanionArgs("codex_rescue", { prompt: "Default write" }), [
    "task",
    "--json",
    "--write",
    "Default write"
  ]);
  assert.deepEqual(buildCompanionArgs("codex_rescue", { prompt: "Read only", write: false, fresh: true }), [
    "task",
    "--json",
    "--fresh",
    "Read only"
  ]);
  assert.deepEqual(buildCompanionArgs("codex_setup", { disable_review_gate: true }), [
    "setup",
    "--json",
    "--disable-review-gate"
  ]);
  assert.ok(!buildCompanionArgs("codex_review", { cwd: "/tmp/ws" }).includes("--write"));
});
