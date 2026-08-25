import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { config } from "../config.js";
import { collectWorkspaces, workspaceReport } from "../runner/gc.js";

const ReportQuery = z.object({
  days: z.coerce.number().int().min(0).max(365).optional(),
});

const GcInput = z.object({
  days: z.coerce.number().int().min(0).max(365).optional(),
  /** Para enseñar qué se borraría antes de borrarlo de verdad. */
  dryRun: z.coerce.boolean().default(false),
});

export async function workspaceRoutes(app: FastifyInstance) {
  app.get("/workspaces", async (req) => {
    const { days } = ReportQuery.parse(req.query ?? {});
    const report = await workspaceReport(days ?? config.workspaceGcDays);
    return {
      ...report,
      root: config.workspacesRoot,
      // El detalle por workspace es para inspeccionar, no para pintar tablas
      // gigantes: los más gordos primero.
      entries: report.entries
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
        .map((entry) => ({
          runId: entry.runId,
          taskId: entry.taskId,
          sizeBytes: entry.sizeBytes,
          branchName: entry.branchName,
          action: entry.verdict.action,
          reason: entry.verdict.reason,
        })),
    };
  });

  app.post("/workspaces/gc", async (req) => {
    const { days, dryRun } = GcInput.parse(req.body ?? {});
    return collectWorkspaces({ olderThanDays: days, dryRun });
  });
}
