// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { WORKSPACES_DIR, assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../config.js";
import { db } from "../db.js";
import {
  addWorktree,
  branchExists,
  commitAll,
  execGit,
  initRepo,
  mergeBranch,
} from "../lib/git.js";
import { collectWorkspaces, scanWorkspaces } from "./gc.js";

import type { Project, TaskRun } from "@prisma/client";

/**
 * El GC contra disco y git de verdad. La tabla de decisión vive en gc.test.ts;
 * aquí se prueba lo que pasa cuando esas decisiones se ejecutan, que es donde
 * un fallo se lleva por delante trabajo del usuario.
 */

assertUsingTestDb(config.databaseUrl);

const DAY_MS = 24 * 60 * 60_000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

async function exists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

async function seedProject(strategy: "worktree" | "copy"): Promise<Project> {
  const repoPath = tempDir("repo");
  await fs.writeFile(path.join(repoPath, "README.md"), "# base\n", "utf8");
  if (strategy === "worktree") await initRepo(repoPath);
  return db.project.create({
    data: { name: "demo", repoPath, workspaceStrategy: strategy },
  });
}

/** Crea la fila de la run y su carpeta en WORKSPACES_ROOT, como el executor. */
async function seedRun(
  project: Project,
  opts: {
    runStatus?: string;
    taskStatus?: string;
    endedDaysAgo?: number;
    strategy?: "worktree" | "copy";
  } = {},
): Promise<TaskRun & { workspacePath: string }> {
  const agent = await db.agent.create({
    data: { name: `agente-${Math.random()}`, role: "dev", model: "claude-sonnet-5", systemPrompt: "x" },
  });
  const task = await db.task.create({
    data: {
      projectId: project.id,
      title: "Tarea",
      description: "",
      status: opts.taskStatus ?? "review",
      position: 0,
    },
  });

  const run = await db.taskRun.create({
    data: {
      taskId: task.id,
      agentId: agent.id,
      status: opts.runStatus ?? "succeeded",
      workspacePath: "",
      logPath: "",
      endedAt: daysAgo(opts.endedDaysAgo ?? 30),
    },
  });

  const workspacePath = path.join(WORKSPACES_DIR, task.id, run.id);
  let branchName: string | null = null;

  if ((opts.strategy ?? project.workspaceStrategy) === "worktree") {
    branchName = `cockpit/task-${task.id}/run-${run.id}`;
    await addWorktree(project.repoPath, workspacePath, branchName);
  } else {
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(path.join(workspacePath, "README.md"), "# copia\n", "utf8");
  }

  const updated = await db.taskRun.update({
    where: { id: run.id },
    data: { workspacePath, branchName },
  });

  return { ...updated, workspacePath };
}

async function emptyWorkspacesRoot(): Promise<void> {
  for (const entry of await fs.readdir(WORKSPACES_DIR)) {
    await fs.rm(path.join(WORKSPACES_DIR, entry), { recursive: true, force: true });
  }
}

beforeEach(async () => {
  await emptyWorkspacesRoot();
  await resetDb();
});

after(() => closeDb());

describe("collectWorkspaces: worktrees", () => {
  test("no borra un worktree con cambios sin commitear, por viejo que sea", async () => {
    const project = await seedProject("worktree");
    const run = await seedRun(project, { endedDaysAgo: 365 });
    // Lo que el agente dejó suelto: no vive en ninguna otra parte.
    await fs.writeFile(path.join(run.workspacePath, "trabajo.txt"), "sin commitear\n");

    const result = await collectWorkspaces({ olderThanDays: 0 });

    assert.equal(result.removed, 0);
    assert.ok(await exists(run.workspacePath));
    assert.ok(await exists(path.join(run.workspacePath, "trabajo.txt")));
  });

  test("una rama ya integrada se lleva carpeta y rama", async () => {
    const project = await seedProject("worktree");
    const run = await seedRun(project);
    await fs.writeFile(path.join(run.workspacePath, "hecho.txt"), "trabajo\n");
    await commitAll(run.workspacePath, "trabajo del agente");
    await mergeBranch(project.repoPath, run.branchName!, "integrar");

    const result = await collectWorkspaces({ olderThanDays: 7 });

    assert.equal(result.removed, 1);
    assert.equal(result.keptBranches, 0);
    assert.equal(await exists(run.workspacePath), false);
    assert.equal(await branchExists(project.repoPath, run.branchName!), false);
    // El trabajo sigue vivo donde importa: en la rama base.
    assert.ok(await exists(path.join(project.repoPath, "hecho.txt")));
  });

  test("con commits sin integrar borra la carpeta pero conserva la rama", async () => {
    const project = await seedProject("worktree");
    const run = await seedRun(project);
    await fs.writeFile(path.join(run.workspacePath, "pendiente.txt"), "sin mergear\n");
    await commitAll(run.workspacePath, "trabajo sin integrar");

    const result = await collectWorkspaces({ olderThanDays: 7 });

    assert.equal(result.removed, 1);
    assert.equal(result.keptBranches, 1, "la rama es lo único que guarda ese trabajo");
    assert.equal(await exists(run.workspacePath), false);
    assert.ok(await branchExists(project.repoPath, run.branchName!));
  });

  test("el registro del worktree se poda: el repo no queda con referencias muertas", async () => {
    const project = await seedProject("worktree");
    const run = await seedRun(project);
    await fs.writeFile(path.join(run.workspacePath, "algo.txt"), "x\n");
    await commitAll(run.workspacePath, "trabajo");

    await collectWorkspaces({ olderThanDays: 7 });

    const list = await execGit(project.repoPath, ["worktree", "list"]);
    assert.equal(list.includes(run.id), false);
  });
});

