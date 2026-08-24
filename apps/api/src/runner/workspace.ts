import fs from "node:fs/promises";
import path from "node:path";
import { addWorktree, removeWorktree, buildBranchName, isGitRepo } from "../lib/git.js";
import type { Project, TaskRun, Skill, AgentSkill } from "@prisma/client";

export type WorkspaceSetupResult = {
  workspacePath: string;
  branchName: string | null;
};

export async function detectWorkspaceStrategy(
  repoPath: string,
): Promise<"worktree" | "copy"> {
  return (await isGitRepo(repoPath)) ? "worktree" : "copy";
}

export async function setupWorkspace(
  project: Project,
  run: TaskRun,
  baseWorkspacesRoot: string,
): Promise<WorkspaceSetupResult> {
  const workspacePath = path.join(baseWorkspacesRoot, run.taskId, run.id);

  if (project.workspaceStrategy === "worktree") {
    const branchName = buildBranchName(run.taskId, run.id);
    await addWorktree(project.repoPath, workspacePath, branchName);
    return { workspacePath, branchName };
  }

  await fs.mkdir(workspacePath, { recursive: true });
  await copyDirShallow(project.repoPath, workspacePath);
  return { workspacePath, branchName: null };
}

export async function injectWorkspaceResources(opts: {
  workspacePath: string;
  agentSkills: (AgentSkill & { skill: Skill })[];
  claudeMdContent: string | null;
}): Promise<void> {
  const skillsDir = path.join(opts.workspacePath, ".claude", "skills");
  await fs.mkdir(skillsDir, { recursive: true });

  for (const { skill } of opts.agentSkills) {
    const target = path.join(skillsDir, skill.name);
    const sourceDir = path.dirname(skill.filePath);
    try {
      // 'junction' en Windows no requiere permisos admin, 'dir' en Unix
      const symlinkType = process.platform === "win32" ? "junction" : "dir";
      await fs.symlink(sourceDir, target, symlinkType);
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
    }
  }

  if (opts.claudeMdContent) {
    await mergeClaudeMd(opts.workspacePath, opts.claudeMdContent);
  }
}

const COCKPIT_MARKER = "<!-- claude-cockpit -->";

/**
 * El repo puede traer su propio CLAUDE.md con las convenciones del proyecto.
 * Sobreescribirlo haría que el agente trabajase a ciegas, así que anexamos el
 * contenido del cockpit en una sección delimitada en lugar de machacarlo.
 */
async function mergeClaudeMd(
  workspacePath: string,
  cockpitContent: string,
): Promise<void> {
  const target = path.join(workspacePath, "CLAUDE.md");
  const section = `${COCKPIT_MARKER}\n${cockpitContent}`;

  let existing: string | null = null;
  try {
    existing = await fs.readFile(target, "utf8");
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }

  if (existing === null) {
    await fs.writeFile(target, section);
    return;
  }

  // Idempotente: si ya inyectamos antes, reemplazamos nuestra sección.
  const markerIndex = existing.indexOf(COCKPIT_MARKER);
  const base = markerIndex === -1 ? existing : existing.slice(0, markerIndex);
  await fs.writeFile(target, `${base.trimEnd()}\n\n---\n\n${section}`);
}

export async function cleanupWorkspace(
  project: Project,
  run: TaskRun,
  options: { force?: boolean } = {},
): Promise<void> {
  const shouldCleanup =
    options.force || run.status === "cancelled" || run.status === "failed";

  if (!shouldCleanup) return;

  if (project.workspaceStrategy === "worktree" && run.branchName) {
    await removeWorktree(project.repoPath, run.workspacePath, run.branchName);
  } else {
    await fs.rm(run.workspacePath, { recursive: true, force: true }).catch(() => {});
  }
}

async function copyDirShallow(src: string, dest: string): Promise<void> {
  const EXCLUDED = new Set(["node_modules", ".git", ".next", "dist", "build"]);
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirShallow(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
