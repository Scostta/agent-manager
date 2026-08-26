// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { SKILLS_DIR, assertUsingTestDb, closeDb, resetDb } from "../test/harness.js";

import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../config.js";
import { db } from "../db.js";
import { scanSkills, watchSkills } from "./scanner.js";

import type { FSWatcher } from "chokidar";

assertUsingTestDb(config.databaseUrl);

async function writeSkill(
  dirName: string,
  frontmatter: string,
  body = "Contenido de la skill.",
): Promise<string> {
  const dir = path.join(SKILLS_DIR, dirName);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  await fs.writeFile(filePath, `---\n${frontmatter}\n---\n\n${body}\n`, "utf8");
  return filePath;
}

async function emptySkillsDir(): Promise<void> {
  for (const entry of await fs.readdir(SKILLS_DIR)) {
    await fs.rm(path.join(SKILLS_DIR, entry), { recursive: true, force: true });
  }
}

before(() => resetDb());

beforeEach(async () => {
  await emptySkillsDir();
  await resetDb();
});

after(() => closeDb());

describe("scanSkills", () => {
  test("indexa el frontmatter y guarda ruta y hash, no el contenido", async () => {
    const filePath = await writeSkill(
      "revisar-pr",
      'name: revisar-pr\ndescription: Revisa un PR\ntags: ["git", "review"]',
    );

    assert.equal(await scanSkills(), 1);

    const skill = await db.skill.findUniqueOrThrow({ where: { name: "revisar-pr" } });
    assert.equal(skill.description, "Revisa un PR");
    assert.deepEqual(JSON.parse(skill.tags), ["git", "review"]);
    assert.equal(skill.filePath, filePath);
    assert.match(skill.contentHash, /^[0-9a-f]{64}$/);
  });

  test("un frontmatter roto no tumba el escaneo del resto", async () => {
    // gray-matter lanza con esto; el scanner tiene que loggear y seguir.
    await writeSkill("rota", 'name: "sin cerrar\ndescription: [1, 2');
    await writeSkill("buena", "name: buena\ndescription: Esta sí");

    const indexed = await scanSkills();

    assert.equal(indexed, 1);
    assert.equal(await db.skill.count(), 1);
    assert.ok(await db.skill.findUnique({ where: { name: "buena" } }));
  });

  test("sin name en el frontmatter usa el nombre de la carpeta", async () => {
    await writeSkill("desplegar-web", "description: Sin name");

    await scanSkills();

    assert.ok(await db.skill.findUnique({ where: { name: "desplegar-web" } }));
  });

  test("reindexar actualiza el hash cuando cambia el fichero", async () => {
    const filePath = await writeSkill("iterativa", "name: iterativa\ndescription: v1");
    await scanSkills();
    const before = await db.skill.findUniqueOrThrow({ where: { name: "iterativa" } });

    await fs.writeFile(filePath, "---\nname: iterativa\ndescription: v2\n---\n\nOtra cosa.\n");
    await scanSkills();

    const after = await db.skill.findUniqueOrThrow({ where: { name: "iterativa" } });
    assert.equal(after.description, "v2");
    assert.notEqual(after.contentHash, before.contentHash);
    assert.equal(await db.skill.count(), 1, "no debe duplicar la fila");
  });

  test("una skill borrada del disco deja de estar indexada", async () => {
    await writeSkill("efimera", "name: efimera\ndescription: Ya no estará");
    await writeSkill("permanente", "name: permanente\ndescription: Sigue");
    await scanSkills();

    await fs.rm(path.join(SKILLS_DIR, "efimera"), { recursive: true, force: true });
    await scanSkills();

    assert.equal(await db.skill.count(), 1);
    assert.equal(await db.skill.findUnique({ where: { name: "efimera" } }), null);
  });

  test("no entra en node_modules ni en .git", async () => {
    await writeSkill(path.join("node_modules", "paquete"), "name: de-dependencia");
    await writeSkill(path.join(".git", "hooks"), "name: de-git");
    await writeSkill("propia", "name: propia");

    assert.equal(await scanSkills(), 1);
    assert.equal(await db.skill.count(), 1);
  });
});

describe("watchSkills", () => {
  let watcher: FSWatcher | null = null;

  after(async () => {
    await watcher?.close();
  });

  test("reindexa un SKILL.md creado con la API en marcha", async () => {
    // El bug real: chokidar 4 dejó de aceptar globs y el watcher no vigilaba
    // nada, así que editar una skill en disco no se enteraba nadie.
    watcher = watchSkills();
    await onceReady(watcher);

    await writeSkill("en-caliente", "name: en-caliente\ndescription: Recién creada");

    const skill = await waitFor(() =>
      db.skill.findUnique({ where: { name: "en-caliente" } }),
    );
    assert.equal(skill?.description, "Recién creada");
  });
});

function onceReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve) => watcher.on("ready", () => resolve()));
}

/** Espera a que el watcher haya hecho su trabajo, sin dormir a ciegas. */
async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`El watcher no reaccionó en ${timeoutMs} ms`);
}
