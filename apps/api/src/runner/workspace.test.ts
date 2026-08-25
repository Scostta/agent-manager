import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setupWorkspace } from "./workspace.js";

import type { Project, TaskRun } from "@prisma/client";

let root: string;

/** Un proyecto en modo copy: lo mínimo que mira `setupWorkspace`. */
function copyProject(repoPath: string): Project {
  return { workspaceStrategy: "copy", repoPath } as Project;
}

function run(id: string): TaskRun {
  return { id, taskId: "task-1" } as TaskRun;
}

async function tree(dir: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), rel);
      else found.push(rel);
    }
  }
  await walk(dir, "");
  return found.sort();
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-ws-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("setupWorkspace en modo copy", () => {
  test("no copia secretos ni bases de datos locales al sandbox del agente", async () => {
    // El agente puede leer cualquier cosa del workspace y vuelca lo que lee al
    // log: copiar el .env del proyecto le entrega sus credenciales.
    const source = path.join(root, "secretos-src");
    await fs.mkdir(path.join(source, "prisma"), { recursive: true });
    await fs.writeFile(path.join(source, ".env"), "ANTHROPIC_API_KEY=sk-ant-secreto");
    await fs.writeFile(path.join(source, ".env.local"), "OTRO=secreto");
    await fs.writeFile(path.join(source, ".env.example"), "ANTHROPIC_API_KEY=");
    await fs.writeFile(path.join(source, "prisma", "dev.db"), "sqlite");
    await fs.writeFile(path.join(source, "app.sqlite3"), "sqlite");
    await fs.writeFile(path.join(source, "index.js"), "console.log(1)");

    const { workspacePath } = await setupWorkspace(
      copyProject(source),
      run("secretos"),
      path.join(root, "secretos-ws"),
    );

    assert.deepEqual(await tree(workspacePath), [".env.example", "index.js"]);
  });

  test("excluye node_modules y demás carpetas pesadas", async () => {
    const source = path.join(root, "pesadas-src");
    await fs.mkdir(path.join(source, "node_modules", "left-pad"), { recursive: true });
    await fs.mkdir(path.join(source, "src"), { recursive: true });
    await fs.writeFile(path.join(source, "node_modules", "left-pad", "index.js"), "");
    await fs.writeFile(path.join(source, "src", "main.ts"), "export {}");

    const { workspacePath } = await setupWorkspace(
      copyProject(source),
      run("pesadas"),
      path.join(root, "pesadas-ws"),
    );

    assert.deepEqual(await tree(workspacePath), ["src/main.ts"]);
  });

  test("con el root de workspaces dentro del propio repo no se copia a sí mismo", async () => {
    // WORKSPACES_ROOT por defecto es ./workspaces, dentro del proyecto: sin la
    // exclusión, la copia se copiaría dentro de sí misma sin parar.
    const source = path.join(root, "anidado-src");
    await fs.mkdir(path.join(source, "src"), { recursive: true });
    await fs.writeFile(path.join(source, "src", "a.ts"), "export {}");
    const workspacesRoot = path.join(source, "workspaces");
    await fs.mkdir(workspacesRoot, { recursive: true });
    await fs.writeFile(path.join(workspacesRoot, "basura-de-otra-run.txt"), "x");

    const { workspacePath } = await setupWorkspace(
      copyProject(source),
      run("anidado"),
      workspacesRoot,
    );

    assert.deepEqual(await tree(workspacePath), ["src/a.ts"]);
  });

  test("el modo copy no devuelve rama: no hay nada que mergear", async () => {
    const source = path.join(root, "rama-src");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "README.md"), "# x");

    const result = await setupWorkspace(
      copyProject(source),
      run("rama"),
      path.join(root, "rama-ws"),
    );

    assert.equal(result.branchName, null);
    assert.ok(result.workspacePath.includes("task-1"));
  });
});
