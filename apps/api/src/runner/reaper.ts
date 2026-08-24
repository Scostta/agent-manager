import { db } from "../db.js";

/**
 * Al arrancar, marca como 'failed' las runs que quedaron en estado
 * running/queued de una sesión anterior. Evita filas zombi.
 *
 * Las tasks de esas runs vuelven a 'todo': igual que cuando una run falla en
 * caliente, una task no puede quedarse en 'in_progress' sin nada ejecutándose.
 */
export async function reapOrphanRuns(): Promise<number> {
  const orphans = await db.taskRun.findMany({
    where: { status: { in: ["running", "queued"] } },
    select: { taskId: true },
  });

  if (orphans.length === 0) return 0;

  const result = await db.taskRun.updateMany({
    where: { status: { in: ["running", "queued"] } },
    data: {
      status: "failed",
      endedAt: new Date(),
      resultSummary: "Run interrumpida: la API se reinició mientras estaba activa.",
      pid: null,
    },
  });

  await db.task.updateMany({
    where: {
      id: { in: [...new Set(orphans.map((run) => run.taskId))] },
      status: "in_progress",
    },
    data: { status: "todo" },
  });

  return result.count;
}
