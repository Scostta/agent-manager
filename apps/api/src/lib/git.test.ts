import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MergeConflictError,
  addWorktree,
  branchCommitCount,
  branchExists,
  commitAll,
  currentBranch,
  diffWorktree,
  execGit,
  initRepo,
  isBranchMerged,
  isWorkingTreeClean,
  mergeBranch,
  removeWorktree,
  resolveBaseBranch,
  worktreeChanges,
} from "./git.js";

let root: string;
let repo: string;
let counter = 0;

/** Repo nuevo por test: el estado de git se contagia entre casos. */
async function freshRepo(): Promise<string> {
  const dir = path.join(root, `repo-${counter++}`);
  await fs.mkdir(dir, { recursive: true });
  await execGit(dir, ["init", "-q", "-b", "main", "."]);
  await execGit(dir, ["config", "user.email", "test@local"]);
  await execGit(dir, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(dir, "app.js"), "export const suma = (a, b) => a + b\n");
  await execGit(dir, ["add", "-A"]);
  await execGit(dir, ["commit", "-qm", "inicial"]);
  return dir;
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-git-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
  repo = await freshRepo();
});

describe("lectura del estado del repo", () => {
  test("la base es main cuando existe", async () => {
    assert.equal(await resolveBaseBranch(repo), "main");
    assert.equal(await currentBranch(repo), "main");
  });

  test("cae a master si el repo no usa main", async () => {
    await execGit(repo, ["branch", "-m", "main", "master"]);
    assert.equal(await resolveBaseBranch(repo), "master");
  });

  test("detecta si el árbol de trabajo está sucio", async () => {
    assert.equal(await isWorkingTreeClean(repo), true);
    await fs.writeFile(path.join(repo, "app.js"), "cambiado\n");
    assert.equal(await isWorkingTreeClean(repo), false);
  });

  test("branchExists no confunde una rama inexistente con un error", async () => {
    assert.equal(await branchExists(repo, "main"), true);
    assert.equal(await branchExists(repo, "cockpit/no-existe"), false);
  });
});

describe("worktree de una run", () => {
  test("el diff recoge lo que el agente dejó sin commitear, incluidos ficheros nuevos", async () => {
    // Claude Code no hace commit salvo que se lo pidas: comparar main...rama
    // devolvía vacío justo en el caso habitual.
    const wt = path.join(root, `wt-${counter++}`);
    await addWorktree(repo, wt, "cockpit/diff");
    await fs.writeFile(path.join(wt, "app.js"), "export const suma = (a, b) => a + b + 0\n");
    await fs.writeFile(path.join(wt, "NUEVO.md"), "# nuevo\n");

    const diff = await diffWorktree(wt, "main");
    assert.match(diff, /NUEVO\.md/, "el fichero nuevo debería salir en el diff");
    assert.match(diff, /app\.js/);
    assert.match(diff, /\+export const suma/);

    await removeWorktree(repo, wt, "cockpit/diff");
  });

  test("worktreeChanges separa commits de cambios sueltos", async () => {
    const wt = path.join(root, `wt-${counter++}`);
    await addWorktree(repo, wt, "cockpit/cambios");

    assert.deepEqual(await worktreeChanges(wt, "main"), { commits: 0, uncommitted: 0 });

    await fs.writeFile(path.join(wt, "a.md"), "a");
    await fs.writeFile(path.join(wt, "b.md"), "b");
    assert.deepEqual(await worktreeChanges(wt, "main"), { commits: 0, uncommitted: 2 });

    assert.equal(await commitAll(wt, "cockpit: prueba"), true);
    assert.deepEqual(await worktreeChanges(wt, "main"), { commits: 1, uncommitted: 0 });
    // Sin nada que commitear, commitAll no crea un commit vacío.
    assert.equal(await commitAll(wt, "cockpit: otra"), false);

    await removeWorktree(repo, wt, "cockpit/cambios");
  });

  test("branchCommitCount se lee del repo aunque el worktree ya no exista", async () => {
    const wt = path.join(root, `wt-${counter++}`);
    await addWorktree(repo, wt, "cockpit/contados");
    await fs.writeFile(path.join(wt, "c.md"), "c");
    await commitAll(wt, "cockpit: uno");
    await removeWorktree(repo, wt);

    assert.equal(await branchCommitCount(repo, "main", "cockpit/contados"), 1);
  });
});

