// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { config } from "../config.js";
import { db } from "../db.js";
import { runtime } from "./executor.js";
import {
  enqueueTaskRun,
  pauseQueue,
  queueStats,
  resumeQueue,
  setConcurrency,
  stopEverything,
} from "./queue.js";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

assertUsingTestDb(config.databaseUrl);

const realSpawn = runtime.spawn;

/** Igual que en executor.test.ts: un CLI simulado, nunca el de verdad. */
function fakeCli(lines: unknown[] = []): typeof runtime.spawn {
  return (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      pid?: number;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 999999;

    child.on("newListener", (event) => {
      if (event !== "exit") return;
      setImmediate(() => {
        for (const line of lines) child.stdout.write(`${JSON.stringify(line)}\n`);
        child.stdout.end();
        child.stderr.end();
        child.emit("exit", 0, null);
      });
    });

    return child as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof runtime.spawn;
}

const OK_RUN = [
  { type: "result", subtype: "success", is_error: false, result: "hecho", total_cost_usd: 0.01 },
];

async function seedTask(): Promise<{ taskId: string; agentId: string }> {
  const repoPath = tempDir("repo");
  await fs.writeFile(path.join(repoPath, "README.md"), "# demo\n", "utf8");

  const project = await db.project.create({
    data: { name: "demo", repoPath, workspaceStrategy: "copy" },
  });
  const agent = await db.agent.create({
    data: { name: `agente-${Math.random()}`, role: "dev", model: "claude-sonnet-5", systemPrompt: "x" },
  });
  const task = await db.task.create({
    data: { projectId: project.id, title: "Tarea", description: "", position: 0 },
  });

  return { taskId: task.id, agentId: agent.id };
}

async function waitForRun(runId: string, status: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await db.taskRun.findUnique({ where: { id: runId } });
    if (run?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const run = await db.taskRun.findUnique({ where: { id: runId } });
  throw new Error(`La run se quedó en '${run?.status}' en vez de '${status}'`);
}

beforeEach(async () => {
  // stopEverything deja la cola en pausa a propósito: cada test parte de cero.
  resumeQueue();
  setConcurrency(1);
  runtime.spawn = fakeCli(OK_RUN);
  await resetDb();
});

after(async () => {
  runtime.spawn = realSpawn;
  await closeDb();
});

describe("enqueueTaskRun", () => {
  test("crea la run, pone la task en curso y la ejecuta", async () => {
    const { taskId, agentId } = await seedTask();

    const runId = await enqueueTaskRun(taskId, agentId);

    // La task pasa a in_progress al encolar, no al empezar a ejecutarse: si no,
    // el tablero no reflejaría que ya está pedida.
    const enCurso = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    assert.ok(["in_progress", "review"].includes(enCurso.status));

    await waitForRun(runId, "succeeded");
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    assert.equal(task.status, "review");
  });

  test("un agente inexistente no deja la task tocada ni crea run", async () => {
    const { taskId } = await seedTask();

    await assert.rejects(() => enqueueTaskRun(taskId, "agente-que-no-existe"));

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    assert.equal(task.status, "todo");
    assert.equal(await db.taskRun.count(), 0);
  });
});

describe("control de la cola", () => {
  test("en pausa no se ejecuta nada, pero la run queda encolada", async () => {
    const { taskId, agentId } = await seedTask();
    pauseQueue();

    const runId = await enqueueTaskRun(taskId, agentId);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const run = await db.taskRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, "queued");
    assert.equal(queueStats().paused, true);
    assert.equal(queueStats().waiting, 1);

    // Al reanudar sale sola.
    resumeQueue();
    await waitForRun(runId, "succeeded");
  });

  test("la concurrencia se cambia en caliente", () => {
    assert.equal(setConcurrency(4), 4);
    assert.equal(queueStats().concurrency, 4);
  });
});

describe("stopEverything", () => {
  test("cierra lo que esperaba turno y devuelve sus tasks a todo", async () => {
    pauseQueue();
    const primera = await seedTask();
    const segunda = await seedTask();
    const runA = await enqueueTaskRun(primera.taskId, primera.agentId);
    const runB = await enqueueTaskRun(segunda.taskId, segunda.agentId);

    const result = await stopEverything();

    assert.equal(result.discarded, 2);
    for (const runId of [runA, runB]) {
      const run = await db.taskRun.findUniqueOrThrow({ where: { id: runId } });
      // Sin esto se quedarían en 'queued' para siempre: nunca llegan al executor.
      assert.equal(run.status, "cancelled");
      assert.ok(run.endedAt);
      assert.match(run.resultSummary ?? "", /cola/i);
    }
    for (const { taskId } of [primera, segunda]) {
      const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      assert.equal(task.status, "todo");
    }
  });

  test("deja la cola en pausa: tras un 'para', nada arranca solo", async () => {
    await stopEverything();
    assert.equal(queueStats().paused, true);

    const { taskId, agentId } = await seedTask();
    const runId = await enqueueTaskRun(taskId, agentId);
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal((await db.taskRun.findUniqueOrThrow({ where: { id: runId } })).status, "queued");
  });
});
