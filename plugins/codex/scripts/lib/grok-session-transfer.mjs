import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureAbsolutePath } from "./fs.mjs";

export const TRANSCRIPT_PATH_ENV = "CODEX_COMPANION_TRANSCRIPT_PATH";
const MAX_TURNS = 24;
const MAX_TURN_CHARS = 4000;
const MAX_HANDOFF_CHARS = 24000;

function grokHome(env = process.env) {
  return env.GROK_HOME || path.join(os.homedir(), ".grok");
}

function claudeProjectsDir() {
  return path.join(os.homedir(), ".claude", "projects");
}

function resolveUserPath(cwd, value) {
  if (value === "~") {
    return os.homedir();
  }
  if (String(value).startsWith("~/")) {
    return path.join(os.homedir(), String(value).slice(2));
  }
  return ensureAbsolutePath(cwd, value);
}

function isInsideDir(filePath, parentDir) {
  try {
    const source = fs.realpathSync(filePath);
    const parent = fs.realpathSync(parentDir);
    const relative = path.relative(parent, source);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function extractText(content) {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part?.type === "text" || typeof part?.text === "string") {
          return part.text ?? "";
        }
        return "";
      })
      .join("");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") {
      return content.text;
    }
    if (content.message) {
      return extractText(content.message.content ?? content.message);
    }
  }
  return "";
}

function lookLikeClaudeRecord(record) {
  return Boolean(
    record?.type === "user" ||
      record?.type === "assistant" ||
      record?.type === "custom-title" ||
      record?.message?.role
  );
}

export function parseTranscriptTurns(filePath, options = {}) {
  const maxTurns = options.maxTurns ?? MAX_TURNS;
  const maxTurnChars = options.maxTurnChars ?? MAX_TURN_CHARS;
  const turns = [];
  let title = null;

  if (!fs.existsSync(filePath)) {
    return { turns, title };
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record?.type === "custom-title" && record.customTitle) {
      title = String(record.customTitle);
      continue;
    }
    if (record?.synthetic_reason) {
      continue;
    }
    if (record?.type && !["user", "assistant"].includes(record.type)) {
      continue;
    }

    const role = record?.type === "assistant" || record?.message?.role === "assistant" ? "assistant" : "user";
    const text = extractText(record?.content ?? record?.message?.content ?? record?.message).trim();
    if (!text) {
      continue;
    }
    turns.push({
      role,
      text: text.length > maxTurnChars ? `${text.slice(0, maxTurnChars - 3)}...` : text
    });
  }

  const trimmed = turns.length > maxTurns ? turns.slice(-maxTurns) : turns;
  return { turns: trimmed, title, truncated: turns.length > maxTurns };
}

export function detectClaudeJsonl(filePath) {
  if (path.extname(filePath) !== ".jsonl" || !fs.existsSync(filePath)) {
    return false;
  }
  if (isInsideDir(filePath, claudeProjectsDir())) {
    return true;
  }
  const firstLine = fs.readFileSync(filePath, "utf8").split(/\r?\n/).find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  try {
    const record = JSON.parse(firstLine);
    return lookLikeClaudeRecord(record) && (record.message || record.type === "custom-title");
  } catch {
    return false;
  }
}

export function resolveGrokSessionDir(cwd, sessionId, env = process.env) {
  if (!sessionId) {
    return null;
  }
  const encodedCwd = encodeURIComponent(path.resolve(cwd));
  const sessionDir = path.join(grokHome(env), "sessions", encodedCwd, sessionId);
  if (fs.existsSync(path.join(sessionDir, "chat_history.jsonl"))) {
    return sessionDir;
  }
  return null;
}

