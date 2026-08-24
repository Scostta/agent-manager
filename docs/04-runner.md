# El Runner

Módulo crítico. Convierte una task en un proceso `claude` CLI.

## Ciclo de vida

1. `enqueueTaskRun` crea `TaskRun` status `queued`, mueve `Task` a `in_progress`, encola en `p-queue`.
2. Worker toma la run → `executeTaskRun(runId)`:
   1. `setupWorkspace` según `project.workspaceStrategy`:
      - `worktree`: `git worktree add -b cockpit/task-{id}/run-{id} <path> HEAD`
      - `copy`: `copyDirShallow` con exclusiones
   2. `injectWorkspaceResources`: symlinks de skills (junction/dir) + merge de `CLAUDE.md`
   3. Construye prompt
   4. Spawn `claude` con `spawnOptions()` multiplataforma
   5. Parseo stream-json línea a línea, actualiza tokens, emite bus
3. Al terminar:
   - `succeeded` → task pasa a `review`, workspace queda para revisión
   - `failed` / `cancelled` → task vuelve a `todo` y cleanup automático

   La task solo se toca si sigue en `in_progress`: si la moviste a mano mientras
   la run corría, se respeta tu decisión.
4. Al pasar task a `done` desde la UI → cleanup de worktrees de runs succeeded

El cierre de la run espera **tanto** al `exit` del proceso **como** al cierre de
stdout. El proceso puede salir antes de que readline haya emitido las últimas
líneas, y el evento `result` va justo al final.

## Merge de CLAUDE.md

Si el repo ya trae su propio `CLAUDE.md`, **no se sobreescribe**: el contenido del
cockpit se anexa al final en una sección marcada con `<!-- claude-cockpit -->`.
La operación es idempotente — reinyectar reemplaza esa sección, no la duplica.

El `ClaudeMd` de scope `project` se vincula escribiendo `claudeMdId` en el
proyecto (`PATCH /projects/:id`).

## Cancelación

`cancelRun(runId)` marca la run en un `Set` de canceladas y después llama a
`killProcessTree(pid)`:

- Windows: `taskkill /PID {pid} /T /F`
- Unix: `process.kill(-pid, 'SIGTERM')` (process group)

El `Set` es necesario porque `taskkill` no deja señal: en Windows el proceso sale
con `code != 0` y `signal: null`, indistinguible de un fallo real. Sin esa marca
previa toda cancelación quedaría registrada como `failed`.

## Contabilidad de tokens y coste

El stream-json emite un evento `assistant` **por cada bloque de contenido** del
mismo mensaje, todos con el mismo `usage`, y el evento `result` final repite el
agregado. Sumar sin más todos los `usage` que pasan multiplica el consumo real
(x3 medido en pruebas). Por eso:

- Los eventos `assistant` se deduplican por `message.id`: se guarda el último
  snapshot de cada mensaje y se suman los mensajes distintos.
- El evento `result` es autoritativo. Sus tokens salen de `modelUsage` (que
  incluye subagentes y modelos auxiliares, a diferencia del `usage` de nivel
  superior) y el coste de `total_cost_usd`.
- `pricing.ts` solo sirve como estimación en vivo mientras la run está en marcha.
  Un modelo desconocido cae a la tarifa más cara, para que el guard de
  presupuesto sobreestime en lugar de dejar pasar gasto.
- Se registran cuatro contadores: input, output, cache **read** y cache **write**
  (`cache_creation_input_tokens`, facturado a 1.25x — suele ser el componente
  dominante del coste real).

Los escritos a BD se agrupan en un flush cada segundo en vez de uno por evento,
para no saturar SQLite con updates concurrentes sobre la misma fila.

## Budget

Cada actualización de tokens recalcula coste. Si supera `agent.maxBudgetUsd`, se
cancela la run.

## Concurrencia

`p-queue` con `concurrency: 2` por defecto (en `queue.ts`).
