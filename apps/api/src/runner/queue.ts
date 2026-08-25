import PQueue from "p-queue";
import { db } from "../db.js";
import { bus } from "../bus.js";
import { config } from "../config.js";
import { executeTaskRun, killActiveRuns, type AuthMode } from "./executor.js";

const queue = new PQueue({ concurrency: config.queueConcurrency });

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
        data: {
          status: "failed",
          endedAt: new Date(),
          failureKind: "error",
          resultSummary: String(err),
        },
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
    paused: queue.isPaused,
  };
}

/**
 * Pausar no toca lo que ya está corriendo: solo deja de sacar trabajo nuevo de
 * la cola. Para cortar lo que está en marcha está `stopEverything`.
 */
export function pauseQueue(): void {
  queue.pause();
  bus.emit("board", { type: "queue_changed" });
}

export function resumeQueue(): void {
  queue.start();
  bus.emit("board", { type: "queue_changed" });
}

/** p-queue aplica el cambio en caliente: si subes el número, arranca ya lo que
 *  quepa; si lo bajas, deja terminar lo que hay sin matar nada. */
export function setConcurrency(value: number): number {
  queue.concurrency = value;
  bus.emit("board", { type: "queue_changed" });
  return queue.concurrency;
}

export type StopResult = {
  /** Runs que esperaban turno y ya no se ejecutarán. */
  discarded: number;
  /** Procesos `claude` que estaban vivos y hemos matado. */
  killed: number;
};

/**
 * Kill switch: para todo lo que el cockpit tenga en marcha y vacía la cola.
 * Deja la cola en pausa a propósito — si la dejáramos abierta, lo siguiente que
 * se encolase arrancaría solo, que es justo lo que no quieres tras un "para".
 */
export async function stopEverything(): Promise<StopResult> {
  queue.pause();
  queue.clear();

  // Las descartadas nunca llegan a executeTaskRun, así que su fila se quedaría
  // en 'queued' para siempre: las cerramos aquí.
  const queued = await db.taskRun.findMany({
    where: { status: "queued" },
    select: { id: true, taskId: true },
  });

  if (queued.length > 0) {
    await db.taskRun.updateMany({
      where: { id: { in: queued.map((run) => run.id) } },
      data: {
        status: "cancelled",
        endedAt: new Date(),
        resultSummary: "Descartada al parar la cola.",
      },
    });
    await db.task.updateMany({
      where: { id: { in: [...new Set(queued.map((run) => run.taskId))] }, status: "in_progress" },
      data: { status: "todo" },
    });
  }

  const killed = await killActiveRuns();

  bus.emit("board", { type: "queue_changed" });
  for (const run of queued) bus.emit("board", { type: "task_updated", taskId: run.taskId });

  return { discarded: queued.length, killed };
}

export { cancelRun } from "./executor.js";
