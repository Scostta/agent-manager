# Arquitectura

## Visión general

Claude Cockpit es un sistema de un solo proceso de backend más un frontend Next.js, corriendo ambos en la máquina del usuario. El backend hace las veces de API HTTP y de worker de ejecución de agentes. No hay microservicios, ni colas externas, ni base de datos remota.

## Componentes

### API (Fastify)

Expone HTTP REST + tres endpoints SSE (una run, el board, la planificación de un
proyecto nuevo). Todas las entradas se validan con Zod, y un `ZodError` sale
como 400 con el detalle, no como un 500 opaco.

Ni CORS ni el host están abiertos, y es deliberado: `HOST` es `127.0.0.1` y
`CORS_ORIGINS` una lista cerrada. Escuchar en `0.0.0.0` dejaría a cualquiera de
tu red lanzar procesos `claude` con permisos de escritura sobre este disco.

`app.ts` solo monta plugins y rutas; `index.ts` es el arranque de verdad
(reaper, scanner, reintentos pendientes, GC, `listen`). Esa separación es lo que
permite a los tests levantar la app con `app.inject()` sin abrir un puerto.

### Runner

Módulo aislado en `apps/api/src/runner/`. Piezas:

- **`workspace.ts`** — manager híbrido. Detecta si el `repoPath` del proyecto es un repo Git y elige estrategia: `git worktree add` o copia recursiva con exclusiones.
- **`queue.ts`** — `PQueue`. La concurrencia arranca en `QUEUE_CONCURRENCY` (2) pero se cambia en caliente desde la UI, junto con la pausa y el kill switch. Puntos de entrada: `enqueueTaskRun`, `relaunchRun` y `continueRun`.
- **`executor.ts`** — lógica de ejecución de una `TaskRun`. Spawnea `claude` CLI, parsea stream-json.
- **`integrate.ts`** — estado de integración de la rama (derivado de git en vivo, no de la BD), merge y descarte.
- **`gc.ts`** — barrido de `WORKSPACES_ROOT` por edad. La tabla de decisión está aparte de su ejecución para poder probarla sola.
- **`rateLimit.ts`** — detecta que se agotó la cuota del plan y saca de dónde puede la hora de reset.
- **`scheduler.ts`** — reintento programado a esa hora. El timer vive en memoria, pero la intención está en la BD, así que un reinicio no pierde la espera.
- **`resume.ts`** — si la sesión de una run se puede retomar y, si no, por qué.
- **`tools.ts`** — traduce las listas de herramientas del agente a flags del CLI.
- **`reaper.ts`** — marca como `failed` las runs que quedaron en `running`/`queued` de sesiones anteriores, y devuelve sus tasks a `todo`: una task no puede quedarse en `in_progress` sin nada ejecutándose.
- **`pricing.ts`** — tabla de precios para estimar coste en USD mientras la run corre. Al terminar manda el `total_cost_usd` del CLI.

El runner vive en el mismo proceso que la API por simplicidad.

### Event bus

`EventEmitter` de Node. Tres topics:
- `run:${runId}` — eventos de una run concreta (stream, tokens, status, log).
- `board` — cambios del kanban, de la cola, y `run_finished` al terminar una run (lo que alimenta el aviso del navegador).
- `plan:${projectId}` — progreso del planificador mientras propone el backlog inicial.

Los tipos exactos de cada uno están en `apps/api/src/bus.ts`.

### Skills scanner

`chokidar` vigila las rutas de `SKILLS_PATHS`. Cuando aparece, cambia o desaparece un `SKILL.md`, actualiza la tabla `Skill` (ruta + hash + frontmatter parseado).

### Base de datos

SQLite con Prisma. Fichero en `apps/api/prisma/dev.db`. Inspeccionable con `pnpm db:studio`.

## Estrategias de workspace

Cada `TaskRun` obtiene un workspace aislado en `WORKSPACES_ROOT/{taskId}/{runId}/`. Cómo se construye depende del proyecto:

**`worktree`** (proyectos que son repo Git):
- Ejecuta `git worktree add -b cockpit/task-X/run-Y <workspacePath> HEAD`.
- Comparte storage con el repo original (solo diffs).
- El agente puede commitear en su rama.
- Al terminar OK, el worktree se queda para revisión humana: de ahí sale el diff
  y el botón de mergear.
- Al pasar la task a "done" se limpia con `git worktree remove` + `git branch -D`,
  **pero solo si su trabajo ya está integrado**. Una rama sin mergear es el único
  sitio donde vive lo que hizo el agente, así que se conserva y decides tú.
- Si falla o se cancela, cleanup inmediato — con las excepciones de abajo.

**`copy`** (carpetas planas):
- Copia recursiva excluyendo `node_modules`, `.git`, `.next`, `dist`, `build`.
- No copia `.env` (salvo `.env.example` y similares) ni bases de datos locales
  `.db`/`.sqlite`: un workspace es un sandbox donde corre un agente autónomo que
  vuelca a un log lo que lee, y ahí dentro el `.env` son credenciales regaladas.
- Al terminar failed/cancelled, borra recursivo.
- Al terminar OK, se queda para revisión y se borra al pasar a "done".

**Dos excepciones al cleanup automático**, y las dos importan:

- Una run cortada por **falta de cuota** conserva su workspace pese a estar
  `failed`: es a donde vuelve el reintento para retomar la sesión, y donde está
  lo que el agente ya había hecho antes del corte.
- Una **continuación** (una run con `resumedFromId`) vive en el workspace del
  padre y no lo limpia nunca. Quien crea el workspace es quien lo borra; si no,
  una continuación fallida se llevaría por delante el trabajo del padre.

## GC de workspaces

Además del cleanup por run, un barrido periódico (`WORKSPACE_GC_DAYS`,
`WORKSPACE_GC_INTERVAL_HOURS`) libera lo que lleva tiempo parado. La regla que
nunca rompe: **liberar disco no puede destruir trabajo que no esté guardado en
ningún otro sitio.**

- Si hay cambios sin commitear, no toca nada, por viejo que sea.
- En worktree, la rama es esa otra copia: de un worktree con commits sin
  integrar borra la carpeta y conserva la rama.
- En copy no hay red de seguridad, así que solo borra runs que fallaron o cuya
  tarea ya está cerrada.
- Una carpeta huérfana no es permiso para borrar a lo bruto: si la BD se recrea
  o cambia `WORKSPACES_ROOT`, *todo* parece huérfano. Ahí mandan los hechos del
  disco, no la ausencia de registro.
- La edad de una carpeta es la de la run más reciente que la usó, no la de la
  que le da nombre: si no, una continuación trabajando dentro parecería
  abandonada.

## Compatibilidad Windows

Todo el runner tiene abstracciones multiplataforma:

- **Kill de procesos**: `killProcessTree()` usa `taskkill /T /F` en Windows y `process.kill(-pid)` en Unix.
- **Spawn**: `spawnOptions()` devuelve `detached: false` en Windows (para no abrir consolas nuevas) y `detached: true` en Unix (para crear process group).
- **Symlinks**: `injectWorkspaceResources()` usa `'junction'` en Windows (no requiere admin) y `'dir'` en Unix.
- **Paths**: `toPosix()` normaliza separadores para comparaciones cross-platform (fix del bug de `scopeFromPath`).
