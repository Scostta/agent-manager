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
  // El root de workspaces suele vivir dentro del propio repo (WORKSPACES_ROOT
  // por defecto es ./workspaces). Sin excluirlo, la copia se copiaría dentro de
  // sí misma sin fin.
  await copyDirShallow(project.repoPath, workspacePath, [
    baseWorkspacesRoot,
    workspacePath,
  ]);
  return { workspacePath, branchName: null };
}

export async function injectWorkspaceResources(opts: {
  workspacePath: string;
  agentSkills: (AgentSkill & { skill: Skill })[];
  /**
   * Los CLAUDE.md del cockpit que le tocan a esta run, en orden: primero el
   * global (vale para todos los proyectos), luego el del proyecto. Los nulos y
   * los vacíos se ignoran.
   */
  claudeMdSections: (string | null | undefined)[];
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

  const sections = opts.claudeMdSections
    .map((section) => section?.trim())
    .filter((section): section is string => !!section);

  if (sections.length) await mergeClaudeMd(opts.workspacePath, sections);
}

const COCKPIT_MARKER = "<!-- claude-cockpit -->";

/**
 * El repo puede traer su propio CLAUDE.md con las convenciones del proyecto.
 * Sobreescribirlo haría que el agente trabajase a ciegas, así que anexamos el
 * contenido del cockpit en una sección delimitada en lugar de machacarlo.
 */
async function mergeClaudeMd(
  workspacePath: string,
  cockpitSections: string[],
): Promise<void> {
  const target = path.join(workspacePath, "CLAUDE.md");
  // Un único marcador para todas las secciones, y así el invariante es simple:
  // todo lo que va detrás del marcador es nuestro y se puede reemplazar entero.
  const section = [COCKPIT_MARKER, ...cockpitSections].join(`\n\n---\n\n`);

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

  // Idempotente: si ya inyectamos antes, reemplazamos nuestra sección. Ojo,
  // esto se lleva por delante cualquier cosa escrita después del marcador — que
  // es justo lo que queremos en una continuación, que reinyecta sobre el
  // workspace del padre.
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

const EXCLUDED_NAMES = new Set(["node_modules", ".git", ".next", "dist", "build"]);

/** Los ejemplos no llevan secretos y a veces son la única documentación de qué
 *  variables necesita el proyecto. */
const ENV_EXAMPLE_SUFFIXES = [".example", ".sample", ".template"];

const LOCAL_DB_EXTENSIONS = [".db", ".db-journal", ".sqlite", ".sqlite3"];

/**
 * Un workspace es un sandbox donde corre un agente autónomo que además vuelca
 * todo lo que lee a un log NDJSON. Copiar ahí el `.env` del proyecto le entrega
 * las credenciales — incluida la ANTHROPIC_API_KEY del propio cockpit.
 */
function isSensitiveFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) {
    return !ENV_EXAMPLE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
  }
  return LOCAL_DB_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Windows compara rutas sin distinguir mayúsculas. */
function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** true si `candidate` es `ancestor` o está contenido en él. */
function containsPath(ancestor: string, candidate: string): boolean {
  const rel = path.relative(normalizePath(ancestor), normalizePath(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function copyDirShallow(
  src: string,
  dest: string,
  skip: string[] = [],
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    // Saltamos cualquier directorio que contenga (o sea) un destino de copia:
    // entrar ahí sería recursión infinita.
    if (skip.some((target) => containsPath(srcPath, target))) continue;
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirShallow(srcPath, destPath, skip);
    } else if (entry.isFile()) {
      if (isSensitiveFile(entry.name)) continue;
      await fs.copyFile(srcPath, destPath);
    }
  }
}
