import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { db } from "../db.js";
import { config } from "../config.js";
import { cancelRun } from "../runner/queue.js";
import {
  IntegrationError,
  discardRun,
  getBranchStatus,
  getRunDiff,
  mergeRun,
} from "../runner/integrate.js";

/** El visor solo pinta la cola del log; leer entero un NDJSON de una run larga
 *  es pura memoria tirada. */
const LogQuery = z.object({
  tail: z.coerce.number().int().min(1).max(20_000).default(2000),
});

export async function runRoutes(app: FastifyInstance) {
  app.get("/runs/:runId", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await db.taskRun.findUnique({
      where: { id: runId },
      include: { task: true, agent: true },
    });
    if (!run) return reply.notFound();
    return run;
  });

  app.post("/runs/:runId/cancel", async (req) => {
    const { runId } = req.params as { runId: string };
    const ok = await cancelRun(runId);
    return { ok };
  });

  // El NDJSON del stream-json es el único registro de lo que hizo el agente una
  // vez cerrada la conexión SSE. Sin esto el log solo existía en vivo.
  app.get("/runs/:runId/log", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const { tail } = LogQuery.parse(req.query ?? {});

    const run = await db.taskRun.findUnique({
      where: { id: runId },
      select: { logPath: true },
    });
    if (!run) return reply.notFound();

    // logPath se rellena al empezar a ejecutar; una run en cola aún no lo tiene.
    const logPath = run.logPath || path.join(config.logsRoot, `${runId}.ndjson`);

    let raw: string;
    try {
      raw = await fs.readFile(logPath, "utf8");
    } catch (err: any) {
      if (err.code === "ENOENT") return { lines: [], totalLines: 0, truncated: false };
      return reply.internalServerError(`No se pudo leer el log: ${err.message}`);
    }

    const all = raw.split("\n").filter((line) => line.trim().length > 0);
    return {
      lines: all.slice(-tail),
      totalLines: all.length,
      truncated: all.length > tail,
    };
  });

  app.get("/runs/:runId/diff", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    try {
      return await getRunDiff(runId);
    } catch (err: any) {
      if (err instanceof IntegrationError) return reply.badRequest(err.message);
      return reply.internalServerError(`Error obteniendo diff: ${err.message}`);
    }
  });

  /* ── Integración del trabajo de la run ──────────────────────────────────── */

  app.get("/runs/:runId/branch", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    try {
      return await getBranchStatus(runId);
    } catch (err: any) {
      if (err instanceof IntegrationError) return reply.notFound(err.message);
      return reply.internalServerError(`Error leyendo la rama: ${err.message}`);
    }
  });

  app.post("/runs/:runId/merge", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    try {
      return await mergeRun(runId);
    } catch (err: any) {
      if (err instanceof IntegrationError) return reply.badRequest(err.message);
      return reply.internalServerError(`Error mergeando: ${err.message}`);
    }
  });

  app.post("/runs/:runId/discard", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    try {
      await discardRun(runId);
      return { ok: true };
    } catch (err: any) {
      if (err instanceof IntegrationError) return reply.badRequest(err.message);
      return reply.internalServerError(`Error descartando: ${err.message}`);
    }
  });
}
