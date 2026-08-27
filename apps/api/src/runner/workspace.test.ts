import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { injectWorkspaceResources, setupWorkspace } from "./workspace.js";

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

describe("inyección de CLAUDE.md", () => {
  async function inject(workspacePath: string, sections: (string | null)[]): Promise<string> {
    await injectWorkspaceResources({
      workspacePath,
      agentSkills: [],
      claudeMdSections: sections,
    });
    return fs.readFile(path.join(workspacePath, "CLAUDE.md"), "utf8");
  }

  async function emptyWorkspace(name: string): Promise<string> {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  test("el global entra en el workspace, que es lo que no hacía antes", async () => {
    const ws = await emptyWorkspace("solo-global");

    const written = await inject(ws, ["Convenciones de todos mis proyectos."]);

    assert.match(written, /Convenciones de todos mis proyectos\./);
  });

  test("global primero y proyecto después, para poder matizarlo", async () => {
    const ws = await emptyWorkspace("orden");

    const written = await inject(ws, ["SOY-EL-GLOBAL", "SOY-EL-PROYECTO"]);

    assert.ok(
      written.indexOf("SOY-EL-GLOBAL") < written.indexOf("SOY-EL-PROYECTO"),
      "lo específico va después de lo general",
    );
  });

  test("no machaca el CLAUDE.md que ya traiga el repo", async () => {
    const ws = await emptyWorkspace("con-repo-md");
    await fs.writeFile(path.join(ws, "CLAUDE.md"), "# Del repo\n\nNo me borres.\n");

    const written = await inject(ws, ["Del cockpit"]);

    assert.match(written, /No me borres\./);
    assert.match(written, /Del cockpit/);
  });

  /**
   * Una continuación reinyecta sobre el workspace del padre. Si cada sección
   * llevara su propio marcador, reinyectar solo reemplazaría la primera y la
   * otra se duplicaría en cada vuelta.
   */
  test("reinyectar reemplaza lo del cockpit en vez de acumularlo", async () => {
    const ws = await emptyWorkspace("idempotente");
    await fs.writeFile(path.join(ws, "CLAUDE.md"), "# Del repo\n");

    await inject(ws, ["GLOBAL-V1", "PROYECTO-V1"]);
    const written = await inject(ws, ["GLOBAL-V2", "PROYECTO-V2"]);

    assert.equal(written.match(/GLOBAL-V1/g), null, "la versión vieja no se queda");
    assert.equal(written.match(/PROYECTO-V1/g), null);
    assert.equal(written.match(/GLOBAL-V2/g)?.length, 1, "y la nueva aparece una sola vez");
    assert.equal(written.match(/PROYECTO-V2/g)?.length, 1);
    assert.match(written, /# Del repo/, "lo del repo sobrevive a las reinyecciones");
  });

  test("sin nada que inyectar no se crea el fichero", async () => {
    const ws = await emptyWorkspace("sin-nada");

    await injectWorkspaceResources({
      workspacePath: ws,
      agentSkills: [],
      // null cuando no hay global, "" cuando el documento existe pero está vacío.
      claudeMdSections: [null, "   "],
    });

    await assert.rejects(() => fs.access(path.join(ws, "CLAUDE.md")));
  });

  test("si solo hay uno de los dos, no deja separadores sueltos", async () => {
    const ws = await emptyWorkspace("solo-proyecto");

    const written = await inject(ws, [null, "Solo el del proyecto"]);

    assert.ok(!written.includes("---\n\n---"), "nada de bloques vacíos entre separadores");
  });
});
