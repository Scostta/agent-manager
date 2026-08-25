import fs from "node:fs/promises";
import path from "node:path";

import { db } from "../db.js";
import { config } from "../config.js";
import {
  branchExists,
  execGit,
  isBranchMerged,
  removeWorktree,
  resolveBaseBranch,
  worktreeChanges,
} from "../lib/git.js";

/** Lo que el GC necesita saber de una carpeta para decidir. */
export type WorkspaceFacts = {
  /** null cuando ninguna run de la BD reclama esta carpeta. */
  run: { status: string; strategy: "worktree" | "copy"; taskStatus: string } | null;
  /** Desde que terminó la run, o desde la fecha de la carpeta si no hay run. */
  ageDays: number;
  /** El directorio es un worktree de git válido, con su repo detrás. */
  isGitWorktree: boolean;
  /** El trabajo ya está en la rama base. */
  branchMerged: boolean;
  /** Quedan cambios que no están en ningún commit: borrar los perdería. */
  hasUncommitted: boolean;
  /** Commits en la rama que sobrevivirían aunque borremos el directorio. */
  commits: number;
};

export type Verdict = {
  /** "all" borra directorio y rama; "dir" conserva la rama con el trabajo. */
  action: "all" | "dir" | "keep";
  reason: string;
};

const ACTIVE = new Set(["queued", "running"]);

/**
 * La regla de fondo: liberar disco nunca puede destruir trabajo que no esté
 * guardado en otro sitio. En worktree la rama es ese otro sitio, así que borrar
 * el directorio es gratis; en copy no hay red de seguridad y hay que ser
 * conservador.
 *
 * Una carpeta huérfana no es permiso para borrar a lo bruto: si la BD se
 * recrea o cambia WORKSPACES_ROOT, *todo* parece huérfano. Ahí mandan los
 * hechos del disco, no la ausencia de registro.
 */
export function decideWorkspace(facts: WorkspaceFacts, olderThanDays: number): Verdict {
  if (facts.run && ACTIVE.has(facts.run.status)) {
    return { action: "keep", reason: "la run sigue en marcha" };
  }

  if (facts.ageDays < olderThanDays) {
    return {
      action: "keep",
      reason: facts.run
        ? `terminó hace menos de ${olderThanDays} días`
        : `la carpeta tiene menos de ${olderThanDays} días`,
    };
  }

  // Lo que no está en ningún commit solo existe aquí, haya registro o no.
  if (facts.hasUncommitted) {
    return { action: "keep", reason: "hay cambios sin commitear" };
  }

  if (!facts.run) {
    if (facts.isGitWorktree) {
      return { action: "dir", reason: "sin registro, pero su rama conserva el trabajo" };
    }
    return { action: "all", reason: "no hay ninguna run que lo reclame" };
  }

  if (facts.run.strategy === "copy") {
    if (facts.run.status !== "succeeded") {
      return { action: "all", reason: "la run no terminó bien" };
    }
    if (facts.run.taskStatus === "done") {
      return { action: "all", reason: "la tarea ya está cerrada" };
    }
    // En copy el trabajo del agente solo existe en esta carpeta.
    return { action: "keep", reason: "sin rama donde guardar el trabajo" };
  }

  if (facts.branchMerged) return { action: "all", reason: "la rama ya está integrada" };
  if (facts.commits > 0) return { action: "dir", reason: "el trabajo queda en la rama" };
  return { action: "all", reason: "el agente no dejó nada" };
}

export type WorkspaceEntry = {
  path: string;
  runId: string;
  taskId: string;
  sizeBytes: number;
  branchName: string | null;
  repoPath: string | null;
  facts: WorkspaceFacts;
  verdict: Verdict;
};

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) {
      const stat = await fs.stat(full).catch(() => null);
      total += stat?.size ?? 0;
    }
  }
  return total;
}

const DAY_MS = 24 * 60 * 60_000;

/** Edad de una carpeta sin registro: lo último que se tocó dentro. */
async function dirAgeDays(dir: string): Promise<number> {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat) return 0;
  return (Date.now() - stat.mtimeMs) / DAY_MS;
}

/**
 * Recorre WORKSPACES_ROOT (que tiene forma taskId/runId) y cruza cada carpeta
 * con su run. El estado de git se consulta en vivo: la BD no sabe si mergeaste
 * una rama desde la terminal.
 */
