import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";

const version = spawnSync("codex", ["--version"], { encoding: "utf8" });
const available = version.status === 0;

if (process.env.REQUIRE_CODEX === "1" && !available) {
  throw new Error("REQUIRE_CODEX=1 but `codex` is not on PATH.");
}

function startAppServer() {
  const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
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
    if (message.id != null && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });

  function request(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${method}. ${stderr.slice(0, 500)}`));
      }, 8000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  return {
    request,
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ method, params })}\n`);
    },
    close() {
      child.kill("SIGTERM");
      rl.close();
    }
  };
}

test(
  "current Codex app-server accepts the companion initialize and thread/start shape without login",
  { skip: !available },
  async () => {
    assert.match(version.stdout, /codex-cli/);
    const help = spawnSync("codex", ["exec", "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--json/);
    assert.match(help.stdout, /--output-schema/);
    const resume = spawnSync("codex", ["exec", "resume", "--help"], { encoding: "utf8" });
    assert.equal(resume.status, 0, resume.stderr);
    assert.match(resume.stdout, /--last/);

    const server = startAppServer();
    try {
      const init = await server.request("initialize", {
        clientInfo: { title: "Codex Plugin", name: "Grok Build", version: "0.0.0-test" },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
          optOutNotificationMethods: [
            "item/agentMessage/delta",
            "item/reasoning/summaryTextDelta",
            "item/reasoning/summaryPartAdded",
            "item/reasoning/textDelta"
          ]
        }
      });
      assert.equal(init.error, undefined);
      assert.equal(typeof init.result.userAgent, "string");
      server.notify("initialized", {});

      const account = await server.request("account/read", { refreshToken: false });
      assert.equal(account.error, undefined);
      assert.equal(typeof account.result.requiresOpenaiAuth, "boolean");

      const models = await server.request("model/list", {});
      assert.equal(models.error, undefined);
      assert.ok(Array.isArray(models.result.data));
      assert.ok(models.result.data.length > 0);

      const thread = await server.request("thread/start", {
        cwd: process.cwd(),
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        serviceName: "grok_codex_plugin"
      });
      assert.equal(thread.error, undefined, JSON.stringify(thread.error));
      assert.equal(typeof thread.result.thread.id, "string");
      assert.equal(thread.result.approvalPolicy, "never");
    } finally {
      server.close();
    }
  }
);