describe("collectWorkspaces: copias", () => {
  test("una run que salió bien y sigue en review no se toca", async () => {
    const project = await seedProject("copy");
    const run = await seedRun(project, { taskStatus: "review" });

    const result = await collectWorkspaces({ olderThanDays: 7 });

    assert.equal(result.removed, 0);
    assert.ok(await exists(run.workspacePath), "sin rama, la copia es el único sitio donde está");
  });

  test("con la tarea cerrada se limpia y la carpeta de la task se va con ella", async () => {
    const project = await seedProject("copy");
    const run = await seedRun(project, { taskStatus: "done" });

    const result = await collectWorkspaces({ olderThanDays: 7 });

    assert.equal(result.removed, 1);
    assert.equal(await exists(run.workspacePath), false);
    assert.equal(
      await exists(path.join(WORKSPACES_DIR, run.taskId)),
      false,
      "la carpeta de la task queda vacía y también se poda",
    );
  });

  test("una run fallida se limpia aunque la tarea siga abierta", async () => {
    const project = await seedProject("copy");
    const run = await seedRun(project, { runStatus: "failed", taskStatus: "todo" });

    await collectWorkspaces({ olderThanDays: 7 });

    assert.equal(await exists(run.workspacePath), false);
  });

  test("una run en marcha no se toca nunca", async () => {
    const project = await seedProject("copy");
    const run = await seedRun(project, {
      runStatus: "running",
      taskStatus: "in_progress",
      endedDaysAgo: 365,
    });

    const result = await collectWorkspaces({ olderThanDays: 0 });

    assert.equal(result.removed, 0);
    assert.ok(await exists(run.workspacePath));
  });
});

describe("collectWorkspaces: continuaciones", () => {
  /**
   * Una continuación corre en el workspace del padre, así que la carpeta lleva
   * el id del padre. Fechar la carpeta por él la haría parecer abandonada
   * mientras el agente sigue trabajando dentro.
   */
  test("una continuación reciente rejuvenece el workspace del padre", async () => {
    const project = await seedProject("copy");
    const parent = await seedRun(project, { endedDaysAgo: 365 });

    await db.taskRun.create({
      data: {
        taskId: parent.taskId,
        agentId: parent.agentId,
        status: "succeeded",
        workspacePath: parent.workspacePath,
        logPath: "",
        resumedFromId: parent.id,
        endedAt: new Date(),
      },
    });

    const [entry] = await scanWorkspaces(30);

    assert.ok(entry.facts.ageDays < 1, "la carpeta se usó hoy, no hace un año");
    assert.equal(entry.verdict.action, "keep");
    assert.equal((await collectWorkspaces({ olderThanDays: 30 })).removed, 0);
    assert.ok(await exists(parent.workspacePath));
  });

  test("una continuación en marcha protege el workspace aunque el padre sea viejo", async () => {
    const project = await seedProject("copy");
    const parent = await seedRun(project, { runStatus: "failed", endedDaysAgo: 365 });

    await db.taskRun.create({
      data: {
        taskId: parent.taskId,
        agentId: parent.agentId,
        status: "running",
        workspacePath: parent.workspacePath,
        logPath: "",
        resumedFromId: parent.id,
        startedAt: daysAgo(400),
      },
    });

    // Con startedAt viejo la edad no la salva: lo que la salva es estar viva.
    const [entry] = await scanWorkspaces(0);

    assert.equal(entry.verdict.action, "keep");
    assert.match(entry.verdict.reason, /en marcha/);
    assert.equal((await collectWorkspaces({ olderThanDays: 0 })).removed, 0);
    assert.ok(await exists(parent.workspacePath));
  });
});

describe("collectWorkspaces: dryRun y huérfanas", () => {
  test("dryRun informa de lo que se llevaría sin tocar el disco", async () => {
    const project = await seedProject("copy");
    const run = await seedRun(project, { taskStatus: "done" });

    const result = await collectWorkspaces({ olderThanDays: 7, dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(result.removed, 1);
    assert.ok(result.freedBytes > 0);
    assert.ok(await exists(run.workspacePath), "en seco no se borra nada");
  });

  test("una carpeta sin run en BD se borra solo si lleva tiempo parada", async () => {
    const huerfana = path.join(WORKSPACES_DIR, "task-fantasma", "run-fantasma");
    await fs.mkdir(huerfana, { recursive: true });
    await fs.writeFile(path.join(huerfana, "restos.txt"), "de una BD borrada\n");

    // Recién tocada: no se sabe qué es, así que se conserva.
    assert.equal((await collectWorkspaces({ olderThanDays: 7 })).removed, 0);
    assert.ok(await exists(huerfana));

    // Con el umbral a cero ya cuenta como vieja.
    assert.equal((await collectWorkspaces({ olderThanDays: 0 })).removed, 1);
    assert.equal(await exists(huerfana), false);
  });
});

describe("scanWorkspaces", () => {
  test("cruza cada carpeta con su run y explica el veredicto", async () => {
    const project = await seedProject("worktree");
    const run = await seedRun(project);
    await fs.writeFile(path.join(run.workspacePath, "suelto.txt"), "sin commitear\n");

    const entries = await scanWorkspaces(7);

    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.equal(entry.runId, run.id);
    assert.equal(entry.taskId, run.taskId);
    assert.equal(entry.branchName, run.branchName);
    assert.equal(entry.repoPath, project.repoPath);
    assert.equal(entry.facts.hasUncommitted, true);
    assert.equal(entry.verdict.action, "keep");
    assert.ok(entry.verdict.reason.length > 0, "el informe tiene que decir por qué");
    assert.ok(entry.sizeBytes > 0);
  });
});
