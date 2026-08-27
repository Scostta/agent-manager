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

function create(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/claude-md", payload });
}

describe("scope del CLAUDE.md", () => {
  test("se puede crear el global", async () => {
    const res = await create({ scope: "global", content: "# Global" });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().scope, "global");
  });

  /**
   * Con dos globales y sin un orden visible en la UI, qué acaba leyendo el
   * agente sería un misterio. Mejor un 400 que diga qué hacer.
   */
  test("un segundo global se rechaza y dice que edites el que hay", async () => {
    await create({ scope: "global", content: "# El bueno" });

    const res = await create({ scope: "global", content: "# El otro" });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /Edita ese/);
    assert.equal(await db.claudeMd.count({ where: { scope: "global" } }), 1);
  });

  test("varios de proyecto sí conviven: uno por proyecto", async () => {
    await create({ scope: "project", content: "# Uno" });
    const res = await create({ scope: "project", content: "# Otro" });

    assert.equal(res.statusCode, 200);
    assert.equal(await db.claudeMd.count(), 2);
  });

  // El systemPrompt del agente ya es el sitio de las instrucciones de un
  // agente; dos sitios para lo mismo solo generan la duda de cuál gana.
  test("el scope 'agent' ya no existe", async () => {
    const res = await create({ scope: "agent", content: "# Del agente" });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /scope/);
  });

  describe("PATCH", () => {
    test("pasar otro documento a global también se rechaza si ya hay uno", async () => {
      await create({ scope: "global", content: "# El bueno" });
      const otro = (await create({ scope: "project", content: "# De proyecto" })).json();

      const res = await app.inject({
        method: "PATCH",
        url: `/claude-md/${otro.id}`,
        payload: { scope: "global" },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(await db.claudeMd.count({ where: { scope: "global" } }), 1);
    });

    test("editar el global que ya existe no choca consigo mismo", async () => {
      const global = (await create({ scope: "global", content: "# v1" })).json();

      const res = await app.inject({
        method: "PATCH",
        url: `/claude-md/${global.id}`,
        payload: { scope: "global", content: "# v2" },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().content, "# v2");
    });

    test("editar solo el contenido no toca el ámbito", async () => {
      const global = (await create({ scope: "global", content: "# v1" })).json();

      const res = await app.inject({
        method: "PATCH",
        url: `/claude-md/${global.id}`,
        payload: { content: "# v2" },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().scope, "global");
    });
  });

  test("borrar el global deja hueco para otro", async () => {
    const global = (await create({ scope: "global", content: "# El bueno" })).json();
    await app.inject({ method: "DELETE", url: `/claude-md/${global.id}` });

    const res = await create({ scope: "global", content: "# El nuevo" });

    assert.equal(res.statusCode, 200);
  });
});
