// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { buildApp } from "../app.js";
import { config } from "../config.js";
import { db } from "../db.js";
import matter from "gray-matter";

import {
  SkillEditError,
  assertKeepsName,
  assertParseable,
  assertValidSkillName,
  isInsideSkillsPaths,
  skillTemplate,
} from "./edit.js";

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

const SKILL = `---
name: mi-skill
description: Hace algo
tags: [testing]
---

# Contenido
`;

/** Crea el SKILL.md en disco dentro de SKILLS_PATHS y su fila en la BD. */
async function seedSkill(content = SKILL): Promise<{ id: string; filePath: string }> {
  const dir = path.join(config.skillsPaths[0], `mi-skill-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  await fs.writeFile(filePath, content, "utf8");

  const skill = await db.skill.create({
    data: {
      name: "mi-skill",
      description: "Hace algo",
      filePath,
      contentHash: "viejo",
      scope: "user",
      tags: JSON.stringify(["testing"]),
    },
  });
  return { id: skill.id, filePath };
}

describe("isInsideSkillsPaths", () => {
  const roots = [path.resolve("/tmp/skills"), path.resolve("/tmp/otras")];

  test("acepta lo que cuelga de una raíz configurada", () => {
    assert.ok(isInsideSkillsPaths(path.resolve("/tmp/skills/foo/SKILL.md"), roots));
    assert.ok(isInsideSkillsPaths(path.resolve("/tmp/otras/bar/SKILL.md"), roots));
  });

  /**
   * El `filePath` sale de la BD, y la BD la puebla el scanner — pero una fila
   * tocada a mano convertiría el endpoint en un "escribe donde quieras" con los
   * permisos de la API.
   */
  test("rechaza lo de fuera, incluido lo que se escapa con ..", () => {
    assert.ok(!isInsideSkillsPaths(path.resolve("/tmp/otro-sitio/SKILL.md"), roots));
    assert.ok(!isInsideSkillsPaths(path.resolve("/tmp/skills/../fuera/SKILL.md"), roots));
    assert.ok(!isInsideSkillsPaths(path.resolve("/etc/passwd"), roots));
  });

  test("un prefijo parecido no cuela", () => {
    assert.ok(!isInsideSkillsPaths(path.resolve("/tmp/skills-de-otro/SKILL.md"), roots));
  });
});

describe("validación del contenido", () => {
  test("un frontmatter roto se rechaza al guardar, no después", () => {
    assert.throws(
      () => assertParseable("---\nname: [sin cerrar\n---\n"),
      /frontmatter no es YAML válido/,
    );
  });

  test("sin frontmatter no pasa nada: es markdown válido", () => {
    assert.doesNotThrow(() => assertParseable("# Solo markdown"));
  });

  // El `name` es la clave del upsert del scanner: cambiarlo crearía una
  // segunda fila apuntando al mismo fichero.
  test("cambiar el nombre desde el editor se rechaza", () => {
    assert.throws(
      () => assertKeepsName("---\nname: otro\n---\n", "mi-skill"),
      /dejaría dos entradas/,
    );
  });

  test("mantenerlo o no ponerlo está bien", () => {
    assert.doesNotThrow(() => assertKeepsName("---\nname: mi-skill\n---\n", "mi-skill"));
    assert.doesNotThrow(() => assertKeepsName("# Sin frontmatter", "mi-skill"));
  });
});

describe("PATCH /skills/:id/content", () => {
  test("escribe en disco y reindexa sin esperar al watcher", async () => {
    const { id, filePath } = await seedSkill();
    const nuevo = `---
name: mi-skill
description: Ahora hace otra cosa
tags: [testing, docs]
---

# Contenido nuevo
`;

    const res = await app.inject({
      method: "PATCH",
      url: `/skills/${id}/content`,
      payload: { content: nuevo },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(await fs.readFile(filePath, "utf8"), nuevo);

    // La respuesta ya trae los metadatos nuevos: si esperásemos a chokidar, la
    // UI pintaría los viejos durante ese instante.
    assert.equal(res.json().description, "Ahora hace otra cosa");
    assert.deepEqual(res.json().tags, ["testing", "docs"]);
    assert.notEqual(res.json().contentHash, "viejo");
  });

  test("un frontmatter roto no llega a tocar el fichero", async () => {
    const { id, filePath } = await seedSkill();

    const res = await app.inject({
      method: "PATCH",
      url: `/skills/${id}/content`,
      payload: { content: "---\ntags: [sin cerrar\n---\n" },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /YAML/);
    assert.equal(await fs.readFile(filePath, "utf8"), SKILL, "el fichero se queda como estaba");
  });

  test("no escribe fuera de SKILLS_PATHS aunque lo diga la BD", async () => {
    const fuera = path.join(tempDir("fuera"), "SKILL.md");
    await fs.writeFile(fuera, SKILL, "utf8");
    const skill = await db.skill.create({
      data: {
        name: "intrusa",
        description: "",
        filePath: fuera,
        contentHash: "x",
        scope: "user",
        tags: "[]",
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/skills/${skill.id}/content`,
      payload: { content: "# machacado" },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /fuera de SKILLS_PATHS/);
    assert.equal(await fs.readFile(fuera, "utf8"), SKILL, "no se ha tocado");
  });

  test("una skill que no existe es un 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/skills/no-existe/content",
      payload: { content: "# hola" },
    });
    assert.equal(res.statusCode, 404);
  });

  test("un body sin content es un 400, no un 500", async () => {
    const { id } = await seedSkill();
    const res = await app.inject({ method: "PATCH", url: `/skills/${id}/content`, payload: {} });
    assert.equal(res.statusCode, 400);
  });
});

