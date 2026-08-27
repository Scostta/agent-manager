import fs from "node:fs/promises";

import { db } from "../db.js";

/**
 * Continuar una sesión en vez de relanzarla. El CLI guarda la conversación
 * indexada por el directorio en el que corrió, así que `--resume` solo encuentra
 * la sesión si volvemos a lanzarlo desde el mismo workspace — de ahí que una
 * continuación herede el workspace del padre en lugar de crearse el suyo.
 */

export type ResumeFacts = {
  status: string;
  sessionId: string | null;
  /** El directorio donde corrió la run sigue en disco. */
  workspaceExists: boolean;
};

export type ResumeCheck = {
  canResume: boolean;
  /** Por qué no se puede retomar. null si sí se puede. */
  reason: string | null;
};

const ACTIVE = new Set(["queued", "running"]);

export function decideResume(facts: ResumeFacts): ResumeCheck {
  if (ACTIVE.has(facts.status)) {
    return { canResume: false, reason: "La run todavía está en marcha." };
  }
  if (!facts.sessionId) {
    return {
      canResume: false,
      // Pasa si el CLI murió antes del evento `init`: binario ausente, cuota
      // agotada de entrada, cancelación inmediata.
      reason: "Esta run no llegó a abrir sesión con el CLI, no hay nada que retomar.",
    };
  }
  if (!facts.workspaceExists) {
    return {
      canResume: false,
      reason:
        "El workspace de esta run ya no existe. Retomar la sesión exige volver al mismo directorio, así que habrá que lanzarla de nuevo.",
    };
  }
  return { canResume: true, reason: null };
}

async function exists(path: string): Promise<boolean> {
  if (!path) return false;
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export type ResumeStatus = ResumeCheck & { sessionId: string | null };

export async function resumeStatus(runId: string): Promise<ResumeStatus | null> {
  const run = await db.taskRun.findUnique({
    where: { id: runId },
    select: { status: true, sessionId: true, workspacePath: true },
  });
  if (!run) return null;

  const check = decideResume({
    status: run.status,
    sessionId: run.sessionId,
    workspaceExists: await exists(run.workspacePath),
  });

  return { ...check, sessionId: run.sessionId };
}

/**
 * Con qué se retoma una run que se quedó sin cuota. No hay instrucciones del
 * usuario que dar: el agente ya sabe lo que estaba haciendo, solo se le dice
 * que siga.
 */
export const RESUME_AFTER_LIMIT_PROMPT =
  "Se cortó la ejecución anterior porque se agotó la cuota. Continúa la tarea donde la dejaste.";
