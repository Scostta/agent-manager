// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildApp } from "../app.js";
import { config } from "../config.js";
import { db } from "../db.js";
import { decideResume, resumeStatus } from "./resume.js";
import { ResumeUnavailableError, continueRun, relaunchRun, stopEverything } from "./queue.js";

import type { FastifyInstance } from "fastify";
import type { TaskRun } from "@prisma/client";

assertUsingTestDb(config.databaseUrl);

let app: FastifyInstance;

before(async () => {
  app = await buildApp({ logger: false });
});

beforeEach(async () => {
  // La cola queda en pausa: aquí se prueba qué run se encola y con qué, no
  // ejecutarla. Así ningún test spawnea nada, ni el CLI falso.
  await stopEverything();
  await resetDb();
});

after(async () => {
  await app.close();
  await closeDb();
});

/**
 * Una run terminada con sesión guardada y su workspace en disco: el punto de
 * partida de "casi, pero cambia X".
 */
async function seedRun(
  overrides: Partial<{ status: string; sessionId: string | null; workspacePath: string }> = {},
): Promise<TaskRun> {
  const project = await db.project.create({
    data: { name: "demo", repoPath: tempDir("repo"), workspaceStrategy: "copy" },
  });
  const agent = await db.agent.create({
    data: { name: "agente", role: "dev", model: "claude-sonnet-5", systemPrompt: "haz" },
  });
  const task = await db.task.create({
    data: { projectId: project.id, title: "Tarea", description: "", status: "review", position: 0 },
  });

  return db.taskRun.create({
    data: {
      taskId: task.id,
      agentId: agent.id,
      status: overrides.status ?? "succeeded",
      workspacePath: overrides.workspacePath ?? tempDir("ws"),
      logPath: "",
      sessionId: "sessionId" in overrides ? overrides.sessionId : "sess_abc",
      endedAt: new Date(),
    },
  });
}

describe("decideResume", () => {
  const ok = { status: "succeeded", sessionId: "sess_abc", workspaceExists: true };

  test("una run terminada con sesión y workspace se puede retomar", () => {
    assert.deepEqual(decideResume(ok), { canResume: true, reason: null });
  });

  test("no se retoma una run que todavía está corriendo", () => {
    for (const status of ["queued", "running"]) {
      const check = decideResume({ ...ok, status });
      assert.equal(check.canResume, false, `${status} no debería poder retomarse`);
      assert.match(check.reason ?? "", /en marcha/);
    }
  });

  test("sin session_id no hay conversación que seguir", () => {
    const check = decideResume({ ...ok, sessionId: null });
    assert.equal(check.canResume, false);
    assert.match(check.reason ?? "", /sesión/);
  });

  test("sin workspace tampoco, porque el CLI busca la sesión por directorio", () => {
    const check = decideResume({ ...ok, workspaceExists: false });
    assert.equal(check.canResume, false);
    assert.match(check.reason ?? "", /workspace/);
  });

  // Un fallo o una cancelación son justo los casos donde más apetece retomar.
  test("da igual cómo terminase: lo que manda es que haya sesión y workspace", () => {
    for (const status of ["failed", "cancelled"]) {
      assert.equal(decideResume({ ...ok, status }).canResume, true);
    }
  });
});

describe("resumeStatus", () => {
  test("mira el disco, no solo la BD", async () => {
    const run = await seedRun();
    assert.equal((await resumeStatus(run.id))?.canResume, true);

    // Mergear o descartar dejan la fila intacta y se llevan la carpeta.
    await fs.rm(run.workspacePath, { recursive: true, force: true });

    const after = await resumeStatus(run.id);
    assert.equal(after?.canResume, false);
    assert.match(after?.reason ?? "", /workspace/);
  });

  test("una run que no existe no devuelve nada", async () => {
    assert.equal(await resumeStatus("no-existe"), null);
  });
});

describe("continueRun", () => {
  test("encadena una run con las instrucciones nuevas", async () => {
    const parent = await seedRun();

    const childId = await continueRun(parent.id, "Extrae la validación a su módulo.");

    const child = await db.taskRun.findUniqueOrThrow({ where: { id: childId } });
    assert.equal(child.resumedFromId, parent.id);
    assert.equal(child.followUpPrompt, "Extrae la validación a su módulo.");
    assert.equal(child.agentId, parent.agentId, "sigue el mismo agente: es su sesión");
    assert.equal(child.taskId, parent.taskId);

    const task = await db.task.findUniqueOrThrow({ where: { id: parent.taskId } });
    assert.equal(task.status, "in_progress", "la tarea vuelve al tablero mientras trabaja");
  });

  /**
   * Aquí no vale empezar de cero por lo bajini: el usuario cree que está
   * pagando un ajuste y se encontraría una run entera en la factura.
   */
  test("se niega en vez de relanzar cuando no hay sesión que retomar", async () => {
    const parent = await seedRun({ sessionId: null });

    await assert.rejects(
      () => continueRun(parent.id, "Cambia esto"),
      (err: Error) => err instanceof ResumeUnavailableError && /sesión/.test(err.message),
    );
    assert.equal(await db.taskRun.count(), 1, "no se ha encolado nada");
  });

  test("se niega si el workspace ya no está", async () => {
    const parent = await seedRun();
    await fs.rm(parent.workspacePath, { recursive: true, force: true });

    await assert.rejects(
      () => continueRun(parent.id, "Cambia esto"),
      (err: Error) => err instanceof ResumeUnavailableError && /workspace/.test(err.message),
    );
    assert.equal(await db.taskRun.count(), 1);
  });
});

