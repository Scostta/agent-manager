import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";

import { config } from "../config.js";
import {
  createSnapshot,
  isSnapshotName,
  snapshotName,
} from "../backup/snapshot.js";

export async function backupRoutes(app: FastifyInstance) {
  /**
   * Descarga una copia consistente de la BD. Se genera en un temporal y se
   * borra al terminar de enviarla: las copias que se conservan en disco son las
   * automáticas del arranque, y descargar diez veces no debe barrerlas.
   */
  app.get("/backup", async (req, reply) => {
    const name = snapshotName(new Date());
    const tmp = path.join(os.tmpdir(), `claude-cockpit-${process.pid}-${name}`);

    try {
      await createSnapshot(tmp);
    } catch (err: any) {
      return reply.internalServerError(`No se pudo copiar la BD: ${err.message}`);
    }

    const stream = createReadStream(tmp);
    // Se borra pase lo que pase: si el cliente corta la descarga, el 'close'
    // llega igual y el temporal no se queda ahí para siempre.
    stream.on("close", () => {
      void fs.rm(tmp, { force: true }).catch(() => {});
    });

    return reply
      .header("Content-Type", "application/x-sqlite3")
      .header("Content-Disposition", `attachment; filename="${name}"`)
      .send(stream);
  });

  /** Qué copias automáticas hay ahora mismo, para poder enseñarlo en la UI. */
  app.get("/backup/history", async () => {
    const names = await fs.readdir(config.backupsRoot).catch(() => [] as string[]);

    const snapshots = [];
    for (const name of names.filter(isSnapshotName).sort().reverse()) {
      const stat = await fs.stat(path.join(config.backupsRoot, name)).catch(() => null);
      if (stat) snapshots.push({ name, sizeBytes: stat.size, at: stat.mtime.toISOString() });
    }

    return { root: config.backupsRoot, keep: config.backupKeep, snapshots };
  });
}
