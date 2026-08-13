import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir } from "./helpers.mjs";

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
