// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb } from "../test/harness.js";

import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../app.js";
import { config } from "../config.js";
import { db } from "../db.js";

import type { FastifyInstance } from "fastify";

assertUsingTestDb(config.databaseUrl);

let app: FastifyInstance;

before(async () => {
  app = await buildApp({ logger: false });
});

beforeEach(() => resetDb());

after(async () => {
  await app.close();
  await closeDb();
});

const BASE = {
  name: "revisor",
  role: "Revisa PRs",
  model: "claude-sonnet-5",
  systemPrompt: "Revisa y comenta.",
};

async function create(body: Record<string, unknown> = {}) {
  const res = await app.inject({ method: "POST", url: "/agents", payload: { ...BASE, ...body } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

describe("herramientas del agente", () => {
  test("por defecto no hay restricción, como han corrido siempre", async () => {
    const agent = await create();

    assert.deepEqual(agent.allowedTools, []);
    assert.deepEqual(agent.disallowedTools, []);

    const row = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    assert.equal(row.allowedTools, null, "null, no '[]': es lo que el executor lee como 'todas'");
    assert.equal(row.disallowedTools, null);
  });

  test("las listas se guardan como JSON y vuelven como arrays", async () => {
    const agent = await create({ allowedTools: ["Read", "Glob", "Grep"] });

    assert.deepEqual(agent.allowedTools, ["Read", "Glob", "Grep"]);

    const row = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    assert.equal(row.allowedTools, '["Read","Glob","Grep"]');
  });

  test("una lista vacía se guarda como null, no como lista vacía", async () => {
    // Un '[]' en BD sería "ninguna herramienta" para el executor: el agente
    // quedaría mirando el repo sin poder tocarlo.
    const agent = await create({ allowedTools: [], disallowedTools: [] });

    const row = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    assert.equal(row.allowedTools, null);
    assert.equal(row.disallowedTools, null);
    assert.deepEqual(agent.allowedTools, []);
  });

  test("los duplicados y los espacios se limpian al guardar", async () => {
    const agent = await create({ allowedTools: [" Read ", "Read", "Glob"] });
    assert.deepEqual(agent.allowedTools, ["Read", "Glob"]);
  });

  test("acepta patrones del CLI tal cual", async () => {
    const agent = await create({ allowedTools: ["Bash(git *)", "Read"] });
    assert.deepEqual(agent.allowedTools, ["Bash(git *)", "Read"]);
  });

  test("un nombre vacío no pasa", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/agents",
      payload: { ...BASE, allowedTools: ["Read", ""] },
    });
    assert.equal(res.statusCode, 400);
  });

  describe("PATCH", () => {
    test("mandar una lista vacía quita la restricción", async () => {
      const agent = await create({ allowedTools: ["Read"] });

      const res = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}`,
        payload: { allowedTools: [] },
      });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json().allowedTools, []);
      const row = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
      assert.equal(row.allowedTools, null);
    });

    test("no mandar el campo lo deja como estaba", async () => {
      const agent = await create({ allowedTools: ["Read"] });

      const res = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}`,
        payload: { role: "Otro rol" },
      });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json().allowedTools, ["Read"], "un PATCH parcial no borra permisos");
    });

    test("las dos listas se pueden combinar", async () => {
      const agent = await create();

      const res = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}`,
        payload: { allowedTools: ["Read", "Bash"], disallowedTools: ["Bash"] },
      });

      assert.deepEqual(res.json().allowedTools, ["Read", "Bash"]);
      assert.deepEqual(res.json().disallowedTools, ["Bash"]);
    });
  });

  test("GET /agents devuelve las listas ya parseadas", async () => {
    await create({ allowedTools: ["Read"] });

    const res = await app.inject({ method: "GET", url: "/agents" });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json()[0].allowedTools, ["Read"]);
  });
});
