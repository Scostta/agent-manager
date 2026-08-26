// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { config } from "../config.js";
import { db } from "../db.js";
import { reapOrphanRuns } from "./reaper.js";

assertUsingTestDb(config.databaseUrl);

async function seedRun(opts: {
  runStatus: string;
  taskStatus: string;
  pid?: number | null;
}): Promise<{ runId: string; taskId: string }> {
  const project = await db.project.create({
    data: { name: "demo", repoPath: tempDir("repo"), workspaceStrategy: "copy" },
  });
  const agent = await db.agent.create({
    data: { name: `agente-${Math.random()}`, role: "dev", model: "claude-sonnet-5", systemPrompt: "x" },
  });
  const task = await db.task.create({
    data: {
      projectId: project.id,
      title: "Tarea",
      description: "",
      status: opts.taskStatus,
      position: 0,
    },
  });
  const run = await db.taskRun.create({
    data: {
      taskId: task.id,
      agentId: agent.id,
      status: opts.runStatus,
      workspacePath: "",
      logPath: "",
      pid: opts.pid ?? null,
      endedAt: opts.runStatus === "succeeded" ? new Date() : null,
    },
  });

  return { runId: run.id, taskId: task.id };
}

beforeEach(() => resetDb());

after(() => closeDb());

describe("reapOrphanRuns", () => {
  test("cierra las runs que quedaron vivas y libera sus tasks", async () => {
    // La API se fue abajo con una run en marcha: el proceso `claude` murió con
    // ella, pero la fila se quedó diciendo que sigue corriendo.
    const corriendo = await seedRun({
      runStatus: "running",
      taskStatus: "in_progress",
      pid: 4242,
    });
    const encolada = await seedRun({ runStatus: "queued", taskStatus: "in_progress" });

    assert.equal(await reapOrphanRuns(), 2);

    for (const { runId } of [corriendo, encolada]) {
      const run = await db.taskRun.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(run.status, "failed");
      assert.ok(run.endedAt);
      assert.equal(run.pid, null, "el pid ya no apunta a nada");
      assert.match(run.resultSummary ?? "", /se reinició/);
    }

    for (const { taskId } of [corriendo, encolada]) {
      const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      assert.equal(task.status, "todo", "una task no puede quedarse en curso sin nada corriendo");
    }
  });

  test("no toca las runs que ya habían terminado", async () => {
    const { runId } = await seedRun({ runStatus: "succeeded", taskStatus: "review" });
    const antes = await db.taskRun.findUniqueOrThrow({ where: { id: runId } });

    assert.equal(await reapOrphanRuns(), 0);

    const despues = await db.taskRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(despues.status, "succeeded");
    assert.deepEqual(despues.endedAt, antes.endedAt);
  });

  test("con huérfanas de por medio, las terminadas siguen intactas", async () => {
    // El caso de verdad: en la BD conviven el historial y la run que se quedó
    // colgada. Barrer de más reescribiría runs que ya estaban cerradas.
    const terminada = await seedRun({ runStatus: "succeeded", taskStatus: "review" });
    const cancelada = await seedRun({ runStatus: "cancelled", taskStatus: "todo" });
    await seedRun({ runStatus: "running", taskStatus: "in_progress" });

    assert.equal(await reapOrphanRuns(), 1);

    assert.equal(
      (await db.taskRun.findUniqueOrThrow({ where: { id: terminada.runId } })).status,
      "succeeded",
    );
    assert.equal(
      (await db.taskRun.findUniqueOrThrow({ where: { id: cancelada.runId } })).status,
      "cancelled",
    );
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: terminada.taskId } })).status,
      "review",
    );
  });

  test("respeta la columna en la que dejaste la task", async () => {
    // La run quedó huérfana, pero mientras tanto el usuario movió la tarjeta.
    const { taskId } = await seedRun({ runStatus: "running", taskStatus: "done" });

    await reapOrphanRuns();

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    assert.equal(task.status, "done", "solo se devuelven a todo las que siguen in_progress");
  });

  test("sin huérfanas no hace nada", async () => {
    assert.equal(await reapOrphanRuns(), 0);
  });
});
