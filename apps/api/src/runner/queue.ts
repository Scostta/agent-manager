import PQueue from "p-queue";
import { db } from "../db.js";
import { executeTaskRun, type AuthMode } from "./executor.js";

const queue = new PQueue({ concurrency: 2 });

export async function enqueueTaskRun(
  taskId: string,
  agentId: string,
  authMode?: AuthMode,
): Promise<string> {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent ${agentId} no encontrado`);

  const run = await db.taskRun.create({
    data: { taskId, agentId, status: "queued", workspacePath: "", logPath: "" },
  });

  await db.task.update({ where: { id: taskId }, data: { status: "in_progress" } });

  queue.add(() => executeTaskRun(run.id, authMode)).catch((err) => {
    console.error(`[queue] Error ejecutando run ${run.id}:`, err);
    db.taskRun
      .update({
        where: { id: run.id },
        data: { status: "failed", endedAt: new Date(), resultSummary: String(err) },
      })
      .catch(() => {});
  });

  return run.id;
}

export function queueStats() {
  return {
    pending: queue.pending,
    waiting: queue.size,
    concurrency: queue.concurrency,
  };
}

export { cancelRun } from "./executor.js";
