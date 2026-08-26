import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import chokidar from "chokidar";

import { db } from "../db.js";
import { config } from "../config.js";
import { toPosix } from "../lib/paths.js";

import type { FSWatcher } from "chokidar";

async function findSkillFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
        results.push(...(await findSkillFiles(full)));
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(full);
      }
    }
  } catch {
    // ruta no existe, ignoramos
  }
  return results;
}

async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Normaliza separadores para que funcione igual en Windows y Unix.
 */
function scopeFromPath(filePath: string): string {
  const normalized = toPosix(filePath);
  if (normalized.includes("/public/")) return "public";
  if (normalized.includes("/user/")) return "user";
  return "user";
}

async function upsertSkillFromFile(filePath: string): Promise<void> {
  const raw = await fs.readFile(filePath, "utf8");
  const { data } = matter(raw);
  const name = data.name ?? path.basename(path.dirname(filePath));
  const description = data.description ?? "";
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const contentHash = await hashFile(filePath);

  await db.skill.upsert({
    where: { name },
    update: {
      description,
      filePath,
      contentHash,
      scope: scopeFromPath(filePath),
      tags: JSON.stringify(tags),
    },
    create: {
      name,
      description,
      filePath,
      contentHash,
      scope: scopeFromPath(filePath),
      tags: JSON.stringify(tags),
    },
  });
}

export async function scanSkills(): Promise<number> {
  let count = 0;
  const seen: string[] = [];

  for (const root of config.skillsPaths) {
    const files = await findSkillFiles(root);
    for (const file of files) {
      try {
        await upsertSkillFromFile(file);
        seen.push(file);
        count++;
      } catch (err) {
        console.warn(`[skills] Error procesando ${file}:`, err);
      }
    }
  }

  // Sin esto, un SKILL.md borrado mientras la API estaba parada se quedaba
  // indexado para siempre: el escaneo solo daba de alta.
  const removed = await db.skill.deleteMany({ where: { filePath: { notIn: seen } } });
  if (removed.count > 0) {
    console.info(`[skills] ${removed.count} skill(s) ya no están en disco: eliminadas`);
  }

  return count;
}

function isSkillFile(filePath: string): boolean {
  return path.basename(filePath) === "SKILL.md";
}

/**
 * chokidar 4 dejó de aceptar globs: pasarle `<root>/**\/SKILL.md` no vigilaba
 * nada y los cambios en disco no se reindexaban nunca. Vigilamos los
 * directorios raíz y filtramos por nombre.
 */
export function watchSkills(): FSWatcher {
  const watcher = chokidar.watch(config.skillsPaths, {
    ignoreInitial: true,
    // Los directorios tienen que pasar el filtro o no se recorrerían.
    ignored: (target, stats) => !!stats?.isFile() && !isSkillFile(target),
  });

  const reindex = (p: string): void => {
    if (!isSkillFile(p)) return;
    upsertSkillFromFile(p).catch((err) =>
      console.warn(`[skills] error reindexando ${p}:`, err),
    );
  };

  const forget = async (filePath: string): Promise<void> => {
    const removed = await db.skill.deleteMany({ where: { filePath } });
    if (removed.count > 0) console.info(`[skills] eliminada ${filePath}`);
  };

  watcher.on("add", reindex);
  watcher.on("change", reindex);
  watcher.on("unlink", (p) => {
    if (!isSkillFile(p)) return;
    forget(p).catch((err) => console.warn(`[skills] error borrando ${p}:`, err));
  });
  // Borrar la carpeta de una skill emite unlinkDir, no unlink del fichero.
  watcher.on("unlinkDir", (dir) => {
    forget(path.join(dir, "SKILL.md")).catch((err) =>
      console.warn(`[skills] error borrando ${dir}:`, err),
    );
  });
  watcher.on("error", (err) => console.warn("[skills] watcher:", err));

  // Devolverlo permite cerrarlo: si no, el watcher mantiene vivo el event loop
  // y ni el shutdown de la API ni un proceso de test terminan solos.
  return watcher;
}
