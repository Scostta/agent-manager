/**
 * Reglas de `dependsOn`. Todo lo de aquí es puro: recibe el estado del grafo y
 * decide, sin tocar BD.
 *
 * Una dependencia se considera cumplida solo cuando su tarea está en `done`:
 * en `review` el agente ha terminado pero nadie ha revisado ni integrado el
 * diff, así que la dependiente trabajaría sobre algo que aún puedes rechazar.
 */

/** `status: null` significa que esa tarea ya no existe. */
export type DependencyState = { id: string; status: string | null };

const DONE = "done";

/**
 * Los ids que impiden arrancar. Una dependencia borrada no cuenta: si contara,
 * la dependiente quedaría bloqueada para siempre sin forma de arreglarlo desde
 * la UI.
 */
export function pendingDependencies(deps: DependencyState[]): string[] {
  return deps.filter((dep) => dep.status !== null && dep.status !== DONE).map((dep) => dep.id);
}

export function isBlocked(deps: DependencyState[]): boolean {
  return pendingDependencies(deps).length > 0;
}

/** Ids que sobreviven a limpiar los que ya no existen. */
export function liveDependencies(deps: DependencyState[]): string[] {
  return deps.filter((dep) => dep.status !== null).map((dep) => dep.id);
}

export type NextStatus = { status: string; reason: string } | null;

/**
 * Qué estado le toca a una tarea según sus dependencias. Devuelve null cuando
 * no hay que tocar nada.
 *
 * Solo movemos entre `todo` y `blocked`: si la tarea está corriendo, en
 * revisión o cerrada, el cockpit no tiene por qué reordenar el tablero por su
 * cuenta. Y desbloquear la deja lista para lanzar, nunca la lanza: eso lo
 * decides tú, como con el resto de gasto.
 */
export function nextStatusFor(current: string, deps: DependencyState[]): NextStatus {
  const pending = pendingDependencies(deps);

  if (pending.length > 0) {
    if (current !== "todo") return null;
    return {
      status: "blocked",
      reason: `depende de ${pending.length} tarea(s) sin terminar`,
    };
  }

  if (current === "blocked") {
    return { status: "todo", reason: "todas sus dependencias están hechas" };
  }
  return null;
}

/**
 * ¿Añadir estas dependencias a `taskId` cerraría un ciclo? Un ciclo deja a
 * todas las tareas implicadas bloqueadas para siempre, así que se rechaza al
 * guardar en vez de descubrirlo al intentar lanzar.
 */
export function wouldCreateCycle(
  taskId: string,
  nextDeps: string[],
  graph: Map<string, string[]>,
): boolean {
  if (nextDeps.includes(taskId)) return true;

  const merged = new Map(graph);
  merged.set(taskId, nextDeps);

  const visiting = new Set<string>();
  const done = new Set<string>();

  function visit(node: string): boolean {
    if (visiting.has(node)) return true;
    if (done.has(node)) return false;

    visiting.add(node);
    for (const next of merged.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    done.add(node);
    return false;
  }

  return visit(taskId);
}
