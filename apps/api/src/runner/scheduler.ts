import { db } from "../db.js";
import { bus } from "../bus.js";
import { enqueueTaskRun } from "./queue.js";

/**
 * Reintentos en espera de que se reponga la cuota del plan. El timer vive en
 * memoria, pero la intención está en la BD (`failureKind = rate_limit_waiting`),
 * así que un reinicio de la API no pierde la espera: `restorePendingRetries()`
 * la reprograma al arrancar.
 */
const timers = new Map<string, NodeJS.Timeout>();

/** Margen tras la hora de reset: el reloj del CLI y el nuestro no son el mismo. */
const RESET_GRACE_MS = 60_000;

export function pendingRetryIds(): string[] {
  return [...timers.keys()];
}

export function cancelRetry(runId: string): boolean {
  const timer = timers.get(runId);
  if (!timer) return false;
  clearTimeout(timer);
  timers.delete(runId);
  return true;
}

async function fireRetry(runId: string): Promise<void> {
  timers.delete(runId);
  const run = await db.taskRun.findUnique({ where: { id: runId } });
  if (!run) return;

  // Si alguien ya relanzó la task a mano, no duplicamos la run.
  if (run.failureKind !== "rate_limit_waiting") return;

  await db.taskRun.update({
    where: { id: runId },
    data: { failureKind: "rate_limit" },
  });

  try {
    const newRunId = await enqueueTaskRun(run.taskId, run.agentId);
    console.info(`[scheduler] cuota repuesta: run ${runId} reintentada como ${newRunId}`);
    bus.emit("board", { type: "task_updated", taskId: run.taskId });
  } catch (err) {
    console.warn(`[scheduler] no se pudo reintentar ${runId}:`, err);
  }
}

/**
 * Marca la run como "esperando al reset" y programa el reintento. Sin hora de
 * reset conocida no programamos nada: reintentar a ciegas volvería a chocar.
 */
export async function scheduleRetryAtReset(runId: string): Promise<Date> {
  const run = await db.taskRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`Run ${runId} no encontrada`);
  if (!run.rateLimitResetAt) {
    throw new Error(
      "El CLI no dijo a qué hora se repone la cuota, así que no puedo programar el reintento.",
    );
  }

  await db.taskRun.update({
    where: { id: runId },
    data: { failureKind: "rate_limit_waiting" },
  });

  arm(runId, run.rateLimitResetAt);
  return run.rateLimitResetAt;
}

function arm(runId: string, resetAt: Date): void {
  cancelRetry(runId);
  const delay = Math.max(0, resetAt.getTime() - Date.now() + RESET_GRACE_MS);
  timers.set(
    runId,
    setTimeout(() => void fireRetry(runId), delay),
  );
}

/** Vuelve a armar los timers de las esperas que sobrevivieron a un reinicio. */
export async function restorePendingRetries(): Promise<number> {
  const waiting = await db.taskRun.findMany({
    where: { failureKind: "rate_limit_waiting" },
    select: { id: true, rateLimitResetAt: true },
  });

  for (const run of waiting) {
    // Sin hora no hay nada que esperar; la dejamos a decisión del usuario.
    if (!run.rateLimitResetAt) {
      await db.taskRun.update({
        where: { id: run.id },
        data: { failureKind: "rate_limit" },
      });
      continue;
    }
    arm(run.id, run.rateLimitResetAt);
  }

  return waiting.length;
}

export function clearAllRetries(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