export function latestGrokSessionDir(cwd, env = process.env) {
  const sessionsRoot = path.join(grokHome(env), "sessions", encodeURIComponent(path.resolve(cwd)));
  if (!fs.existsSync(sessionsRoot)) {
    return null;
  }
  const entries = fs
    .readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(sessionsRoot, entry.name);
      const history = path.join(dir, "chat_history.jsonl");
      if (!fs.existsSync(history)) {
        return null;
      }
      return { dir, mtime: fs.statSync(history).mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.dir ?? null;
}

export function resolveGrokTranscriptPath(sessionDir) {
  if (!sessionDir) {
    return null;
  }
  const history = path.join(sessionDir, "chat_history.jsonl");
  return fs.existsSync(history) ? history : null;
}

export function readGrokSessionMeta(sessionDir) {
  const summaryPath = path.join(sessionDir, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  } catch {
    return {};
  }
}

export function resolveTransferSource(cwd, options = {}) {
  const env = options.env ?? process.env;
  const requested = options.source || env[TRANSCRIPT_PATH_ENV] || null;
  if (requested) {
    const sourcePath = resolveUserPath(cwd, requested);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Session source not found: ${sourcePath}`);
    }

    if (fs.statSync(sourcePath).isDirectory()) {
      const transcriptPath = resolveGrokTranscriptPath(sourcePath);
      if (!transcriptPath) {
        throw new Error(`Grok session directory is missing chat_history.jsonl: ${sourcePath}`);
      }
      return {
        kind: "grok",
        sourcePath: transcriptPath,
        sessionDir: sourcePath,
        sessionId: path.basename(sourcePath)
      };
    }

    if (detectClaudeJsonl(sourcePath)) {
      return {
        kind: "claude",
        sourcePath: fs.realpathSync(sourcePath),
        sessionId: path.basename(sourcePath, ".jsonl")
      };
    }

    if (path.basename(sourcePath) === "chat_history.jsonl") {
      return {
        kind: "grok",
        sourcePath,
        sessionDir: path.dirname(sourcePath),
        sessionId: path.basename(path.dirname(sourcePath))
      };
    }

    throw new Error(
      `Unrecognized session source: ${sourcePath}. Pass a Grok session directory, chat_history.jsonl, or a Claude Code JSONL under ~/.claude/projects.`
    );
  }

  const sessionId = env.CODEX_COMPANION_SESSION_ID || env.GROK_SESSION_ID || null;
  const sessionDir = resolveGrokSessionDir(cwd, sessionId, env) ?? latestGrokSessionDir(cwd, env);
  if (!sessionDir) {
    throw new Error(
      "Could not identify the current Grok session. Retry with --source <session-dir-or-chat_history.jsonl>."
    );
  }
  return {
    kind: "grok",
    sourcePath: resolveGrokTranscriptPath(sessionDir),
    sessionDir,
    sessionId: path.basename(sessionDir)
  };
}

export function buildGrokHandoffPrompt(source, options = {}) {
  const parsed = parseTranscriptTurns(source.sourcePath, options);
  const meta = source.sessionDir ? readGrokSessionMeta(source.sessionDir) : {};
  const title =
    parsed.title ||
    meta.generated_title ||
    meta.session_summary ||
    `Grok session ${source.sessionId ?? "unknown"}`;

  const lines = [
    "<task>",
    "You are taking over a Grok Build session that was transferred into Codex.",
    "Read the conversation below, then acknowledge the current goal and wait for the next instruction unless the last user request is still unfinished.",
    "Do not invent work that Grok did not ask for.",
    "</task>",
    "",
    "<session_meta>",
    `title: ${title}`,
    `grok_session_id: ${source.sessionId ?? "unknown"}`,
    `source: ${source.sourcePath}`,
    meta.last_turn_summary ? `last_turn_summary: ${meta.last_turn_summary}` : null,
    parsed.truncated ? `note: earlier turns were trimmed; only the last ${parsed.turns.length} user/assistant turns are included.` : null,
    "</session_meta>",
    "",
    "<conversation>"
  ].filter((line) => line !== null);

  for (const turn of parsed.turns) {
    lines.push(`<${turn.role}>`);
    lines.push(turn.text);
    lines.push(`</${turn.role}>`);
  }
  lines.push("</conversation>");

  let prompt = lines.join("\n");
  if (prompt.length > MAX_HANDOFF_CHARS) {
    prompt = `${prompt.slice(0, MAX_HANDOFF_CHARS - 20)}\n...</conversation>\n`;
  }

  return {
    title,
    prompt,
    turnCount: parsed.turns.length
  };
}
