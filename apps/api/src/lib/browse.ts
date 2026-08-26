import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Explorador de carpetas para el formulario de "nuevo proyecto". El navegador
 * no puede darnos una ruta absoluta del disco (el <input type="file"> devuelve
 * un nombre y un blob, no una ruta), así que el picker lo sirve la API.
 *
 * Solo lista directorios: lo que se elige es dónde vive un proyecto, y mezclar
 * ficheros en la lista solo añade ruido que no se puede seleccionar.
 */

export type DirEntry = {
  name: string;
  path: string;
  isGitRepo: boolean;
};

export type DirListing = {
  path: string;
  name: string;
  parent: string | null;
  exists: boolean;
  isGitRepo: boolean;
  isEmpty: boolean;
  /** El cliente compone rutas nuevas y no puede adivinar el separador. */
  separator: string;
  entries: DirEntry[];
};

export class BrowseError extends Error {
  constructor(
    readonly kind: "denied" | "not_a_directory",
    message: string,
  ) {
    super(message);
    this.name = "BrowseError";
  }
}

export function defaultBrowsePath(): string {
  return os.homedir();
}

/** El padre de una raíz (`C:\`, `/`) es él mismo; eso corta la navegación. */
function parentOf(target: string): string | null {
  const parent = path.dirname(target);
  return parent === target ? null : parent;
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

export async function listDirectory(
  rawPath: string,
  opts: { includeHidden?: boolean } = {},
): Promise<DirListing> {
  const target = path.resolve(rawPath);
  const base: Omit<DirListing, "entries" | "isEmpty" | "isGitRepo"> = {
    path: target,
    // En una raíz de Windows, basename() devuelve "" — mejor enseñar "C:\".
    name: path.basename(target) || target,
    parent: parentOf(target),
    exists: true,
    separator: path.sep,
  };

  let dirents;
  try {
    dirents = await fs.readdir(target, { withFileTypes: true });
  } catch (err: any) {
    // Una ruta que aún no existe no es un error: el usuario está escribiendo el
    // nombre de la carpeta que quiere que le creemos.
    if (err.code === "ENOENT") {
      return { ...base, exists: false, isGitRepo: false, isEmpty: true, entries: [] };
    }
    if (err.code === "ENOTDIR") {
      throw new BrowseError("not_a_directory", `${target} no es una carpeta`);
    }
    throw new BrowseError("denied", `No se puede leer ${target}: ${err.code ?? err.message}`);
  }

  const dirs = dirents.filter((entry) => {
    if (!entry.isDirectory()) return false;
    if (!opts.includeHidden && entry.name.startsWith(".")) return false;
    return true;
  });

  const entries = await Promise.all(
    dirs.map(async (entry) => {
      const full = path.join(target, entry.name);
      return { name: entry.name, path: full, isGitRepo: await isGitRepo(full) };
    }),
  );

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...base,
    isGitRepo: await isGitRepo(target),
    // Un `.git` cuenta como contenido aunque el filtro de ocultos lo esconda.
    isEmpty: dirents.length === 0,
    entries,
  };
}

export type BrowseRoot = { name: string; path: string };

/**
 * Puntos de partida del explorador. En Windows no hay API para enumerar
 * unidades, así que se prueban las letras: es local y son 26 accesos.
 */
export async function listRoots(): Promise<BrowseRoot[]> {
  const home = os.homedir();
  const roots: BrowseRoot[] = [{ name: "Inicio", path: home }];

  if (process.platform === "win32") {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const found = await Promise.all(
      letters.map(async (letter) => {
        const drive = `${letter}:\\`;
        try {
          await fs.access(drive);
          return drive;
        } catch {
          return null;
        }
      }),
    );
    for (const drive of found) {
      if (drive) roots.push({ name: drive, path: drive });
    }
  } else {
    roots.push({ name: "/", path: "/" });
  }

  return roots;
}
