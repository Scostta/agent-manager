import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

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
      else reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
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

export async function diffAgainstBase(repoPath: string, branchName: string): Promise<string> {
  let base = "main";
  try {
    await execGit(repoPath, ["rev-parse", "--verify", "main"]);
  } catch {
    base = "master";
  }
  return execGit(repoPath, ["diff", `${base}...${branchName}`]);
}

export function buildBranchName(taskId: string, runId: string): string {
  return `cockpit/task-${taskId}/run-${runId}`;
}
