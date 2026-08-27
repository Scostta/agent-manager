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
   - `failed` / `cancelled` → task vuelve a `todo` y cleanup automático, salvo
     que la run se cortara por cuota o fuera una continuación (ver más abajo)

   La task solo se toca si sigue en `in_progress`: si la moviste a mano mientras
   la run corría, se respeta tu decisión.
4. Al pasar task a `done` desde la UI → cleanup de worktrees de runs succeeded

El cierre de la run espera **tanto** al `exit` del proceso **como** al cierre de
stdout. El proceso puede salir antes de que readline haya emitido las últimas
líneas, y el evento `result` va justo al final.

## Qué se le pidió al CLI

La primera línea del NDJSON la escribe el cockpit, no el CLI:

    {"type":"cockpit","subtype":"request","model":"…","flags":[…],"resumedFrom":null,"prompt":"…"}

Hasta ahora el log solo guardaba lo que **devolvía** el CLI, así que cuando una
run salía rara no había forma de ver qué se le había pedido. Va antes del spawn,
de modo que la run que ni siquiera arranca —binario ausente— también deja
constancia. `flags` son los argumentos sin el `-p`: el prompt viaja aparte y
duplicarlo hace el log ilegible.

El visor la pinta como un bloque aparte al principio del log; los logs viejos,
que no la tienen, se leen igual.

## Herramientas por agente

Todas las runs salen con `--permission-mode acceptEdits`. Lo que acota qué puede
hacer el agente son `--allowedTools` / `--disallowedTools`, que se construyen en
`tools.ts` a partir de las dos listas del `Agent`:

- Sin listas **no se añade ningún flag**, que es como corrían todas hasta ahora.
  Ojo: `--allowedTools` con la lista vacía no es "todas", es "ninguna" — por eso
  una lista vacía se guarda como `null` y nunca llega a la línea de comandos.
- La lista viaja separada por comas en un único argv, igual que en el
  planificador, así que un patrón con espacios como `Bash(git *)` llega entero.
- Una lista ilegible en BD se ignora con un aviso; no tumba la run.

La restricción se aplica también al **retomar** una sesión: si no, bastaría con
continuar una run para recuperar las herramientas que el agente no debía tener.

## Continuar una sesión

Cada run es un `-p` de un solo tiro, pero no tiene por qué empezar de cero. El
CLI anuncia un `session_id` en el evento `init` y lo guardamos en la `TaskRun`;
con él, `--resume <sessionId>` sigue la conversación en vez de reconstruirla.

Una **continuación** es una `TaskRun` nueva con `resumedFromId` apuntando al
padre. Hereda su workspace y su rama — el CLI indexa las sesiones por el
directorio donde corrieron, así que fuera de él no las encuentra — y como no es
suyo, **nunca lo limpia**: si la limpiase al fallar se llevaría por delante el
trabajo del padre.

Al retomar se le manda solo el `followUpPrompt`, no el prompt entero: el
systemPrompt, la task y las skills ya están en la sesión y repetirlos sería
pagarlos otra vez. El `sessionId` que guarda la continuación es el que devuelve
*su* ejecución, así que la siguiente vuelta encadena bien aunque el CLI cambie el
id al retomar.

Dos caminos llegan aquí:

- **"Seguir con instrucciones"** (`POST /runs/:id/resume`): "casi, pero cambia X"
  al revisar un diff. Si la sesión no se puede retomar **falla**, no relanza de
  cero: quien pide un ajuste no espera pagar una run entera.
- **Reintentos por cuota** (`POST /runs/:id/retry` y el scheduler): retoman si
  pueden y empiezan de cero si no, informando de cuál de las dos fue. Por eso una
  run cortada por cuota (`failureKind = "rate_limit"`) **conserva su workspace**
  pese a estar `failed`: es lo que el reintento necesita para retomar ahí mismo.

El GC lo tiene en cuenta: una carpeta se fecha por la run más reciente que la
usó, no por la que le da nombre.

## Merge de CLAUDE.md

Al workspace de cada run se inyectan los CLAUDE.md que le tocan, en este orden:

1. El de scope `global`, si existe. Vale para todas las runs de cualquier
   proyecto y solo puede haber uno. No cuelga de ninguna FK, así que el executor
   va a buscarlo con un `findFirst`.
2. El de scope `project` del proyecto de la task, vinculado por
   `Project.claudeMdId` (se escribe desde `PATCH /projects/:id`).

Lo específico va después de lo general, para que el proyecto pueda matizar lo
global.

Si el repo ya trae su propio `CLAUDE.md`, **no se sobreescribe**: lo del cockpit
se anexa al final en un único bloque marcado con `<!-- claude-cockpit -->`. Un
solo marcador para las dos secciones, y así el invariante es simple: todo lo que
va detrás es nuestro y se reemplaza entero. Por eso reinyectar es idempotente, y
por eso una continuación —que reinyecta sobre el workspace del padre— no acumula
copias vuelta tras vuelta.

Sin nada que inyectar no se crea el fichero: un CLAUDE.md vacío solo sería ruido.

## Aviso al terminar

Al cerrar una run se emite por el canal `board` un `run_finished` con
`runId`, `taskId`, `taskTitle`, `agentName` y `status`. Lleva el título y el
agente dentro a propósito: quien lo consume es una notificación del navegador y
pedir esos datos aparte para pintarla sería un viaje de más.

El listener vive en el `AppShell`, no en una ruta: el aviso solo sirve si llega
estés donde estés. Solo salta con la pestaña de fondo —con el cockpit delante la
UI ya se actualiza sola— y nunca por una run cancelada, que la cancelaste tú.

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
