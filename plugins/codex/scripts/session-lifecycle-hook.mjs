#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import path from "node:path";

import { terminateProcessTree } from "./lib/process.mjs";
import { BROKER_ENDPOINT_ENV } from "./lib/app-server.mjs";
import {
  clearBrokerSession,
  LOG_FILE_ENV,
  loadBrokerSession,
  PID_FILE_ENV,
  sendBrokerShutdown,
  teardownBrokerSession
} from "./lib/broker-lifecycle.mjs";
import { loadState, resolveStateFile, saveState } from "./lib/state.mjs";
import { TRANSCRIPT_PATH_ENV, resolveGrokSessionDir, resolveGrokTranscriptPath } from "./lib/grok-session-transfer.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

export const SESSION_ID_ENV = "CODEX_COMPANION_SESSION_ID";
const PLUGIN_DATA_ENVS = ["GROK_PLUGIN_DATA", "CLAUDE_PLUGIN_DATA"];

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  const envFiles = [process.env.GROK_ENV_FILE, process.env.CLAUDE_ENV_FILE].filter(Boolean);
  if (value == null || value === "") {
    return;
  }
  for (const envFile of envFiles) {
    fs.appendFileSync(envFile, `export ${name}=${shellEscape(value)}\n`, "utf8");
  }
}

function hookSessionId(input = {}) {
  return input.sessionId || input.session_id || process.env.GROK_SESSION_ID || process.env[SESSION_ID_ENV] || null;
}

function hookCwd(input = {}) {
  return input.cwd || input.workspaceRoot || process.env.GROK_WORKSPACE_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function persistSessionSidecar(input, transcriptPath) {
  const pluginDataDir = PLUGIN_DATA_ENVS.map((name) => process.env[name]).find(Boolean);
  const sessionId = hookSessionId(input);
  if (!pluginDataDir || !sessionId) {
    return;
  }
  const dir = path.join(pluginDataDir, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify(
      {
        sessionId,
        transcriptPath,
        cwd: hookCwd(input),
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
}

function cleanupSessionJobs(cwd, sessionId) {
  if (!cwd || !sessionId) {
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) {
    return;
  }

  const state = loadState(workspaceRoot);
  const removedJobs = state.jobs.filter((job) => job.sessionId === sessionId);
  if (removedJobs.length === 0) {
    return;
  }

  for (const job of removedJobs) {
    const stillRunning = job.status === "queued" || job.status === "running";
    if (!stillRunning) {
      continue;
    }
    try {
      terminateProcessTree(job.pid ?? Number.NaN);
    } catch {
      // Ignore teardown failures during session shutdown.
    }
  }

  saveState(workspaceRoot, {
    ...state,
    jobs: state.jobs.filter((job) => job.sessionId !== sessionId)
  });
}

function handleSessionStart(input) {
  const cwd = hookCwd(input);
  const sessionId = hookSessionId(input);
  const grokDir = resolveGrokSessionDir(cwd, sessionId);
  const grokTranscript = resolveGrokTranscriptPath(grokDir);
  const transcriptPath = input.transcript_path || input.transcriptPath || grokTranscript || null;

  appendEnvVar(SESSION_ID_ENV, sessionId);
  appendEnvVar(TRANSCRIPT_PATH_ENV, transcriptPath);
  for (const name of PLUGIN_DATA_ENVS) {
    appendEnvVar(name, process.env[name]);
  }
  persistSessionSidecar(input, transcriptPath);
}

async function handleSessionEnd(input) {
  const cwd = hookCwd(input);
  const brokerSession =
    loadBrokerSession(cwd) ??
    (process.env[BROKER_ENDPOINT_ENV]
      ? {
          endpoint: process.env[BROKER_ENDPOINT_ENV],
          pidFile: process.env[PID_FILE_ENV] ?? null,
          logFile: process.env[LOG_FILE_ENV] ?? null
        }
      : null);
  const brokerEndpoint = brokerSession?.endpoint ?? null;
  const pidFile = brokerSession?.pidFile ?? null;
  const logFile = brokerSession?.logFile ?? null;
  const sessionDir = brokerSession?.sessionDir ?? null;
  const pid = brokerSession?.pid ?? null;

  if (brokerEndpoint) {
    await sendBrokerShutdown(brokerEndpoint);
  }

  cleanupSessionJobs(cwd, hookSessionId(input));
  teardownBrokerSession({
    endpoint: brokerEndpoint,
    pidFile,
    logFile,
    sessionDir,
    pid,
    killProcess: terminateProcessTree
  });
  clearBrokerSession(cwd);
}

async function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? input.hookEventName ?? "";

  if (eventName === "SessionStart" || eventName === "session_start") {
    handleSessionStart(input);
    return;
  }

  if (eventName === "SessionEnd" || eventName === "session_end") {
    await handleSessionEnd(input);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
