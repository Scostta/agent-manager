import fs from "node:fs/promises";

import { db } from "../db.js";
import { bus } from "../bus.js";
import { cleanupWorkspace } from "./workspace.js";
import {
  branchCommitCount,
  branchExists,
  commitAll,
  currentBranch,
  diffWorktree,
  isBranchMerged,
  isWorkingTreeClean,
  MergeConflictError,
  mergeBranch,
  removeWorktree,
  resolveBaseBranch,
  worktreeChanges,
} from "../lib/git.js";

import type { Project, TaskRun } from "@prisma/client";

/** Error de negocio: la ruta lo traduce a un 400 con el mensaje tal cual. */
export class IntegrationError extends Error {}

export type BranchStatus = {
  branchName: string | null;
  /** Rama destino del merge. null si la run no tiene rama. */
  base: string | null;
  branchExists: boolean;
  worktreeExists: boolean;
  merged: boolean;
  commits: number;
  uncommitted: number;
  canMerge: boolean;
  /** Por qué no se puede mergear ahora mismo. null si sí se puede. */
  blockedReason: string | null;
};

const NO_BRANCH: BranchStatus = {
  branchName: null,
  base: null,
  branchExists: false,
  worktreeExists: false,
  merged: false,
  commits: 0,
  uncommitted: 0,
  canMerge: false,
  blockedReason: "Esta run no tiene rama Git (proyecto en modo 'copy').",
};

async function loadRun(runId: string) {
  const run = await db.taskRun.findUnique({
    where: { id: runId },
    include: { task: { include: { project: true } } },
  });
  if (!run) throw new IntegrationError(`Run ${runId} no encontrada`);
  return run;
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function getBranchStatus(runId: string): Promise<BranchStatus> {
  const run = await loadRun(runId);
  if (!run.branchName) return NO_BRANCH;

  const repoPath = run.task.project.repoPath;
  const branch = run.branchName;
  const base = await resolveBaseBranch(repoPath);

  const [onBranch, hasWorktree, isAncestor, clean, head] = await Promise.all([
    branchExists(repoPath, branch),
    exists(run.workspacePath),
    isBranchMerged(repoPath, branch, base),
    isWorkingTreeClean(repoPath),
    currentBranch(repoPath),
  ]);

  const changes = !onBranch
    ? { commits: 0, uncommitted: 0 }
    : hasWorktree
      ? await worktreeChanges(run.workspacePath, base)
      : { commits: await branchCommitCount(repoPath, base, branch), uncommitted: 0 };

  // "Integrada" no es solo que la rama sea ancestro de la base: si el agente
  // dejó cambios sin commitear, ese trabajo sigue fuera de la base.
  const merged = onBranch && isAncestor && changes.uncommitted === 0;
  const hasWork = changes.commits > 0 || changes.uncommitted > 0;

  const blockedReason = !onBranch
    ? "La rama de esta run ya no existe."
    : merged
      ? null
      : !hasWork
        ? hasWorktree
          ? "El agente no dejó ningún cambio en el workspace."
          : "El workspace de esta run ya se limpió."
        : !clean
          ? `El repo tiene cambios sin guardar. Haz commit o stash en ${repoPath} antes de mergear.`
          : head !== base
            ? `El repo está en la rama '${head}'. Cámbiate a '${base}' para mergear.`
            : null;

  return {
    branchName: branch,
    base,
    branchExists: onBranch,
    worktreeExists: hasWorktree,
    merged,
    commits: changes.commits,
    uncommitted: changes.uncommitted,
    canMerge: onBranch && !merged && hasWork && blockedReason === null,
    blockedReason,
  };
}

export type MergeResult = {
  base: string;
  branchName: string;
  /** true si hubo que commitear lo que el agente dejó sin commitear. */
  committed: boolean;
};

export async function mergeRun(runId: string): Promise<MergeResult> {
  const run = await loadRun(runId);
  const status = await getBranchStatus(runId);

  if (status.merged) throw new IntegrationError("Esta rama ya está integrada.");
  if (!status.canMerge || !status.branchName || !status.base) {
    throw new IntegrationError(status.blockedReason ?? "No se puede mergear esta run.");
  }

  const repoPath = run.task.project.repoPath;
  const short = run.id.slice(0, 8);

  // El trabajo sin commitear no viaja en un merge: lo consolidamos en la rama
  // de la run antes de integrarla.
  const committed = status.uncommitted
    ? await commitAll(run.workspacePath, `cockpit: ${run.task.title} (run ${short})`)
    : false;

  try {
    await mergeBranch(
      repoPath,
      status.branchName,
      `Merge run ${short}: ${run.task.title}`,
    );
  } catch (err: any) {
    // El merge ya se abortó dentro de mergeBranch: el repo está como estaba.
    if (err instanceof MergeConflictError) {
      const where = err.files.length ? ` en ${err.files.join(", ")}` : "";
      throw new IntegrationError(
        `Conflicto con '${status.base}'${where}. No se ha tocado tu repo: resuélvelo a mano desde la rama ${status.branchName}.`,
      );
    }
    throw new IntegrationError(`El merge falló y se abortó: ${err.message}`);
  }

  // El worktree ya no hace falta, pero la rama sí: es lo único que recuerda
  // que esta run se integró (`merged` se deriva de git, no de la BD). Muere
  // luego, cuando la task pasa a 'done'.
  await removeWorktree(repoPath, run.workspacePath).catch((err) => {
    console.warn(`[integrate] limpieza tras merge falló para ${runId}:`, err);
  });

  bus.emit("board", { type: "task_updated", taskId: run.taskId });
  return { base: status.base, branchName: status.branchName, committed };
}

/**
 * Limpieza segura al cerrar una task: en modo worktree solo borra la rama si su
 * trabajo ya está en la base. Una rama sin mergear es el único sitio donde vive
 * lo que hizo el agente, así que se conserva y el usuario decide.
 *
 * En modo 'copy' no hay nada que integrar, así que se limpia como siempre.
 */
export async function cleanupIfIntegrated(
  run: TaskRun,
  project: Project,
): Promise<boolean> {
  if (project.workspaceStrategy !== "worktree" || !run.branchName) {
    await cleanupWorkspace(project, run, { force: true });
    return true;
  }

  // Misma definición de "integrada" que usa la UI: ser ancestro de la base no
  // basta si el agente dejó cambios sin commitear en el worktree.
  const status = await getBranchStatus(run.id);
  if (!status.merged) {
    console.info(
      `[integrate] ${run.branchName} no está integrada en ${status.base}: conservo el worktree de la run ${run.id}`,
    );
    return false;
  }

  await cleanupWorkspace(project, run, { force: true });
  return true;
}

export async function discardRun(runId: string): Promise<void> {
  const run = await loadRun(runId);
  await cleanupWorkspace(run.task.project, run, { force: true });
  bus.emit("board", { type: "task_updated", taskId: run.taskId });
}

export async function getRunDiff(
  runId: string,
): Promise<{ branchName: string; base: string; diff: string }> {
  const run = await loadRun(runId);
  if (!run.branchName) {
    throw new IntegrationError("Esta run no tiene rama Git (proyecto en modo 'copy').");
  }

  const repoPath = run.task.project.repoPath;
  const base = await resolveBaseBranch(repoPath);

  if (!(await exists(run.workspacePath))) {
    throw new IntegrationError(
      "El workspace de esta run ya no existe: se limpió al mergear o al descartar.",
    );
  }

  return {
    branchName: run.branchName,
    base,
    diff: await diffWorktree(run.workspacePath, base),
  };
}
