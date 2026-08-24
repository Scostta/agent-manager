import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
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
}
