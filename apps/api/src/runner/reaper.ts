import { db } from "../db.js";

/**
 * Al arrancar, marca como 'failed' las runs que quedaron en estado
 * running/queued de una sesión anterior. Evita filas zombi.
 */
export async function reapOrphanRuns(): Promise<number> {
  const result = await db.taskRun.updateMany({
    where: { status: { in: ["running", "queued"] } },
    data: {
      status: "failed",
      endedAt: new Date(),
      resultSummary: "Run interrumpida: la API se reinició mientras estaba activa.",
      pid: null,
    },
  });
  return result.count;
}
