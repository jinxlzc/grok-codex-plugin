import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import {
  buildGrokHandoffPrompt,
  parseTranscriptTurns,
  resolveTransferSource
} from "../plugins/codex/scripts/lib/grok-session-transfer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "plugins", "codex", "scripts", "codex-companion.mjs");

function writeGrokSession(home, cwd, sessionId, turns, extraSummary = {}) {
  const sessionDir = path.join(home, ".grok", "sessions", encodeURIComponent(cwd), sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const lines = turns.map((turn) => JSON.stringify(turn));
  fs.writeFileSync(path.join(sessionDir, "chat_history.jsonl"), `${lines.join("\n")}\n`);
  fs.writeFileSync(
    path.join(sessionDir, "summary.json"),
    JSON.stringify(
      {
        generated_title: extraSummary.title ?? "Grok handoff",
        last_turn_summary: extraSummary.lastTurn ?? "Need Codex to continue"
      },
      null,
      2
    )
  );
  return sessionDir;
}

test("parseTranscriptTurns keeps user and assistant text and skips tool noise", () => {
  const dir = makeTempDir();
  const history = path.join(dir, "chat_history.jsonl");
  fs.writeFileSync(
    history,
    [
      { type: "system", content: "hidden" },
      { type: "user", synthetic_reason: "system_reminder", content: "ignore" },
      { type: "user", content: "Fix the flaky test" },
      { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
      { type: "assistant", content: "I will inspect the suite." },
      { type: "tool_result", tool_call_id: "1", content: "noise" }
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n")
  );

  const parsed = parseTranscriptTurns(history);
  assert.deepEqual(
    parsed.turns.map((turn) => `${turn.role}:${turn.text}`),
    ["user:Fix the flaky test", "assistant:I will inspect the suite."]
  );
});

test("resolveTransferSource finds the Grok session for the current cwd", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const sessionDir = writeGrokSession(home, repo, "sess-grok-1", [
    { type: "user", content: "Please continue in Codex" }
  ]);

  const source = resolveTransferSource(repo, {
    env: {
      HOME: home,
      GROK_HOME: path.join(home, ".grok"),
      GROK_SESSION_ID: "sess-grok-1"
    }
  });

  assert.equal(source.kind, "grok");
  assert.equal(source.sessionId, "sess-grok-1");
  assert.equal(source.sessionDir, sessionDir);
  assert.equal(source.sourcePath, path.join(sessionDir, "chat_history.jsonl"));
});

test("resolveTransferSource does not fall back when the identified Grok session transcript is missing", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo, { recursive: true });
  writeGrokSession(home, repo, "sess-other", [
    { type: "user", content: "This other session must not be transferred" }
  ]);
  const missingSessionDir = path.join(
    home,
    ".grok",
    "sessions",
    encodeURIComponent(repo),
    "sess-current"
  );
  fs.mkdirSync(missingSessionDir, { recursive: true });
  fs.writeFileSync(path.join(missingSessionDir, "summary.json"), JSON.stringify({ generated_title: "Current" }));

  for (const sessionEnv of ["GROK_SESSION_ID", "CODEX_COMPANION_SESSION_ID"]) {
    assert.throws(
      () =>
        resolveTransferSource(repo, {
          env: {
            HOME: home,
            GROK_HOME: path.join(home, ".grok"),
            [sessionEnv]: "sess-current"
          }
        }),
      (error) => {
        assert.match(error.message, /current Grok session "sess-current"/);
        assert.match(error.message, /chat_history\.jsonl/);
        assert.match(error.message, /--source/);
        assert.doesNotMatch(error.message, /sess-other/);
        return true;
      },
      sessionEnv
    );
  }
});

test("buildGrokHandoffPrompt includes conversation blocks", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const sessionDir = writeGrokSession(
    home,
    repo,
    "sess-grok-2",
    [
      { type: "user", content: "Investigate the race" },
      { type: "assistant", content: "I found a shared map." }
    ],
    { title: "Race hunt" }
  );

  const handoff = buildGrokHandoffPrompt({
    kind: "grok",
    sessionDir,
    sessionId: "sess-grok-2",
    sourcePath: path.join(sessionDir, "chat_history.jsonl")
  });

  assert.equal(handoff.title, "Race hunt");
  assert.match(handoff.prompt, /<user>\nInvestigate the race\n<\/user>/);
  assert.match(handoff.prompt, /<assistant>\nI found a shared map.\n<\/assistant>/);
});

test("transfer creates a persistent Codex thread from a Grok session", () => {
  const home = makeTempDir();
  const repo = path.join(home, "repo");
  const binDir = makeTempDir();
  fs.mkdirSync(repo, { recursive: true });
  installFakeCodex(binDir);
  initGitRepo(repo);
  writeGrokSession(home, repo, "sess-transfer", [
    { type: "user", content: "Finish the retry helper" },
    { type: "assistant", content: "I sketched the backoff." }
  ]);

  const result = run("node", [SCRIPT, "transfer", "--json"], {
    cwd: repo,
    env: {
      ...buildEnv(binDir),
      HOME: home,
      GROK_HOME: path.join(home, ".grok"),
      GROK_SESSION_ID: "sess-transfer",
      CODEX_HOME: path.join(home, ".codex")
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "grok");
  assert.equal(payload.threadId, "thr_1");
  assert.equal(payload.resumeCommand, "codex resume thr_1");
  assert.equal(payload.sessionId, "sess-transfer");

  const fakeState = JSON.parse(fs.readFileSync(path.join(binDir, "fake-codex-state.json"), "utf8"));
  assert.equal(fakeState.threads[0].ephemeral, false);
  assert.match(fakeState.lastTurnStart.prompt, /Finish the retry helper/);
});
