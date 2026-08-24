import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { queueStats } from "../runner/queue.js";
import { diffAgainstBase } from "../lib/git.js";

export async function queueRoutes(app: FastifyInstance) {
  app.get("/queue/stats", async () => queueStats());

  app.get("/runs/:runId/diff", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await db.taskRun.findUnique({
      where: { id: runId },
      include: { task: { include: { project: true } } },
    });
    if (!run) return reply.notFound();
    if (!run.branchName)
      return reply.badRequest(
        "Esta run no tiene rama Git asociada (proyecto en modo 'copy').",
      );
    try {
      const diff = await diffAgainstBase(run.task.project.repoPath, run.branchName);
      return { branchName: run.branchName, diff };
    } catch (err: any) {
      return reply.internalServerError(`Error obteniendo diff: ${err.message}`);
    }
  });
}
