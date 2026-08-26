import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    // git manda parte de sus diagnósticos por stdout (los CONFLICT del merge,
    // sin ir más lejos), así que un mensaje que solo mire stderr sale vacío.
    super(`git ${args[0]} falló (${code}): ${stderr.trim() || stdout.trim()}`);
    this.name = "GitError";
  }
}

export function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new GitError(args, code, stdout, stderr));
    });
  });
}

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoPath, ".git"));
    await execGit(repoPath, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await execGit(repoPath, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  if (await branchExists(repoPath, branchName)) {
    await execGit(repoPath, ["branch", "-D", branchName]);
  }
  await execGit(repoPath, ["worktree", "add", "-b", branchName, worktreePath, "HEAD"]);
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  branchName?: string,
): Promise<void> {
  try {
    await execGit(repoPath, ["worktree", "remove", "--force", worktreePath]);
  } catch {
    await execGit(repoPath, ["worktree", "prune"]).catch(() => {});
  }
  if (branchName && (await branchExists(repoPath, branchName))) {
    await execGit(repoPath, ["branch", "-D", branchName]).catch(() => {});
  }
}

/** Rama contra la que se compara y se integra el trabajo de las runs. */
export async function resolveBaseBranch(repoPath: string): Promise<string> {
  for (const candidate of ["main", "master"]) {
    if (await branchExists(repoPath, candidate)) return candidate;
  }
  return currentBranch(repoPath);
}

export function currentBranch(repoPath: string): Promise<string> {
  return execGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export async function isWorkingTreeClean(repoPath: string): Promise<boolean> {
  return (await execGit(repoPath, ["status", "--porcelain"])).length === 0;
}

/** true si `branch` ya está contenida en `base`: integrarla no aportaría nada. */
export async function isBranchMerged(
  repoPath: string,
  branch: string,
  base: string,
): Promise<boolean> {
  try {
    await execGit(repoPath, ["merge-base", "--is-ancestor", branch, base]);
    return true;
  } catch {
    return false;
  }
}

/** Commits que tiene `branch` y no tiene `base`. Se lee del repo, así que sirve
 *  aunque el worktree de la run ya no exista. */
export async function branchCommitCount(
  repoPath: string,
  base: string,
  branch: string,
): Promise<number> {
  const count = await execGit(repoPath, ["rev-list", "--count", `${base}..${branch}`]);
  return Number(count) || 0;
}

export type WorktreeChanges = { commits: number; uncommitted: number };

export async function worktreeChanges(
  worktreePath: string,
  base: string,
): Promise<WorktreeChanges> {
  const [count, status] = await Promise.all([
    execGit(worktreePath, ["rev-list", "--count", `${base}..HEAD`]),
    execGit(worktreePath, ["status", "--porcelain"]),
  ]);
  return {
    commits: Number(count) || 0,
    uncommitted: status ? status.split("\n").length : 0,
  };
}

/**
 * Claude Code no hace commit salvo que se lo pidas, así que lo normal es que el
 * trabajo de una run esté sin commitear en el worktree. Comparar `base...branch`
 * como hacíamos antes devolvía vacío justo en el caso habitual: hay que
 * diffear el árbol de trabajo, no la rama.
 */
export async function diffWorktree(worktreePath: string, base: string): Promise<string> {
  // Sin intent-to-add los ficheros nuevos del agente no aparecen en `git diff`.
  await execGit(worktreePath, ["add", "-A", "-N", "."]).catch(() => {});
  const mergeBase = await execGit(worktreePath, ["merge-base", base, "HEAD"]);
  return execGit(worktreePath, ["diff", mergeBase]);
}

/** Devuelve false si no había nada que commitear. */
export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<boolean> {
  if (!(await execGit(worktreePath, ["status", "--porcelain"]))) return false;
  await execGit(worktreePath, ["add", "-A"]);
  await execGit(worktreePath, ["commit", "-m", message]);
  return true;
}

/**
 * Merge sobre el repo real del usuario. Si hay conflicto abortamos: dejar su
 * repo a medio mergear sería mucho peor que no mergear.
 */
export async function mergeBranch(
  repoPath: string,
  branch: string,
  message: string,
): Promise<void> {
  try {
    await execGit(repoPath, ["merge", "--no-ff", branch, "-m", message]);
  } catch (err) {
    await execGit(repoPath, ["merge", "--abort"]).catch(() => {});
    if (err instanceof GitError) throw new MergeConflictError(conflictedFiles(err));
    throw err;
  }
}

export class MergeConflictError extends Error {
  constructor(readonly files: string[]) {
    super(files.length ? `Conflicto en ${files.join(", ")}` : "Conflicto al mergear");
    this.name = "MergeConflictError";
  }
}

/** Los ficheros en conflicto salen como "CONFLICT (content): Merge conflict in X". */
function conflictedFiles(err: GitError): string[] {
  return [...err.stdout.matchAll(/^CONFLICT \(.+?\): .*? in (.+)$/gm)].map((m) =>
    m[1].trim(),
  );
}

export function buildBranchName(taskId: string, runId: string): string {
  return `cockpit/task-${taskId}/run-${runId}`;
}

/** Identidad de respaldo: sin user.name/user.email globales, `git commit` falla. */
const FALLBACK_IDENTITY = [
  "-c", "user.name=Claude Cockpit",
  "-c", "user.email=cockpit@localhost",
];

/**
 * Inicializa un repo nuevo y le deja un commit. El commit no es cosmético:
 * `git worktree add ... HEAD` necesita que HEAD exista, así que un repo recién
 * inicializado y sin commits no puede lanzar ni una sola run.
 */
export async function initRepo(repoPath: string): Promise<void> {
  // -b requiere git >= 2.28. En versiones viejas cae a la rama por defecto.
  await execGit(repoPath, ["init", "-b", "main"]).catch(() =>
    execGit(repoPath, ["init"]),
  );
  await execGit(repoPath, ["add", "-A"]);
  const commit = ["commit", "--allow-empty", "-m", "Initial commit"];
  try {
    await execGit(repoPath, commit);
  } catch (err) {
    if (!isMissingIdentity(err)) throw err;
    await execGit(repoPath, [...FALLBACK_IDENTITY, ...commit]);
  }
}

function isMissingIdentity(err: unknown): boolean {
  if (!(err instanceof GitError)) return false;
  return /user\.email|user\.name|Author identity unknown|empty ident/i.test(
    err.stderr + err.stdout,
  );
}
