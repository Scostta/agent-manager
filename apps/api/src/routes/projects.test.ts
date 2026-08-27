// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildApp } from "../app.js";
import { config } from "../config.js";
import { db } from "../db.js";
import { execGit } from "../lib/git.js";

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

async function exists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

describe("POST /projects", () => {
  test("crea la carpeta, deja el CLAUDE.md y arranca el repo con un commit", async () => {
    const repoPath = path.join(tempDir("alta"), "proyecto-nuevo");

    const res = await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: "proyecto-nuevo",
        description: "Un proyecto de prueba",
        repoPath,
        initGit: true,
        claudeMdContent: "# CLAUDE.md\n\nReglas del proyecto.\n",
      },
    });

    assert.equal(res.statusCode, 200);
    const project = res.json();

    // La estrategia se detecta DESPUÉS del git init; al revés, todo proyecto
    // nuevo se quedaría en 'copy' y sin worktrees para siempre.
    assert.equal(project.workspaceStrategy, "worktree");

    assert.ok(await exists(path.join(repoPath, ".git")));
    assert.equal(
      await fs.readFile(path.join(repoPath, "CLAUDE.md"), "utf8"),
      "# CLAUDE.md\n\nReglas del proyecto.\n",
    );

    // El commit inicial no es cosmético: sin HEAD, `git worktree add` falla y
    // el proyecto no podría lanzar ni una run.
    const log = await execGit(repoPath, ["log", "--oneline"]);
    assert.equal(log.trim().split("\n").length, 1);

    const claudeMd = await db.claudeMd.findUniqueOrThrow({
      where: { id: project.claudeMdId },
    });
    assert.equal(claudeMd.scope, "project");
    assert.equal(claudeMd.filePath, path.join(repoPath, "CLAUDE.md"));
  });

  test("sin git init la estrategia es copy", async () => {
    const repoPath = path.join(tempDir("alta"), "sin-git");

    const res = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "sin-git", repoPath, initGit: false },
    });

    assert.equal(res.json().workspaceStrategy, "copy");
    assert.equal(await exists(path.join(repoPath, ".git")), false);
  });

  test("una carpeta que ya es repo se da de alta tal cual", async () => {
    const repoPath = tempDir("ya-repo");
    await execGit(repoPath, ["init"]);

    const res = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "ya-repo", repoPath, initGit: true },
    });

    assert.equal(res.json().workspaceStrategy, "worktree");
    // Ya era repo: no se le mete un commit encima.
    await assert.rejects(() => execGit(repoPath, ["log", "--oneline"]));
  });

  test("la carpeta personal se rechaza sin tocar el disco", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "peligro", repoPath: os.homedir(), initGit: true },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /carpeta personal/);
    assert.equal(await db.project.count(), 0);
    assert.equal(
      await exists(path.join(os.homedir(), "CLAUDE.md")),
      false,
      "no debe haber escrito nada en la home",
    );
  });

  test("la raíz del disco también se rechaza", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "peligro", repoPath: path.parse(os.homedir()).root },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /raíz del disco/);
  });

  test("una ruta relativa se rechaza: repoPath es el cwd de cada run", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "relativa", repoPath: "./proyectos/algo" },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /absoluta/);
  });
});

