// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { buildApp } from "../app.js";
import { config } from "../config.js";
import { db } from "../db.js";
import {
  createSnapshot,
  expiredSnapshots,
  isSnapshotName,
  pruneSnapshots,
  snapshotName,
} from "./snapshot.js";

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

describe("snapshotName", () => {
  test("ordena alfabéticamente igual que cronológicamente", () => {
    const antes = snapshotName(new Date(2026, 7, 27, 9, 5, 3));
    const despues = snapshotName(new Date(2026, 7, 27, 11, 34, 0));
    const otroMes = snapshotName(new Date(2026, 8, 1, 0, 0, 0));

    // De esto depende la poda: ordena por nombre para saber cuál es la vieja.
    assert.ok(antes < despues);
    assert.ok(despues < otroMes);
  });

  test("rellena con ceros para que no se descoloque el orden", () => {
    assert.equal(snapshotName(new Date(2026, 0, 2, 3, 4, 5)), "cockpit-2026-01-02-030405.db");
  });

  test("lo que genera lo reconoce como suyo", () => {
    assert.ok(isSnapshotName(snapshotName(new Date())));
    assert.ok(!isSnapshotName("dev.db"));
    assert.ok(!isSnapshotName("cockpit-notas.txt"));
  });
});

describe("expiredSnapshots", () => {
  const names = [
    "cockpit-2026-08-25-100000.db",
    "cockpit-2026-08-26-100000.db",
    "cockpit-2026-08-27-100000.db",
  ];

  test("sobran las más viejas, se quedan las más nuevas", () => {
    assert.deepEqual(expiredSnapshots(names, 2), ["cockpit-2026-08-25-100000.db"]);
    assert.deepEqual(expiredSnapshots(names, 1), names.slice(0, 2));
  });

  test("con sitio de sobra no sobra ninguna", () => {
    assert.deepEqual(expiredSnapshots(names, 5), []);
    assert.deepEqual(expiredSnapshots([], 5), []);
  });

  /**
   * `keep: 0` desactiva la copia automática. Interpretarlo como "no conserves
   * ninguna" borraría las que ya hubiera, que es justo lo contrario de lo que
   * quiere quien la desactiva.
   */
  test("desactivar la copia no borra las que ya tenías", () => {
    assert.deepEqual(expiredSnapshots(names, 0), []);
  });

  test("no toca ficheros que no son suyos", () => {
    const conIntrusos = [...names, "dev.db", "notas.txt", ".gitkeep"];
    assert.deepEqual(expiredSnapshots(conIntrusos, 1), names.slice(0, 2));
  });
});

describe("createSnapshot", () => {
  test("la copia es una BD de verdad y trae los datos", async () => {
    await db.agent.create({
      data: { name: "en la copia", role: "dev", model: "claude-sonnet-5", systemPrompt: "x" },
    });
    const target = path.join(tempDir("backups"), "copia.db");

    const snapshot = await createSnapshot(target);

    assert.ok(snapshot.sizeBytes > 0);
    // Se abre con otro cliente: si el fichero estuviera a medias, esto revienta.
    const copia = new DatabaseSync(target);
    const rows = copia.prepare("SELECT name FROM Agent").all() as { name: string }[];
    copia.close();
    assert.deepEqual(rows.map((r) => r.name), ["en la copia"]);
  });

  test("crea el directorio si no existe", async () => {
    const target = path.join(tempDir("backups"), "sin", "crear", "copia.db");

    await createSnapshot(target);

    await fs.access(target);
  });

  // VACUUM INTO se niega si el destino existe, y una copia que falla la
  // segunda vez sería una copia que solo funciona el primer día.
  test("sobrescribir una copia anterior funciona", async () => {
    const target = path.join(tempDir("backups"), "copia.db");
    await createSnapshot(target);

    await db.agent.create({
      data: { name: "posterior", role: "dev", model: "claude-sonnet-5", systemPrompt: "x" },
    });
    await createSnapshot(target);

    const copia = new DatabaseSync(target);
    const count = copia.prepare("SELECT COUNT(*) c FROM Agent").get() as { c: number };
    copia.close();
    assert.equal(count.c, 1, "la segunda copia refleja el estado nuevo");
  });
});

describe("pruneSnapshots", () => {
  async function seedDir(names: string[]): Promise<string> {
    const dir = tempDir("prune");
    for (const name of names) await fs.writeFile(path.join(dir, name), "x");
    return dir;
  }

  test("borra las viejas y deja las nuevas", async () => {
    const dir = await seedDir([
      "cockpit-2026-08-25-100000.db",
      "cockpit-2026-08-26-100000.db",
      "cockpit-2026-08-27-100000.db",
    ]);

    const borradas = await pruneSnapshots(dir, 2);

    assert.equal(borradas, 1);
    assert.deepEqual((await fs.readdir(dir)).sort(), [
      "cockpit-2026-08-26-100000.db",
      "cockpit-2026-08-27-100000.db",
    ]);
  });

  test("no se lleva por delante nada que no haya puesto él", async () => {
    const dir = await seedDir([
      "cockpit-2026-08-25-100000.db",
      "cockpit-2026-08-26-100000.db",
      "dev.db",
      "importante.txt",
    ]);

    await pruneSnapshots(dir, 1);

    const quedan = (await fs.readdir(dir)).sort();
    assert.ok(quedan.includes("dev.db"), "esa era la BD de verdad");
    assert.ok(quedan.includes("importante.txt"));
  });

  test("un directorio que no existe no es un error", async () => {
    assert.equal(await pruneSnapshots(path.join(tempDir("vacio"), "nope"), 3), 0);
  });
});

describe("GET /backup", () => {
  test("devuelve una BD descargable y utilizable", async () => {
    await db.agent.create({
      data: { name: "descargado", role: "dev", model: "claude-sonnet-5", systemPrompt: "x" },
    });

    const res = await app.inject({ method: "GET", url: "/backup" });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-disposition"] as string, /attachment; filename="cockpit-/);

    // El cuerpo tiene que ser un SQLite de verdad, no un JSON de error.
    const target = path.join(tempDir("descarga"), "bajada.db");
    await fs.writeFile(target, res.rawPayload);
    const copia = new DatabaseSync(target);
    const rows = copia.prepare("SELECT name FROM Agent").all() as { name: string }[];
    copia.close();
    assert.deepEqual(rows.map((r) => r.name), ["descargado"]);
  });

  test("no deja temporales tirados", async () => {
    const antes = (await fs.readdir(os.tmpdir())).filter((n) =>
      n.startsWith("claude-cockpit-"),
    );

    await app.inject({ method: "GET", url: "/backup" });
    // El borrado va en el 'close' del stream, que ocurre tras enviar.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const despues = (await fs.readdir(os.tmpdir())).filter((n) =>
      n.startsWith("claude-cockpit-"),
    );
    assert.deepEqual(despues, antes);
  });
});
