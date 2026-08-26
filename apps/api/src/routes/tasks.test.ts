// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../app.js";
import { config } from "../config.js";
import { db } from "../db.js";

import type { FastifyInstance } from "fastify";

assertUsingTestDb(config.databaseUrl);

let app: FastifyInstance;

before(async () => {
  // Sin logger y sin listen: `inject` mete la petición por dentro.
  app = await buildApp({ logger: false });
});

beforeEach(() => resetDb());

after(async () => {
  await app.close();
  await closeDb();
});

async function seedProject(): Promise<string> {
  const project = await db.project.create({
    data: { name: "demo", repoPath: tempDir("repo"), workspaceStrategy: "copy" },
  });
  return project.id;
}

async function seedAgent(): Promise<string> {
  const agent = await db.agent.create({
    data: { name: "agente", role: "dev", model: "claude-sonnet-5", systemPrompt: "haz" },
  });
  return agent.id;
}

describe("POST /tasks", () => {
  test("un body inválido sale como 400 con el detalle de Zod, no como 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId: await seedProject(), title: "" },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /title/);
  });

  test("nace bloqueada si depende de algo que no está hecho", async () => {
    const projectId = await seedProject();
    const base = await db.task.create({
      data: { projectId, title: "Base", description: "", status: "todo", position: 0 },
    });

    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { projectId, title: "Encima", dependsOn: [base.id] },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "blocked");
  });

  test("un ciclo se rechaza al guardar", async () => {
    const projectId = await seedProject();
    const a = await db.task.create({
      data: { projectId, title: "A", description: "", position: 0 },
    });
    const b = await db.task.create({
      data: {
        projectId,
        title: "B",
        description: "",
        position: 1,
        dependsOn: JSON.stringify([a.id]),
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/tasks/${a.id}`,
      payload: { dependsOn: [b.id] },
    });

    assert.equal(res.statusCode, 400);
  });
});

describe("POST /projects/:projectId/tasks/bulk", () => {
  test("resuelve las dependencias por índice y bloquea a quien toca", async () => {
    const projectId = await seedProject();

    const res = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/tasks/bulk`,
      payload: {
        tasks: [
          { title: "Andamiaje", description: "primero" },
          { title: "Parser", description: "segundo", dependsOn: [0] },
          { title: "CLI", description: "tercero", dependsOn: [1] },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const created = res.json();
    assert.equal(created.length, 3);

    const [andamiaje, parser, cli] = created;
    assert.deepEqual(JSON.parse(parser.dependsOn), [andamiaje.id]);
    assert.deepEqual(JSON.parse(cli.dependsOn), [parser.id]);

    const saved = await db.task.findMany({ orderBy: { position: "asc" } });
    assert.deepEqual(
      saved.map((task) => task.status),
      ["todo", "blocked", "blocked"],
      "solo la primera puede empezar",
    );
    assert.deepEqual(
      saved.map((task) => task.position),
      [0, 1, 2],
    );
  });

  test("una dependencia hacia adelante se descarta en vez de crear un ciclo", async () => {
    const projectId = await seedProject();

    const res = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/tasks/bulk`,
      payload: {
        tasks: [
          { title: "Primera", dependsOn: [1] },
          { title: "Segunda", dependsOn: [0] },
        ],
      },
    });

    const [primera, segunda] = res.json();
    assert.deepEqual(JSON.parse(primera.dependsOn), []);
    assert.deepEqual(JSON.parse(segunda.dependsOn), [primera.id]);
  });

  test("un proyecto que no existe es 404, no un 500 de Prisma", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/projects/no-existe/tasks/bulk",
      payload: { tasks: [{ title: "Algo" }] },
    });

    assert.equal(res.statusCode, 404);
  });
});

describe("POST /tasks/:id/run", () => {
  test("no lanza nada mientras falten dependencias, esté en la columna que esté", async () => {
    const projectId = await seedProject();
    const agentId = await seedAgent();
    const base = await db.task.create({
      data: { projectId, title: "Base sin terminar", description: "", position: 0 },
    });
    // A mano en 'todo': el guard no puede fiarse de la columna.
    const dependiente = await db.task.create({
      data: {
        projectId,
        title: "Dependiente",
        description: "",
        status: "todo",
        position: 1,
        assignedAgentId: agentId,
        dependsOn: JSON.stringify([base.id]),
      },
    });

    const res = await app.inject({ method: "POST", url: `/tasks/${dependiente.id}/run` });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /Base sin terminar/);
    assert.equal(await db.taskRun.count(), 0, "no se ha encolado ninguna run");
  });

  test("sin agente asignado tampoco se lanza", async () => {
    const projectId = await seedProject();
    const task = await db.task.create({
      data: { projectId, title: "Huérfana", description: "", position: 0 },
    });

    const res = await app.inject({ method: "POST", url: `/tasks/${task.id}/run` });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /agente/);
    assert.equal(await db.taskRun.count(), 0);
  });
});

describe("ciclo de vida de las dependencias", () => {
  test("pasar la dependencia a done desbloquea, pero no lanza", async () => {
    const projectId = await seedProject();
    const base = await db.task.create({
      data: { projectId, title: "Base", description: "", position: 0 },
    });
    const dependiente = await db.task.create({
      data: {
        projectId,
        title: "Dependiente",
        description: "",
        status: "blocked",
        position: 1,
        dependsOn: JSON.stringify([base.id]),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/tasks/${base.id}/move`,
      payload: { status: "done", position: 0 },
    });
    assert.equal(res.statusCode, 200);

    const after = await db.task.findUniqueOrThrow({ where: { id: dependiente.id } });
    assert.equal(after.status, "todo", "desbloquear no es lanzar");
  });

  test("borrar una dependencia no deja bloqueada para siempre a la que esperaba", async () => {
    const projectId = await seedProject();
    const base = await db.task.create({
      data: { projectId, title: "Base", description: "", position: 0 },
    });
    const dependiente = await db.task.create({
      data: {
        projectId,
        title: "Dependiente",
        description: "",
        status: "blocked",
        position: 1,
        dependsOn: JSON.stringify([base.id]),
      },
    });

    const res = await app.inject({ method: "DELETE", url: `/tasks/${base.id}` });
    assert.equal(res.statusCode, 200);

    const after = await db.task.findUniqueOrThrow({ where: { id: dependiente.id } });
    assert.deepEqual(JSON.parse(after.dependsOn), []);
    assert.equal(after.status, "todo");
  });
});
