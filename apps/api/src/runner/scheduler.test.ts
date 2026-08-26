// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { after, afterEach, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { config } from "../config.js";
import { db } from "../db.js";
import { runtime } from "./executor.js";
import { resumeQueue } from "./queue.js";
import {
  cancelRetry,
  clearAllRetries,
  pendingRetryIds,
  restorePendingRetries,
  scheduleRetryAtReset,
} from "./scheduler.js";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

assertUsingTestDb(config.databaseUrl);

const realSpawn = runtime.spawn;

/** CLI simulado: el reintento llega hasta el executor, que no debe spawnear. */
function fakeCli(): typeof runtime.spawn {
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
        child.stdout.write(
          `${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok" })}\n`,
        );
        child.stdout.end();
        child.stderr.end();
        child.emit("exit", 0, null);
      });
    });

    return child as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof runtime.spawn;
}

/** El timer se arma con `resetAt - ahora + 60s` de gracia. */
function resetInMs(ms: number): Date {
  return new Date(Date.now() - 60_000 + ms);
}

async function seedRateLimitedRun(resetAt: Date | null): Promise<{
  runId: string;
  taskId: string;
}> {
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
  const run = await db.taskRun.create({
    data: {
      taskId: task.id,
      agentId: agent.id,
      status: "failed",
      failureKind: "rate_limit",
      rateLimitResetAt: resetAt,
      workspacePath: "",
      logPath: "",
      endedAt: new Date(),
    },
  });

  return { runId: run.id, taskId: task.id };
}

async function waitFor(probe: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`No pasó en ${timeoutMs} ms`);
}

beforeEach(async () => {
  resumeQueue();
  runtime.spawn = fakeCli();
  await resetDb();
});

afterEach(() => {
  // Un timer vivo mantendría el proceso de test en pie.
  clearAllRetries();
  runtime.spawn = realSpawn;
});

after(() => closeDb());

describe("scheduleRetryAtReset", () => {
  test("sin hora de reset no programa nada y lo dice", async () => {
    const { runId } = await seedRateLimitedRun(null);

    await assert.rejects(() => scheduleRetryAtReset(runId), /no puedo programar/);

    const run = await db.taskRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.failureKind, "rate_limit", "sigue esperando decisión del usuario");
    assert.deepEqual(pendingRetryIds(), []);
  });

  test("con hora conocida marca la espera y arma el timer", async () => {
    const resetAt = new Date(Date.now() + 60 * 60_000);
    const { runId } = await seedRateLimitedRun(resetAt);

    assert.deepEqual(await scheduleRetryAtReset(runId), resetAt);

    const run = await db.taskRun.findUniqueOrThrow({ where: { id: runId } });
    // La intención vive en la BD: un reinicio de la API no pierde la espera.
    assert.equal(run.failureKind, "rate_limit_waiting");
    assert.deepEqual(pendingRetryIds(), [runId]);
  });

  test("al llegar la hora relanza la task en una run nueva", async () => {
    const { runId, taskId } = await seedRateLimitedRun(resetInMs(50));

    await scheduleRetryAtReset(runId);

    // Se espera a que la run nueva termine, no solo a que exista: si el test
    // acabara con ella en vuelo, el reset de la BD la pillaría a medias.
    await waitFor(async () => {
      const nueva = await db.taskRun.findFirst({ where: { taskId, id: { not: runId } } });
      return nueva?.status === "succeeded";
    });

    const original = await db.taskRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(original.failureKind, "rate_limit", "ya no está esperando");
    assert.deepEqual(pendingRetryIds(), [], "el timer se consume al dispararse");
  });

  test("si ya la relanzaste a mano, no duplica la run", async () => {
    const { runId, taskId } = await seedRateLimitedRun(resetInMs(150));
    await scheduleRetryAtReset(runId);

    // El usuario tira de API key sin esperar: la espera deja de estar vigente.
    await db.taskRun.update({ where: { id: runId }, data: { failureKind: "rate_limit" } });

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await db.taskRun.count({ where: { taskId } }), 1);
  });

  test("cancelRetry desarma la espera", async () => {
    const { runId, taskId } = await seedRateLimitedRun(resetInMs(150));
    await scheduleRetryAtReset(runId);

    assert.equal(cancelRetry(runId), true);
    assert.equal(cancelRetry(runId), false, "ya no había nada que cancelar");

    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await db.taskRun.count({ where: { taskId } }), 1);
  });
});

describe("restorePendingRetries", () => {
  test("rearma las esperas que sobrevivieron al reinicio", async () => {
    const conHora = await seedRateLimitedRun(new Date(Date.now() + 60 * 60_000));
    await db.taskRun.update({
      where: { id: conHora.runId },
      data: { failureKind: "rate_limit_waiting" },
    });

    assert.equal(await restorePendingRetries(), 1);
    assert.deepEqual(pendingRetryIds(), [conHora.runId]);
  });

  test("una espera sin hora vuelve a manos del usuario en vez de quedarse colgada", async () => {
    const sinHora = await seedRateLimitedRun(null);
    await db.taskRun.update({
      where: { id: sinHora.runId },
      data: { failureKind: "rate_limit_waiting" },
    });

    await restorePendingRetries();

    const run = await db.taskRun.findUniqueOrThrow({ where: { id: sinHora.runId } });
    assert.equal(run.failureKind, "rate_limit");
    assert.deepEqual(pendingRetryIds(), [], "sin hora no hay nada que esperar");
  });
});
