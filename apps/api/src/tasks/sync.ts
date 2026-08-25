import { db } from "../db.js";
import { bus } from "../bus.js";
import {
  liveDependencies,
  nextStatusFor,
  pendingDependencies,
  wouldCreateCycle,
  type DependencyState,
} from "./dependencies.js";

/** SQLite guarda `dependsOn` como JSON string. */
export function parseIdList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function statesOf(ids: string[]): Promise<DependencyState[]> {
  if (ids.length === 0) return [];
  const tasks = await db.task.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true },
  });
  const byId = new Map(tasks.map((task) => [task.id, task.status]));
  return ids.map((id) => ({ id, status: byId.get(id) ?? null }));
}

export type DependencyView = {
  id: string;
  title: string | null;
  status: string | null;
  done: boolean;
};

/** Lo que la UI necesita para explicar por qué una tarea no puede arrancar. */
export async function dependencyView(dependsOn: string[]): Promise<DependencyView[]> {
  if (dependsOn.length === 0) return [];
  const tasks = await db.task.findMany({
    where: { id: { in: dependsOn } },
    select: { id: true, title: true, status: true },
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));

  return dependsOn.map((id) => {
    const task = byId.get(id);
    return {
      id,
      title: task?.title ?? null,
      status: task?.status ?? null,
      // Una dependencia borrada no bloquea, así que cuenta como resuelta.
      done: !task || task.status === "done",
    };
  });
}

export async function blockingDependencies(taskId: string): Promise<string[]> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { dependsOn: true } });
  if (!task) return [];
  return pendingDependencies(await statesOf(parseIdList(task.dependsOn)));
}

/**
 * Recalcula el estado de una tarea según sus dependencias. Solo mueve entre
 * `todo` y `blocked`; si está corriendo o cerrada, no se toca.
 */
export async function syncTaskBlocking(taskId: string): Promise<boolean> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, dependsOn: true },
  });
  if (!task) return false;

  const next = nextStatusFor(task.status, await statesOf(parseIdList(task.dependsOn)));
  if (!next) return false;

  await db.task.update({ where: { id: task.id }, data: { status: next.status } });
  bus.emit("board", { type: "task_updated", taskId: task.id });
  console.info(`[deps] ${task.id}: ${task.status} → ${next.status} (${next.reason})`);
  return true;
}

/**
 * Recalcula las tareas que dependen de `taskId`. Se llama cuando esa tarea
 * cambia de estado: es lo que desbloquea la cadena al marcar algo como hecho.
 */
export async function syncDependents(taskId: string): Promise<number> {
  // dependsOn es JSON en una columna de texto, así que el filtro fino se hace
  // en memoria: en un tablero personal son unas decenas de filas.
  const candidates = await db.task.findMany({
    where: { dependsOn: { contains: taskId } },
    select: { id: true, dependsOn: true },
  });

  let changed = 0;
  for (const candidate of candidates) {
    if (!parseIdList(candidate.dependsOn).includes(taskId)) continue;
    if (await syncTaskBlocking(candidate.id)) changed++;
  }
  return changed;
}

/** Quita de las demás tareas las referencias a una que se borra. */
export async function forgetDependency(taskId: string): Promise<void> {
  const referencing = await db.task.findMany({
    where: { dependsOn: { contains: taskId } },
    select: { id: true, dependsOn: true },
  });

  for (const task of referencing) {
    const ids = parseIdList(task.dependsOn);
    if (!ids.includes(taskId)) continue;
    await db.task.update({
      where: { id: task.id },
      data: { dependsOn: JSON.stringify(ids.filter((id) => id !== taskId)) },
    });
    await syncTaskBlocking(task.id);
  }
}

export class DependencyError extends Error {}

/**
 * Valida lo que se va a guardar en `dependsOn`: que las tareas existan, sean
 * del mismo proyecto y no cierren un ciclo.
 */
export async function validateDependencies(
  taskId: string | null,
  projectId: string,
  dependsOn: string[],
): Promise<string[]> {
  const unique = [...new Set(dependsOn)];
  if (unique.length === 0) return [];

  if (taskId && unique.includes(taskId)) {
    throw new DependencyError("Una tarea no puede depender de sí misma.");
  }

  const tasks = await db.task.findMany({
    where: { id: { in: unique } },
    select: { id: true, projectId: true },
  });

  const missing = unique.filter((id) => !tasks.some((task) => task.id === id));
  if (missing.length > 0) {
    throw new DependencyError(`Estas tareas no existen: ${missing.join(", ")}`);
  }

  const foreign = tasks.filter((task) => task.projectId !== projectId);
  if (foreign.length > 0) {
    throw new DependencyError(
      "Las dependencias tienen que ser tareas del mismo proyecto.",
    );
  }

  if (taskId) {
    const all = await db.task.findMany({
      where: { projectId },
      select: { id: true, dependsOn: true },
    });
    const graph = new Map(all.map((task) => [task.id, parseIdList(task.dependsOn)]));
    if (wouldCreateCycle(taskId, unique, graph)) {
      throw new DependencyError(
        "Eso crearía un ciclo de dependencias: ninguna de las tareas implicadas podría arrancar nunca.",
      );
    }
  }

  return unique;
}

/** Ids que siguen existiendo, para limpiar referencias muertas al leer. */
export async function pruneDeadDependencies(dependsOn: string[]): Promise<string[]> {
  return liveDependencies(await statesOf(dependsOn));
}
