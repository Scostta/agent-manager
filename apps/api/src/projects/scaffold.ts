import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { db } from "../db.js";
import { GitError, initRepo, isGitRepo } from "../lib/git.js";
import { detectWorkspaceStrategy } from "../runner/workspace.js";

import type { Project } from "@prisma/client";

export type ScaffoldInput = {
  name: string;
  description?: string;
  repoPath: string;
  workspaceStrategy?: "worktree" | "copy";
  /** Crear el repo si la carpeta no lo es ya. Sin git no hay worktrees. */
  initGit?: boolean;
  /** Contenido del CLAUDE.md del proyecto. Se escribe también en disco. */
  claudeMdContent?: string | null;
};

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

export const CLAUDE_MD_FILENAME = "CLAUDE.md";

/**
 * Crea la carpeta del proyecto, deja su CLAUDE.md e inicializa el repo antes de
 * decidir la estrategia. El orden importa: `detectWorkspaceStrategy` mira si hay
 * un `.git`, así que detectar antes del `git init` condenaría a 'copy' a todos
 * los proyectos nuevos.
 */
export async function scaffoldProject(input: ScaffoldInput): Promise<Project> {
  const repoPath = normalizeRepoPath(input.repoPath);

  await fs.mkdir(repoPath, { recursive: true }).catch((err) => {
    throw new ScaffoldError(`No se pudo crear ${repoPath}: ${err.code ?? err.message}`);
  });

  const claudeMdContent = input.claudeMdContent?.trim() ? input.claudeMdContent : null;
  const claudeMdPath = path.join(repoPath, CLAUDE_MD_FILENAME);
  if (claudeMdContent) {
    await fs.writeFile(claudeMdPath, claudeMdContent, "utf8").catch((err) => {
      throw new ScaffoldError(`No se pudo escribir ${claudeMdPath}: ${err.code ?? err.message}`);
    });
  }

  if (input.initGit && !(await isGitRepo(repoPath))) {
    try {
      await initRepo(repoPath);
    } catch (err) {
      if (err instanceof GitError) {
        throw new ScaffoldError(`No se pudo inicializar el repo: ${err.message}`);
      }
      // spawn ENOENT: git no está en el PATH.
      throw new ScaffoldError(
        "No se pudo ejecutar git. ¿Está instalado y en el PATH?",
      );
    }
  }

  const workspaceStrategy =
    input.workspaceStrategy ?? (await detectWorkspaceStrategy(repoPath));

  return db.project.create({
    data: {
      name: input.name,
      description: input.description,
      repoPath,
      workspaceStrategy,
      ...(claudeMdContent
        ? {
            claudeMd: {
              create: {
                scope: "project",
                content: claudeMdContent,
                filePath: claudeMdPath,
              },
            },
          }
        : {}),
    },
  });
}

/**
 * El repoPath se guarda tal cual y se usa como cwd de cada run: una ruta
 * relativa se resolvería contra el cwd de la API, que no es donde el usuario
 * cree que está su proyecto.
 */
export function normalizeRepoPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new ScaffoldError("La ruta del proyecto no puede estar vacía");
  if (!path.isAbsolute(trimmed)) {
    throw new ScaffoldError(`La ruta del proyecto debe ser absoluta: ${trimmed}`);
  }

  const resolved = path.resolve(trimmed);
  assertNotSystemFolder(resolved);
  return resolved;
}

/**
 * Un proyecto en la home o en la raíz del disco no es un descuido cualquiera:
 * `initGit` haría `git init` + `git add -A` sobre todo lo que haya debajo, que
 * ahí es el disco entero. Y el workspace de cada run copiaría eso mismo.
 */
function assertNotSystemFolder(target: string): void {
  const samePath = (a: string, b: string): boolean =>
    process.platform === "win32"
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;

  if (samePath(target, path.parse(target).root)) {
    throw new ScaffoldError(
      "No se puede crear un proyecto en la raíz del disco. Elige o crea una subcarpeta.",
    );
  }
  if (samePath(target, path.resolve(os.homedir()))) {
    throw new ScaffoldError(
      "No se puede crear un proyecto directamente en tu carpeta personal. Elige o crea una subcarpeta.",
    );
  }
}
