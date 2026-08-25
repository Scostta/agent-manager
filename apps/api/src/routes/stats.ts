import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { config } from "../config.js";
import { rangeStart, summarize } from "../stats/aggregate.js";

const RangeQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function statsRoutes(app: FastifyInstance) {
  app.get("/stats/summary", async (req) => {
    const { days } = RangeQuery.parse(req.query);

    const runs = await db.taskRun.findMany({
      where: { startedAt: { gte: rangeStart(days) } },
      select: {
        id: true,
        status: true,
        startedAt: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        costUsd: true,
        agent: { select: { id: true, name: true, model: true } },
        task: { select: { project: { select: { id: true, name: true } } } },
      },
      orderBy: { startedAt: "asc" },
    });

    return summarize(runs, days);
  });

  /**
   * Lo que el cockpit ha metido en el plan de Claude Code, por las dos ventanas
   * con las que el plan cuenta: la de 5 horas y la semanal.
   *
   * No es el consumo total de tu cuenta — lo que gastes en la terminal o en
   * claude.ai no pasa por aquí, y el consumo real del plan no es consultable de
   * forma programática. La UI lo etiqueta como "lo que ha gastado el cockpit".
   */
  app.get("/stats/plan", async () => {
    const now = Date.now();
    const windows = {
      session: new Date(now - 5 * 60 * 60_000),
      week: new Date(now - 7 * 24 * 60 * 60_000),
    };

    const [session, week, blocked] = await Promise.all([
      windowUsage(windows.session),
      windowUsage(windows.week),
      db.taskRun.findFirst({
        where: { failureKind: { in: ["rate_limit", "rate_limit_waiting"] } },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          taskId: true,
          failureKind: true,
          rateLimitResetAt: true,
          resultSummary: true,
          startedAt: true,
        },
      }),
    ]);

    return {
      authMode: config.authMode,
      session: { since: windows.session.toISOString(), ...session },
      week: { since: windows.week.toISOString(), ...week },
      // La última vez que el plan dijo basta, si sigue sin resolverse.
      limit: blocked
        ? {
            runId: blocked.id,
            taskId: blocked.taskId,
            waiting: blocked.failureKind === "rate_limit_waiting",
            resetAt: blocked.rateLimitResetAt?.toISOString() ?? null,
            message: blocked.resultSummary,
            hitAt: blocked.startedAt.toISOString(),
          }
        : null,
    };
  });
}

async function windowUsage(since: Date) {
  const totals = await db.taskRun.aggregate({
    where: { startedAt: { gte: since } },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
      costUsd: true,
    },
    _count: { _all: true },
  });

  const inputTokens = totals._sum.inputTokens ?? 0;
  const outputTokens = totals._sum.outputTokens ?? 0;
  const cacheReadTokens = totals._sum.cacheReadTokens ?? 0;
  const cacheWriteTokens = totals._sum.cacheWriteTokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costUsd: totals._sum.costUsd ?? 0,
    runs: totals._count._all,
  };
}