describe("relaunchRun", () => {
  test("retoma la sesión cuando se puede", async () => {
    const parent = await seedRun({ status: "failed" });

    const result = await relaunchRun(parent.id);

    assert.equal(result.resumed, true);
    assert.equal(result.reason, null);
    const child = await db.taskRun.findUniqueOrThrow({ where: { id: result.runId } });
    assert.equal(child.resumedFromId, parent.id);
    assert.equal(child.followUpPrompt, null, "no hay instrucciones nuevas: solo seguir");
  });

  /**
   * Al revés que continueRun: un reintento por cuota quiere que la tarea avance,
   * y empezar de cero sigue siendo avanzar. Lo que no puede es callárselo.
   */
  test("empieza de cero si no puede retomar, y dice por qué", async () => {
    const parent = await seedRun({ status: "failed", sessionId: null });

    const result = await relaunchRun(parent.id);

    assert.equal(result.resumed, false);
    assert.match(result.reason ?? "", /sesión/);
    const child = await db.taskRun.findUniqueOrThrow({ where: { id: result.runId } });
    assert.equal(child.resumedFromId, null, "sin sesión, la run nueva no encadena con nadie");
  });
});

describe("rutas de continuación", () => {
  test("GET /runs/:id/resume dice si se puede y por qué no", async () => {
    const run = await seedRun();
    const ok = await app.inject({ method: "GET", url: `/runs/${run.id}/resume` });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json(), { canResume: true, reason: null, sessionId: "sess_abc" });

    const sinSesion = await seedRun({ sessionId: null });
    const no = await app.inject({ method: "GET", url: `/runs/${sinSesion.id}/resume` });
    assert.equal(no.json().canResume, false);
    assert.match(no.json().reason, /sesión/);
  });

  test("GET /runs/:id/resume de una run inexistente es un 404", async () => {
    const res = await app.inject({ method: "GET", url: "/runs/no-existe/resume" });
    assert.equal(res.statusCode, 404);
  });

  test("POST /runs/:id/resume encadena la continuación", async () => {
    const parent = await seedRun();

    const res = await app.inject({
      method: "POST",
      url: `/runs/${parent.id}/resume`,
      payload: { prompt: "Añade un test del caso vacío." },
    });

    assert.equal(res.statusCode, 200);
    const child = await db.taskRun.findUniqueOrThrow({ where: { id: res.json().runId } });
    assert.equal(child.resumedFromId, parent.id);
    assert.equal(child.followUpPrompt, "Añade un test del caso vacío.");
  });

  test("POST /runs/:id/resume sin poder retomar es un 400 con el motivo", async () => {
    const parent = await seedRun({ sessionId: null });

    const res = await app.inject({
      method: "POST",
      url: `/runs/${parent.id}/resume`,
      payload: { prompt: "Cambia esto" },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /sesión/);
    assert.equal(await db.taskRun.count(), 1);
  });

  test("POST /runs/:id/resume sin instrucciones no lanza nada", async () => {
    const parent = await seedRun();

    const res = await app.inject({
      method: "POST",
      url: `/runs/${parent.id}/resume`,
      payload: { prompt: "   " },
    });

    assert.equal(res.statusCode, 400);
    assert.equal(await db.taskRun.count(), 1);
  });
});

describe("GET /runs?endedAfter", () => {
  /**
   * Es lo que hace posible repescar los avisos perdidos: el SSE no reemite
   * nada, así que al reconectar el navegador pregunta qué terminó desde la
   * última vez que supo algo.
   */
  async function seedEnded(endedAt: Date, status = "succeeded"): Promise<string> {
    const base = await seedRun();
    const run = await db.taskRun.update({
      where: { id: base.id },
      data: { status, endedAt },
    });
    return run.id;
  }

  test("devuelve solo lo que terminó después del instante dado", async () => {
    const vieja = await seedEnded(new Date("2026-08-27T10:00:00Z"));
    const nueva = await seedEnded(new Date("2026-08-27T12:00:00Z"));

    const res = await app.inject({
      method: "GET",
      url: "/runs?endedAfter=2026-08-27T11:00:00.000Z",
    });

    assert.equal(res.statusCode, 200);
    const ids = res.json().runs.map((run: { id: string }) => run.id);
    assert.deepEqual(ids, [nueva]);
    assert.ok(!ids.includes(vieja));
  });

  test("el instante exacto no se repite: es estrictamente posterior", async () => {
    const justo = new Date("2026-08-27T12:00:00Z");
    await seedEnded(justo);

    const res = await app.inject({
      method: "GET",
      url: `/runs?endedAfter=${justo.toISOString()}`,
    });

    assert.deepEqual(res.json().runs, [], "si no, cada reconexión reavisaría de la última");
  });

  test("una run sin terminar no aparece", async () => {
    const base = await seedRun();
    await db.taskRun.update({
      where: { id: base.id },
      data: { status: "running", endedAt: null },
    });

    const res = await app.inject({
      method: "GET",
      url: "/runs?endedAfter=2020-01-01T00:00:00.000Z",
    });

    assert.deepEqual(res.json().runs, []);
  });

  test("se combina con los demás filtros", async () => {
    await seedEnded(new Date("2026-08-27T12:00:00Z"), "succeeded");
    const fallida = await seedEnded(new Date("2026-08-27T12:30:00Z"), "failed");

    const res = await app.inject({
      method: "GET",
      url: "/runs?endedAfter=2026-08-27T11:00:00.000Z&status=failed",
    });

    assert.deepEqual(
      res.json().runs.map((run: { id: string }) => run.id),
      [fallida],
    );
  });

  test("una fecha ilegible es un 400, no un 500", async () => {
    const res = await app.inject({ method: "GET", url: "/runs?endedAfter=ayer" });
    assert.equal(res.statusCode, 400);
  });
});