describe("assertValidSkillName", () => {
  test("acepta kebab-case", () => {
    for (const name of ["revisor", "revisar-migraciones", "sql2", "a"]) {
      assert.doesNotThrow(() => assertValidSkillName(name));
    }
  });

  // El motivo de que esta guarda exista: el nombre acaba en un path.join
  // dentro de .claude/skills del workspace. Un separador o un ".." ahí
  // plantaría el symlink fuera del workspace.
  test("rechaza cualquier cosa que sea una ruta", () => {
    for (const name of ["../fuera", "a/b", "a\b", "..", ".", "C:/tmp/x"]) {
      assert.throws(() => assertValidSkillName(name), SkillEditError, name);
    }
  });

  test("rechaza mayúsculas, espacios y guiones sueltos", () => {
    for (const name of ["Revisor", "mi skill", "-x", "x-", "a--b", "ñ"]) {
      assert.throws(() => assertValidSkillName(name), SkillEditError, name);
    }
  });

  test("rechaza el vacío y lo demasiado largo", () => {
    assert.throws(() => assertValidSkillName(""), SkillEditError);
    assert.throws(() => assertValidSkillName("a".repeat(65)), SkillEditError);
    assert.doesNotThrow(() => assertValidSkillName("a".repeat(64)));
  });
});

describe("skillTemplate", () => {
  test("el frontmatter que genera es parseable e indexable", () => {
    const md = skillTemplate("revisar-migraciones", "Revisa migraciones de Prisma");
    assert.doesNotThrow(() => assertParseable(md));
    const { data } = matter(md);
    assert.equal(data.name, "revisar-migraciones");
    assert.equal(data.description, "Revisa migraciones de Prisma");
    assert.deepEqual(data.tags, []);
  });

  // Una descripción con dos puntos o comillas rompería el YAML, y la skill
  // quedaría creada en disco pero sin indexar.
  test("una descripción con caracteres de YAML no rompe el frontmatter", () => {
    for (const description of [
      "Hace esto: y lo otro",
      'Con "comillas" dentro',
      "Con 'simples' y # almohadilla",
      "Multi\nlínea",
    ]) {
      const md = skillTemplate("x", description);
      assert.doesNotThrow(() => assertParseable(md), description);
      assert.equal(matter(md).data.description, description);
    }
  });
});

describe("POST /skills", () => {
  test("crea el SKILL.md en SKILLS_ROOT y lo devuelve ya indexado", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/skills",
      payload: { name: "revisar-migraciones", description: "Revisa migraciones" },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.name, "revisar-migraciones");
    assert.deepEqual(body.tags, []);

    const expected = path.join(config.skillsRoot, "revisar-migraciones", "SKILL.md");
    assert.equal(path.resolve(body.filePath), path.resolve(expected));
    assert.match(await fs.readFile(expected, "utf8"), /name: revisar-migraciones/);

    // Indexada de verdad, no solo escrita: es lo que permite abrirla en el
    // editor inmediatamente después sin esperar a chokidar.
    const row = await db.skill.findUnique({ where: { name: "revisar-migraciones" } });
    assert.ok(row);
    assert.equal(row.contentHash.length, 64);
  });

  test("el nombre inválido se rechaza antes de tocar el disco", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/skills",
      payload: { name: "../fuera", description: "x" },
    });

    assert.equal(res.statusCode, 400);

    // Lo que de verdad hay que comprobar: que el ".." no haya escrito fuera de
    // la carpeta de skills.
    const escaped = path.join(config.skillsRoot, "..", "fuera");
    await assert.rejects(fs.access(escaped));
  });

  test("no pisa una skill que ya existe", async () => {
    const payload = { name: "duplicada", description: "primera" };
    assert.equal((await app.inject({ method: "POST", url: "/skills", payload })).statusCode, 201);

    const res = await app.inject({
      method: "POST",
      url: "/skills",
      payload: { name: "duplicada", description: "segunda" },
    });
    assert.equal(res.statusCode, 400);

    // Y la de verdad sigue intacta.
    const md = await fs.readFile(
      path.join(config.skillsRoot, "duplicada", "SKILL.md"),
      "utf8",
    );
    assert.match(md, /primera/);
  });

  // Una carpeta suelta en disco que la BD no conoce: sin la comprobación de
  // fs.access se machacaría sin avisar.
  test("no pisa un SKILL.md que está en disco pero no indexado", async () => {
    const dir = path.join(config.skillsRoot, "huerfana");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "contenido a mano", "utf8");

    const res = await app.inject({
      method: "POST",
      url: "/skills",
      payload: { name: "huerfana", description: "nueva" },
    });

    assert.equal(res.statusCode, 400);
    assert.equal(await fs.readFile(path.join(dir, "SKILL.md"), "utf8"), "contenido a mano");
  });

  test("la descripción es obligatoria", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/skills",
      payload: { name: "sin-descripcion", description: "   " },
    });
    assert.equal(res.statusCode, 400);
  });
});