export async function scanWorkspaces(
  olderThanDays = config.workspaceGcDays,
): Promise<WorkspaceEntry[]> {
  const root = config.workspacesRoot;
  const taskDirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const entries: WorkspaceEntry[] = [];

  for (const taskDir of taskDirs) {
    if (!taskDir.isDirectory()) continue;
    const runDirs = await fs
      .readdir(path.join(root, taskDir.name), { withFileTypes: true })
      .catch(() => []);

    for (const runDir of runDirs) {
      if (!runDir.isDirectory()) continue;
      const full = path.join(root, taskDir.name, runDir.name);

      const run = await db.taskRun.findUnique({
        where: { id: runDir.name },
        include: { task: { include: { project: true } } },
      });

      const strategy = run
        ? run.task.project.workspaceStrategy === "worktree"
          ? "worktree"
          : "copy"
        : null;

      const facts: WorkspaceFacts = {
        run: run ? { status: run.status, strategy: strategy!, taskStatus: run.task.status } : null,
        ageDays: run
          ? (Date.now() - (run.endedAt ?? run.startedAt).getTime()) / DAY_MS
          : await dirAgeDays(full),
        isGitWorktree: false,
        branchMerged: false,
        hasUncommitted: false,
        commits: 0,
      };

      if (!run || strategy === "worktree") {
        // `status` funciona dentro de un worktree sin saber dónde está el repo,
        // así que sirve igual para los huérfanos.
        const status = await execGit(full, ["status", "--porcelain"]).catch(() => null);
        facts.isGitWorktree = status !== null;
        facts.hasUncommitted = !!status;
      }

      if (run?.branchName && strategy === "worktree") {
        const repoPath = run.task.project.repoPath;
        try {
          const base = await resolveBaseBranch(repoPath);
          if (await branchExists(repoPath, run.branchName)) {
            facts.branchMerged = await isBranchMerged(repoPath, run.branchName, base);
            facts.commits = (await worktreeChanges(full, base)).commits;
          } else {
            // Sin rama, el directorio es lo único que queda del trabajo.
            facts.hasUncommitted = true;
          }
        } catch (err) {
          // Repo movido o worktree roto: no adivinamos, se conserva.
          console.warn(`[gc] no se pudo leer el estado de ${full}:`, err);
          facts.hasUncommitted = true;
        }
      }

      entries.push({
        path: full,
        runId: runDir.name,
        taskId: taskDir.name,
        sizeBytes: await dirSize(full),
        branchName: run?.branchName ?? null,
        repoPath: run?.task.project.repoPath ?? null,
        facts,
        verdict: decideWorkspace(facts, olderThanDays),
      });
    }
  }

  return entries;
}

export type GcReport = {
  olderThanDays: number;
  total: { count: number; sizeBytes: number };
  reclaimable: { count: number; sizeBytes: number };
  entries: WorkspaceEntry[];
};

export async function workspaceReport(
  olderThanDays = config.workspaceGcDays,
): Promise<GcReport> {
  const entries = await scanWorkspaces(olderThanDays);
  const reclaimable = entries.filter((entry) => entry.verdict.action !== "keep");

  return {
    olderThanDays,
    total: {
      count: entries.length,
      sizeBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    },
    reclaimable: {
      count: reclaimable.length,
      sizeBytes: reclaimable.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    },
    entries,
  };
}

export type GcResult = {
  removed: number;
  freedBytes: number;
  keptBranches: number;
  dryRun: boolean;
};

export async function collectWorkspaces(options: {
  olderThanDays?: number;
  dryRun?: boolean;
} = {}): Promise<GcResult> {
  const olderThanDays = options.olderThanDays ?? config.workspaceGcDays;
  const dryRun = options.dryRun ?? false;
  const entries = await scanWorkspaces(olderThanDays);

  let removed = 0;
  let freedBytes = 0;
  let keptBranches = 0;

  for (const entry of entries) {
    if (entry.verdict.action === "keep") continue;
    if (dryRun) {
      removed++;
      freedBytes += entry.sizeBytes;
      if (entry.verdict.action === "dir") keptBranches++;
      continue;
    }

    try {
      if (entry.repoPath && entry.branchName) {
        await removeWorktree(
          entry.repoPath,
          entry.path,
          entry.verdict.action === "all" ? entry.branchName : undefined,
        );
        if (entry.verdict.action === "dir") keptBranches++;
      } else {
        await fs.rm(entry.path, { recursive: true, force: true });
      }
      // Con la carpeta fuera, el registro del worktree en el repo sobra.
      if (entry.repoPath) await execGit(entry.repoPath, ["worktree", "prune"]).catch(() => {});

      removed++;
      freedBytes += entry.sizeBytes;
      console.info(`[gc] ${entry.path}: ${entry.verdict.reason}`);
    } catch (err) {
      console.warn(`[gc] no se pudo limpiar ${entry.path}:`, err);
    }
  }

  await pruneEmptyTaskDirs();

  return { removed, freedBytes, keptBranches, dryRun };
}

/** Las carpetas de task quedan vacías cuando se van todas sus runs. */
async function pruneEmptyTaskDirs(): Promise<void> {
  const taskDirs = await fs
    .readdir(config.workspacesRoot, { withFileTypes: true })
    .catch(() => []);

  for (const dir of taskDirs) {
    if (!dir.isDirectory()) continue;
    const full = path.join(config.workspacesRoot, dir.name);
    const rest = await fs.readdir(full).catch(() => ["algo"]);
    if (rest.length === 0) await fs.rmdir(full).catch(() => {});
  }
}

let timer: NodeJS.Timeout | null = null;

/** Barrido al arrancar y luego cada N horas. 0 lo desactiva. */
export function startWorkspaceGc(): void {
  const everyMs = config.workspaceGcIntervalHours * 60 * 60_000;

  const sweep = (): void => {
    void collectWorkspaces()
      .then((result) => {
        if (result.removed > 0) {
          console.info(
            `[gc] ${result.removed} workspace(s) limpiados, ${Math.round(result.freedBytes / 1024)} KB liberados`,
          );
        }
      })
      .catch((err) => console.warn("[gc] barrido fallido:", err));
  };

  sweep();
  if (everyMs > 0) {
    timer = setInterval(sweep, everyMs);
    // Un GC no debería mantener vivo el proceso si no queda nada más que hacer.
    timer.unref?.();
  }
}

export function stopWorkspaceGc(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