describe("merge", () => {
  test("integra la rama y deja de contarse como pendiente", async () => {
    const wt = path.join(root, `wt-${counter++}`);
    await addWorktree(repo, wt, "cockpit/ok");
    await fs.writeFile(path.join(wt, "FEATURE.md"), "# feature\n");
    await commitAll(wt, "cockpit: feature");

    assert.equal(await isBranchMerged(repo, "cockpit/ok", "main"), false);
    await mergeBranch(repo, "cockpit/ok", "Merge run");
    assert.equal(await isBranchMerged(repo, "cockpit/ok", "main"), true);

    const merged = await fs.readFile(path.join(repo, "FEATURE.md"), "utf8");
    assert.match(merged, /# feature/);

    await removeWorktree(repo, wt, "cockpit/ok");
  });

  test("un conflicto aborta y deja el repo exactamente como estaba", async () => {
    const wt = path.join(root, `wt-${counter++}`);
    await addWorktree(repo, wt, "cockpit/conflicto");
    await fs.writeFile(path.join(wt, "app.js"), "version de la rama\n");
    await commitAll(wt, "cockpit: rama");

    await fs.writeFile(path.join(repo, "app.js"), "version de main\n");
    await execGit(repo, ["commit", "-qam", "cambio en main"]);
    const headBefore = await execGit(repo, ["rev-parse", "HEAD"]);

    await assert.rejects(
      () => mergeBranch(repo, "cockpit/conflicto", "Merge run"),
      (err: unknown) => {
        assert.ok(err instanceof MergeConflictError);
        assert.deepEqual(err.files, ["app.js"], "el error debería nombrar el fichero");
        return true;
      },
    );

    assert.equal(await execGit(repo, ["rev-parse", "HEAD"]), headBefore);
    assert.equal(await isWorkingTreeClean(repo), true);
    assert.equal(
      await fs.readFile(path.join(repo, "app.js"), "utf8"),
      "version de main\n",
      "el fichero en conflicto no debería haberse tocado",
    );
    // Un merge a medias dejaría MERGE_HEAD y bloquearía el repo del usuario.
    await assert.rejects(() => fs.access(path.join(repo, ".git", "MERGE_HEAD")));

    await removeWorktree(repo, wt, "cockpit/conflicto");
  });
});

describe("sin identidad de git configurada", () => {
  // Quien configura user.email por repo en vez de --global no tiene identidad
  // ninguna en los proyectos que crea el cockpit, y ahí `git commit` falla con
  // "Author identity unknown". Neutralizamos la config global y la del sistema
  // para que el caso se reproduzca en cualquier máquina, tenga lo que tenga.
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    system: process.env.GIT_CONFIG_SYSTEM,
  };

  before(() => {
    const inexistente = path.join(root, "no-hay-config");
    process.env.GIT_CONFIG_GLOBAL = inexistente;
    process.env.GIT_CONFIG_SYSTEM = inexistente;
  });

  after(() => {
    if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved.global;
    if (saved.system === undefined) delete process.env.GIT_CONFIG_SYSTEM;
    else process.env.GIT_CONFIG_SYSTEM = saved.system;
  });

  test("initRepo deja el commit inicial igualmente", async () => {
    const dir = path.join(root, `sin-identidad-init-${counter++}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "algo.txt"), "contenido\n");

    await initRepo(dir);

    // Sin HEAD no hay `git worktree add`, así que el proyecto no podría lanzar
    // ni una run.
    assert.equal((await execGit(dir, ["log", "--oneline"])).trim().split("\n").length, 1);
  });

  test("mergear la rama de una run tampoco necesita identidad", async () => {
    const dir = path.join(root, `sin-identidad-merge-${counter++}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "base.txt"), "base\n");
    await initRepo(dir);

    const wt = path.join(root, `wt-sin-identidad-${counter++}`);
    await addWorktree(dir, wt, "cockpit/sin-identidad");
    await fs.writeFile(path.join(wt, "trabajo.txt"), "lo que hizo el agente\n");
    await commitAll(wt, "cockpit: trabajo de la run");

    // El merge --no-ff crea un commit: sin esto el botón falla justo al final,
    // con el trabajo ya commiteado en la rama.
    await mergeBranch(dir, "cockpit/sin-identidad", "Merge run");

    assert.equal(await isBranchMerged(dir, "cockpit/sin-identidad", "main"), true);
    assert.equal(await isWorkingTreeClean(dir), true);
    await removeWorktree(dir, wt, "cockpit/sin-identidad");
  });

  test("commitAll commitea el trabajo suelto del agente", async () => {
    const dir = path.join(root, `sin-identidad-commit-${counter++}`);
    await fs.mkdir(dir, { recursive: true });
    await initRepo(dir);
    await fs.writeFile(path.join(dir, "trabajo.txt"), "lo que dejó el agente\n");

    // Es lo que hace "Mergear en main" antes de mergear: si esto revienta, el
    // botón no funciona en ningún proyecto creado por el cockpit.
    assert.equal(await commitAll(dir, "cockpit: trabajo de la run"), true);
    assert.equal(await isWorkingTreeClean(dir), true);
  });
});