describe("GET /fs/browse", () => {
  test("lista solo directorios y marca los que son repo", async () => {
    const root = tempDir("browse");
    await fs.mkdir(path.join(root, "con-repo"));
    await execGit(path.join(root, "con-repo"), ["init"]);
    await fs.mkdir(path.join(root, "sin-repo"));
    await fs.mkdir(path.join(root, ".oculta"));
    await fs.writeFile(path.join(root, "un-fichero.txt"), "no soy carpeta");

    const res = await app.inject({ method: "GET", url: `/fs/browse?path=${encodeURIComponent(root)}` });

    assert.equal(res.statusCode, 200);
    const listing = res.json();
    assert.deepEqual(
      listing.entries.map((entry: { name: string }) => entry.name),
      ["con-repo", "sin-repo"],
      "ni ficheros ni carpetas ocultas",
    );
    assert.equal(listing.entries[0].isGitRepo, true);
    assert.equal(listing.entries[1].isGitRepo, false);
    assert.equal(listing.separator, path.sep);
    assert.equal(listing.parent, path.dirname(root));
  });

  test("una carpeta que aún no existe no es un error: es la que vas a crear", async () => {
    const target = path.join(tempDir("browse"), "todavia-no");

    const res = await app.inject({
      method: "GET",
      url: `/fs/browse?path=${encodeURIComponent(target)}`,
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().exists, false);
    assert.deepEqual(res.json().entries, []);
  });
});

describe("GET /fs/claude-md", () => {
  test("devuelve el CLAUDE.md que ya vive en la carpeta", async () => {
    const root = tempDir("claude-md");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "# Ya existía\n", "utf8");

    const res = await app.inject({
      method: "GET",
      url: `/fs/claude-md?path=${encodeURIComponent(root)}`,
    });

    assert.deepEqual(res.json(), {
      exists: true,
      path: path.join(root, "CLAUDE.md"),
      content: "# Ya existía\n",
    });
  });

  test("si no hay ninguno lo dice, no falla", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/fs/claude-md?path=${encodeURIComponent(tempDir("claude-md"))}`,
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().exists, false);
    assert.equal(res.json().content, null);
  });

  test("una ruta relativa se rechaza", async () => {
    const res = await app.inject({ method: "GET", url: "/fs/claude-md?path=.%2Falgo" });
    assert.equal(res.statusCode, 400);
  });
});

describe("DELETE /projects/:id", () => {
  /**
   * Las tasks y las runs se van en cascada; el ClaudeMd no, porque la FK vive
   * en Project. Sin esto la fila sobrevivía al proyecto y se quedaba en el
   * editor como un documento "sin asignar" que ya no era de nadie.
   */
  test("se lleva el CLAUDE.md del proyecto, que no cae en cascada", async () => {
    const claudeMd = await db.claudeMd.create({
      data: { scope: "project", content: "# Del proyecto" },
    });
    const project = await db.project.create({
      data: {
        name: "con md",
        repoPath: tempDir("repo"),
        workspaceStrategy: "copy",
        claudeMdId: claudeMd.id,
      },
    });

    const res = await app.inject({ method: "DELETE", url: `/projects/${project.id}` });

    assert.equal(res.statusCode, 200);
    assert.equal(await db.claudeMd.count({ where: { id: claudeMd.id } }), 0);
  });

  test("no toca el global ni el de otro proyecto", async () => {
    const global = await db.claudeMd.create({
      data: { scope: "global", content: "# Global" },
    });
    const ajeno = await db.claudeMd.create({
      data: { scope: "project", content: "# De otro" },
    });
    await db.project.create({
      data: {
        name: "otro",
        repoPath: tempDir("otro"),
        workspaceStrategy: "copy",
        claudeMdId: ajeno.id,
      },
    });
    const project = await db.project.create({
      data: { name: "sin md", repoPath: tempDir("repo"), workspaceStrategy: "copy" },
    });

    await app.inject({ method: "DELETE", url: `/projects/${project.id}` });

    assert.equal(await db.claudeMd.count(), 2, "solo desaparece el del proyecto borrado");
    assert.ok(await db.claudeMd.findUnique({ where: { id: global.id } }));
  });

  test("el fichero en disco sobrevive: es del repo, no nuestro", async () => {
    const repoPath = tempDir("repo-con-md");
    const filePath = path.join(repoPath, "CLAUDE.md");
    await fs.writeFile(filePath, "# Convenciones del repo", "utf8");

    const claudeMd = await db.claudeMd.create({
      data: { scope: "project", content: "# Convenciones del repo", filePath },
    });
    const project = await db.project.create({
      data: {
        name: "con fichero",
        repoPath,
        workspaceStrategy: "copy",
        claudeMdId: claudeMd.id,
      },
    });

    await app.inject({ method: "DELETE", url: `/projects/${project.id}` });

    await fs.access(filePath); // lanza si lo hemos borrado
  });

  test("un proyecto que no existe es un 404", async () => {
    const res = await app.inject({ method: "DELETE", url: "/projects/no-existe" });
    assert.equal(res.statusCode, 404);
  });
});
