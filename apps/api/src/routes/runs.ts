import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { db } from "../db.js";
import { config } from "../config.js";
import {
  ResumeUnavailableError,
  cancelRun,
  continueRun,
  relaunchRun,
} from "../runner/queue.js";
import { resumeStatus } from "../runner/resume.js";
import { cancelRetry, scheduleRetryAtReset } from "../runner/scheduler.js";
import {
  IntegrationError,
  discardRun,
  getBranchStatus,
  getRunDiff,
  mergeRun,
} from "../runner/integrate.js";

const RetryInput = z.object({
  mode: z.enum(["wait", "api_key", "now"]),
});

const ContinueInput = z.object({
  prompt: z.string().trim().min(1, "Escribe qué quieres que cambie."),
});

/** El visor solo pinta la cola del log; leer entero un NDJSON de una run larga
 *  es pura memoria tirada. */
const LogQuery = z.object({
  tail: z.coerce.number().int().min(1).max(20_000).default(2000),
});

const RunsQuery = z.object({
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  agentId: z.string().optional(),
  status: z
    .enum(["queued", "running", "succeeded", "failed", "cancelled"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function runRoutes(app: FastifyInstance) {
  /**
   * Historial de runs. Hasta ahora solo se podía llegar a la última run de cada
   * task (`listTasks` hace take: 1), así que los reintentos y su gasto eran
   * invisibles pese a estar en la BD.
   */
  app.get("/runs", async (req) => {
    const { projectId, taskId, agentId, status, limit, offset } = RunsQuery.parse(
      req.query ?? {},
    );

    const where = {
      ...(taskId ? { taskId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(status ? { status } : {}),
      ...(projectId ? { task: { projectId } } : {}),
    };

    const [runs, total] = await Promise.all([
      db.taskRun.findMany({
        where,
        include: {
          task: { select: { id: true, title: true, projectId: true } },
          agent: { select: { id: true, name: true, model: true } },
        },
        orderBy: { startedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      db.taskRun.count({ where }),
    ]);

    return { runs, total, limit, offset };
  });

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

  /**
   * Qué hacer con una run que se quedó sin cuota del plan: esperar al reset y
   * que se reintente sola, o relanzarla ya tirando de la API key (que se
   * factura aparte).
   */
  app.post("/runs/:runId/retry", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const { mode } = RetryInput.parse(req.body ?? {});

    const run = await db.taskRun.findUnique({ where: { id: runId } });
    if (!run) return reply.notFound();

    if (mode === "wait") {
      try {
        const resetAt = await scheduleRetryAtReset(runId);
        return { mode, scheduledFor: resetAt.toISOString() };
      } catch (err: any) {
        return reply.badRequest(err.message);
      }
    }

    cancelRetry(runId);
    await db.taskRun.update({
      where: { id: runId },
      data: { failureKind: "rate_limit" },
    });
    const relaunched = await relaunchRun(runId, {
      authMode: mode === "api_key" ? "api_key" : undefined,
    });
    return { mode, runId: relaunched.runId, resumed: relaunched.resumed };
  });

  /* ── Continuar la sesión de una run ─────────────────────────────────────── */

  /**
   * Si esta run se puede retomar con `--resume`. Lo decide el estado real —
   * hay sesión guardada y el workspace sigue en disco — no la BD sola.
   */
  app.get("/runs/:runId/resume", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const status = await resumeStatus(runId);
    if (!status) return reply.notFound();
    return status;
  });

  /**
   * "Casi, pero cambia X". Encadena una run que sigue la conversación de esta
   * en su mismo workspace, en vez de arrancar otra desde cero.
   */
  app.post("/runs/:runId/resume", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const { prompt } = ContinueInput.parse(req.body ?? {});
    try {
      return { runId: await continueRun(runId, prompt) };
    } catch (err: any) {
      if (err instanceof ResumeUnavailableError) return reply.badRequest(err.message);
      return reply.internalServerError(`No se pudo continuar: ${err.message}`);
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
