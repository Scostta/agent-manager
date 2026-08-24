# Arquitectura

## Visión general

Claude Cockpit es un sistema de **un solo proceso de backend** más un frontend Next.js, corriendo ambos en la máquina del usuario. El backend hace las veces de API HTTP y de worker de ejecución de agentes. No hay microservicios, ni colas externas, ni base de datos remota.

```
┌───────────────────────────────┐
│  Navegador (localhost:3000)   │
│  Next.js 15 + Tailwind        │
└───────────────┬───────────────┘
                │ HTTP / SSE
                ▼
┌───────────────────────────────┐
│  Fastify (localhost:3001)     │
│                               │
│  ┌─────────────────────────┐  │
│  │ Routes (Zod-validated)  │  │
│  │  projects, agents,      │  │
│  │  skills, tasks,         │  │
│  │  claudeMd, sse          │  │
│  └───────────┬─────────────┘  │
│              │                │
│  ┌───────────▼─────────────┐  │
│  │ Bus (EventEmitter)      │◄─┐
│  └─────────────────────────┘  │
│              ▲                │
│  ┌───────────┴─────────────┐  │
│  │ Runner (p-queue)        │  │
│  │   executor.ts           │  │
│  └───────────┬─────────────┘  │
│              │                │
│  ┌───────────▼─────────────┐  │
│  │ SQLite (Prisma)         │  │
│  └─────────────────────────┘  │
└───────────────┬───────────────┘
                │ spawn
                ▼
┌───────────────────────────────┐
│  claude CLI                   │
│  (stream-json sobre stdout)   │
└───────────────────────────────┘
```

## Componentes

### API (Fastify)

Expone HTTP REST + dos endpoints SSE. Todas las entradas se validan con Zod. CORS abierto porque es localhost.

### Runner

Módulo aislado en `apps/api/src/runner/`. Dos piezas:

- **`queue.ts`** — `PQueue` con `concurrency: 2`. Es lo único que encola trabajo.
- **`executor.ts`** — lógica de ejecución de una `TaskRun` concreta.

El runner vive en el mismo proceso que la API. Esto simplifica porque no hay IPC, pero implica que si la API cae, se pierden las runs en curso. Es aceptable para uso personal. Si un día molesta, se mueve a un proceso aparte sin tocar el modelo.

### Event bus

`EventEmitter` de Node. Dos topics:

- `run:${runId}` — eventos de una run concreta (stream, tokens, status, log).
- `board` — cambios a nivel kanban.

Los endpoints SSE se suscriben al topic relevante y hacen `write` en la respuesta. Cuando el cliente cierra la conexión, se desuscribe.

### Skills scanner

`chokidar` vigila las rutas configuradas en `SKILLS_PATHS`. Cuando aparece, cambia o desaparece un `SKILL.md`, actualiza la tabla `Skill` (ruta + hash + frontmatter parseado). El contenido nunca se duplica en BD.

### Base de datos

SQLite con Prisma. El fichero vive en `apps/api/prisma/dev.db`. Se puede inspeccionar con `pnpm db:studio`.

## Contratos entre componentes

- **API → Runner:** `enqueueTaskRun(taskId, agentId)` devuelve `runId`. La API nunca espera a que termine la run.
- **Runner → Bus:** emite eventos tipados (ver `bus.ts` para el tipo `RunEvent`).
- **Runner → BD:** actualiza `TaskRun` con tokens y status. También mueve la `Task` a `review` al completarse con éxito.
- **Bus → SSE:** push directo al cliente. Serialización JSON line-delimited.

## Aislamiento de workspaces

Cada `TaskRun` obtiene su propio directorio `WORKSPACES_ROOT/{taskId}/{runId}/`. Se copia el repo del proyecto allí al arrancar. Esto:

- Evita que runs paralelas de la misma task se pisen.
- Permite inspeccionar qué dejó un agente aunque la task haya avanzado.
- Facilita implementar "checkpoint": guardar el workspace y volver a él.

**Trade-off:** consume disco. Para repos grandes podría usarse `git worktree` en vez de copia; queda como optimización futura.

## Por qué SSE y no WebSockets

Los flujos que necesitamos son unidireccionales: servidor → cliente (logs, updates del kanban). SSE es HTTP estándar, se abre con `EventSource`, reconecta solo, y no requiere librería en el servidor más allá de escribir `data: ...\n\n`. WebSockets aportan bidireccionalidad que no usamos.

## Por qué SQLite y no Postgres

- Single-user, single-machine. Postgres sería montar un servicio para nada.
- Prisma soporta ambos; migrar es cambiar `provider` y la URL.
- Backup trivial: copiar el `.db`.

Si en el futuro se quiere acceso multi-máquina o concurrencia alta de escrituras, Postgres es el camino.
