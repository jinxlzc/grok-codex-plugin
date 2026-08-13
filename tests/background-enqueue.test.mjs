import { EventEmitter } from "node:events";
import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { enqueueBackgroundTask } from "../plugins/codex/scripts/codex-companion.mjs";
import { listJobs, readJobFile, resolveJobFile } from "../plugins/codex/scripts/lib/state.mjs";
import { makeTempDir } from "./helpers.mjs";

function buildJob(workspaceRoot, id) {
  return {
    id,
    kind: "task",
    kindLabel: "rescue",
    title: "Codex Task",
    workspaceRoot,
    jobClass: "task",
    summary: "Check background enqueue ordering",
    write: true,
    createdAt: "2026-08-14T00:00:00.000Z"
  };
}

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = () => {};
  return child;
}

test("background enqueue persists the complete job request before spawning the worker", () => {
  const workspaceRoot = makeTempDir();
  const job = buildJob(workspaceRoot, "task-ordering");
  const request = {
    cwd: workspaceRoot,
    model: "gpt-5.3-codex-spark",
    effort: "high",
    prompt: "Inspect the queue race",
    write: true,
    resumeLast: false,
    jobId: job.id
  };
  let recordObservedByWorker = null;

  enqueueBackgroundTask(workspaceRoot, job, request, {
    spawnWorker(cwd, jobId) {
      assert.equal(cwd, workspaceRoot);
      assert.equal(jobId, job.id);
      const jobFile = resolveJobFile(workspaceRoot, job.id);
      assert.equal(fs.existsSync(jobFile), true, "worker must not start before its job file exists");
      recordObservedByWorker = readJobFile(jobFile);
      return fakeChild();
    }
  });

  assert.deepEqual(recordObservedByWorker.request, request);
  assert.equal(recordObservedByWorker.status, "queued");
  assert.equal(recordObservedByWorker.pid, null);

  const stored = readJobFile(resolveJobFile(workspaceRoot, job.id));
  assert.equal(stored.pid, 4242);
  assert.deepEqual(stored.request, request);
});

test("background enqueue marks the persisted job failed when the worker cannot spawn", () => {
  const workspaceRoot = makeTempDir();
  const job = buildJob(workspaceRoot, "task-spawn-failure");
  const request = {
    cwd: workspaceRoot,
    prompt: "Run in the background",
    write: true,
    resumeLast: false,
    jobId: job.id
  };

  assert.throws(
    () =>
      enqueueBackgroundTask(workspaceRoot, job, request, {
        spawnWorker() {
          throw new Error("simulated spawn failure");
        }
      }),
    /Could not spawn background task worker: simulated spawn failure/
  );

  const stored = readJobFile(resolveJobFile(workspaceRoot, job.id));
  assert.equal(stored.status, "failed");
  assert.equal(stored.phase, "failed");
  assert.equal(stored.pid, null);
  assert.deepEqual(stored.request, request);
  assert.match(stored.errorMessage, /simulated spawn failure/);

  const indexed = listJobs(workspaceRoot).find((candidate) => candidate.id === job.id);
  assert.equal(indexed.status, "failed");
  assert.equal(indexed.phase, "failed");
});
