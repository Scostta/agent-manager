import fs from "node:fs/promises";
import path from "node:path";

import { db } from "../db.js";
import { config } from "../config.js";

/**
 * Copias de la BD. Todo el cockpit vive en un SQLite: proyectos, agentes y el
 * historial entero de tokens y coste. Si ese fichero se corrompe no hay de
 * dónde sacarlo.
 *
 * `VACUUM INTO` y no un `copyFile`: produce un snapshot consistente aunque
 * haya escrituras en marcha, y de paso compacta.
 */

const PREFIX = "cockpit-";
const SUFFIX = ".db";

/** `cockpit-2026-08-27-1134.db`. Ordena bien alfabéticamente, que es lo que usa la poda. */
export function snapshotName(at: Date): string {
  const p = (n: number, width = 2): string => String(n).padStart(width, "0");
  const stamp = [
    at.getFullYear(),
    p(at.getMonth() + 1),
    p(at.getDate()),
  ].join("-");
  return `${PREFIX}${stamp}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}${SUFFIX}`;
}

export function isSnapshotName(name: string): boolean {
  return name.startsWith(PREFIX) && name.endsWith(SUFFIX);
}

/**
 * Cuáles sobran cuando solo se conservan las `keep` más recientes. Separado de
 * borrarlas para poder probar la decisión sin tocar disco: aquí un fallo borra
 * justo lo que se quería guardar.
 */
export function expiredSnapshots(names: string[], keep: number): string[] {
  const ours = names.filter(isSnapshotName).sort();
  if (keep <= 0) return [];
  return ours.slice(0, Math.max(0, ours.length - keep));
}

export type Snapshot = { path: string; sizeBytes: number };

/** Escribe una copia consistente en `targetPath`. El directorio se crea si falta. */
export async function createSnapshot(targetPath: string): Promise<Snapshot> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  // VACUUM INTO se niega si el destino ya existe.
  await fs.rm(targetPath, { force: true });

  await db.$executeRawUnsafe("VACUUM INTO ?", targetPath);

  const stat = await fs.stat(targetPath);
  return { path: targetPath, sizeBytes: stat.size };
}

/** Borra las copias que sobran. Devuelve cuántas se fue. */
export async function pruneSnapshots(dir: string, keep: number): Promise<number> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const expired = expiredSnapshots(names, keep);

  for (const name of expired) {
    await fs.rm(path.join(dir, name), { force: true }).catch((err) => {
      console.warn(`[backup] no se pudo borrar ${name}:`, err);
    });
  }
  return expired.length;
}

/**
 * Copia al arrancar la API. Un backup que hay que acordarse de pulsar es un
 * backup que no tienes; este proyecto ya hace sus tareas de mantenimiento solo.
 *
 * Nunca tumba el arranque: quedarse sin copia es malo, no arrancar es peor.
 */
export async function backupOnStartup(): Promise<Snapshot | null> {
  if (config.backupKeep <= 0) return null;

  try {
    const target = path.join(config.backupsRoot, snapshotName(new Date()));
    const snapshot = await createSnapshot(target);
    const pruned = await pruneSnapshots(config.backupsRoot, config.backupKeep);
    console.info(
      `[backup] copia en ${snapshot.path} (${Math.round(snapshot.sizeBytes / 1024)} KB)` +
        (pruned ? `, ${pruned} antigua(s) borrada(s)` : ""),
    );
    return snapshot;
  } catch (err) {
    console.warn("[backup] no se pudo copiar la BD al arrancar:", err);
    return null;
  }
}
