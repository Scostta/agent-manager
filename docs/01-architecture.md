# Arquitectura

## Visión general

Claude Cockpit es un sistema de un solo proceso de backend más un frontend Next.js, corriendo ambos en la máquina del usuario. El backend hace las veces de API HTTP y de worker de ejecución de agentes. No hay microservicios, ni colas externas, ni base de datos remota.

## Componentes

### API (Fastify)

Expone HTTP REST + dos endpoints SSE. Todas las entradas se validan con Zod. CORS abierto porque es localhost.

### Runner

Módulo aislado en `apps/api/src/runner/`. Piezas:

- **`workspace.ts`** — manager híbrido. Detecta si el `repoPath` del proyecto es un repo Git y elige estrategia: `git worktree add` o copia recursiva con exclusiones.
- **`queue.ts`** — `PQueue` con `concurrency: 2`. Punto de entrada: `enqueueTaskRun(taskId, agentId)`.
- **`executor.ts`** — lógica de ejecución de una `TaskRun`. Spawnea `claude` CLI, parsea stream-json.
- **`reaper.ts`** — marca como `failed` runs que quedaron en `running`/`queued` de sesiones anteriores.
- **`pricing.ts`** — tabla de precios para calcular coste en USD.

El runner vive en el mismo proceso que la API por simplicidad.

### Event bus

`EventEmitter` de Node. Dos topics:
- `run:${runId}` — eventos de una run concreta (stream, tokens, status, log).
- `board` — cambios a nivel kanban.

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
- Al terminar OK, el worktree se queda para revisión humana.
- Al pasar la task a "done", se limpia con `git worktree remove` + `git branch -D`.
- Si falla/cancela, cleanup inmediato.

**`copy`** (carpetas planas):
- Copia recursiva excluyendo `node_modules`, `.git`, `.next`, `dist`, `build`.
- Al terminar failed/cancelled, borra recursivo.
- Al terminar OK, se queda para revisión y se borra al pasar a "done".

## Compatibilidad Windows

Todo el runner tiene abstracciones multiplataforma:

- **Kill de procesos**: `killProcessTree()` usa `taskkill /T /F` en Windows y `process.kill(-pid)` en Unix.
- **Spawn**: `spawnOptions()` devuelve `detached: false` en Windows (para no abrir consolas nuevas) y `detached: true` en Unix (para crear process group).
- **Symlinks**: `injectWorkspaceResources()` usa `'junction'` en Windows (no requiere admin) y `'dir'` en Unix.
- **Paths**: `toPosix()` normaliza separadores para comparaciones cross-platform (fix del bug de `scopeFromPath`).
