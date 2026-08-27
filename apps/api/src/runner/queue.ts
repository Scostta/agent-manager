import PQueue from "p-queue";
import { db } from "../db.js";
import { bus } from "../bus.js";
import { config } from "../config.js";
import { executeTaskRun, killActiveRuns, type AuthMode } from "./executor.js";
import { resumeStatus } from "./resume.js";

const queue = new PQueue({ concurrency: config.queueConcurrency });

export type EnqueueOptions = {
  authMode?: AuthMode;
  /**
   * Run cuya sesión retoma esta. La nueva hereda su workspace y su rama — el
   * CLI indexa las sesiones por directorio — y no las limpia al terminar.
   */
  resumeFromRunId?: string;
  /** Instrucciones con las que se retoma. Solo tiene sentido con resumeFromRunId. */
  followUpPrompt?: string;
};

export async function enqueueTaskRun(
  taskId: string,
  agentId: string,
  options: EnqueueOptions = {},
): Promise<string> {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent ${agentId} no encontrado`);

  const run = await db.taskRun.create({
    data: {
      taskId,
      agentId,
      status: "queued",
      workspacePath: "",
      logPath: "",
      resumedFromId: options.resumeFromRunId ?? null,
      followUpPrompt: options.followUpPrompt ?? null,
    },
  });

  await db.task.update({ where: { id: taskId }, data: { status: "in_progress" } });

  queue.add(() => executeTaskRun(run.id, options.authMode)).catch((err) => {
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

/** Lo que devuelve un relanzamiento: la run nueva y cómo se lanzó. */
export type RelaunchResult = {
  runId: string;
  /** true si retomó la sesión anterior; false si empezó de cero. */
  resumed: boolean;
  /** Por qué no se pudo retomar. null cuando sí se retomó. */
  reason: string | null;
};

/**
 * Vuelve a lanzar una run terminada retomando su sesión si se puede. No es un
 * error que no se pueda: quien la lanza (un reintento por cuota) quiere que la
 * tarea avance, y empezar de cero sigue siendo avanzar. La diferencia es el
 * dinero, así que se informa de cuál de las dos fue.
 */
export async function relaunchRun(
  runId: string,
  options: { authMode?: AuthMode } = {},
): Promise<RelaunchResult> {
  const run = await db.taskRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`Run ${runId} no encontrada`);

  const check = await resumeStatus(runId);
  const canResume = check?.canResume ?? false;

  const newRunId = await enqueueTaskRun(run.taskId, run.agentId, {
    authMode: options.authMode,
    resumeFromRunId: canResume ? runId : undefined,
  });

  return { runId: newRunId, resumed: canResume, reason: canResume ? null : (check?.reason ?? null) };
}

/**
 * "Casi, pero cambia X": sigue la conversación de una run con instrucciones
 * nuevas. Aquí no vale empezar de cero — si la sesión no se puede retomar, el
 * usuario tiene que enterarse y no pagar una run entera por sorpresa.
 */
export async function continueRun(
  runId: string,
  followUpPrompt: string,
): Promise<string> {
  const run = await db.taskRun.findUnique({ where: { id: runId } });
  if (!run) throw new ResumeUnavailableError(`Run ${runId} no encontrada`);

  const check = await resumeStatus(runId);
  if (!check?.canResume) {
    throw new ResumeUnavailableError(check?.reason ?? "No se puede retomar esta run.");
  }

  return enqueueTaskRun(run.taskId, run.agentId, {
    resumeFromRunId: runId,
    followUpPrompt,
  });
}

/** Error de negocio: la ruta lo traduce a un 400 con el mensaje tal cual. */
export class ResumeUnavailableError extends Error {}

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
