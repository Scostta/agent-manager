# CLAUDE.md

Instrucciones para Claude Code cuando trabajes en este repositorio.

## Qué es esto

**Claude Cockpit** es un dashboard personal para orquestar agentes Claude Code CLI. Un solo usuario, máquina local. El usuario define proyectos, agentes (con su prompt, modelo, skills permitidas), y un kanban de tareas. Arrastrar una task al estado `in_progress` spawnea un proceso `claude` CLI que ejecuta esa tarea en un workspace aislado.

**Referencias mentales:** Paperclip (paperclipai/paperclip) y AgentManager (simonstaton/AgentManager). No copiamos ninguno, tomamos ideas.

## Stack y decisiones no-negociables

- **Monorepo con pnpm workspaces.** No añadas npm, yarn, lerna, nx, turbo. pnpm basta.
- **Backend:** Fastify 5 + TypeScript + Prisma + SQLite. ESM puro (`"type": "module"`).
- **Frontend:** Next.js 15 App Router + React 19 + Tailwind + shadcn/ui cuando necesitemos componentes complejos.
- **Cola de tasks:** `p-queue` en memoria. **No introduzcas Redis ni BullMQ** sin permiso explícito del usuario. El objetivo es correr con un `pnpm dev` y nada más.
- **Runner:** spawn del binario `claude` CLI con `--output-format stream-json`. **No uses el SDK de Anthropic directamente.** Si necesitas capacidades que el CLI no tiene, comenta primero con el usuario.
- **Tiempo real:** Server-Sent Events (SSE). **No introduzcas WebSockets** — añade complejidad que no necesitamos.
- **Validación:** Zod en todos los endpoints de API.
- **Drag & drop:** `@dnd-kit/core`. **No uses react-beautiful-dnd** (está archivado).
- **Editor:** Monaco Editor para CLAUDE.md.

## Comandos principales

```bash
# Desde el root del monorepo
pnpm dev              # API (3001) + Web (3000) en paralelo
pnpm dev:api          # solo API
pnpm dev:web          # solo frontend
pnpm db:migrate       # aplicar migraciones Prisma
pnpm db:studio        # abrir Prisma Studio
pnpm db:seed          # datos de ejemplo
pnpm typecheck        # typecheck de todo el monorepo
pnpm build            # build de producción
```

## Estructura del repo

```
apps/
  api/                         # Backend Fastify
    prisma/
      schema.prisma             # MODELO DE DATOS — mira aquí antes de tocar BD
      seed.ts
    src/
      config.ts                 # todas las env vars pasan por aquí
      db.ts                     # singleton de PrismaClient
      bus.ts                    # EventEmitter interno; runner → SSE
      runner/
        executor.ts              # spawn de claude CLI + parser stream-json
        queue.ts                 # p-queue global
        pricing.ts               # $ por millón de tokens por modelo
      skills/
        scanner.ts               # indexa SKILL.md con chokidar (hot-reload)
      routes/
        projects.ts
        agents.ts
        skills.ts
        tasks.ts                 # endpoints del kanban + lanzar runs
        claudeMd.ts
        sse.ts                   # /runs/:id/stream y /board/stream
      index.ts                   # entry point

  web/                          # Frontend Next.js
    src/
      app/                       # pages
      components/
      lib/api.ts                 # cliente HTTP + helper SSE
```

## Conceptos del dominio que tienes que tener claros

- **Project** → un repo local (ruta en disco) con un kanban de tasks propio.
- **Agent** → plantilla de ejecución: nombre, rol, modelo, `systemPrompt`, budget, y un set de `Skill` habilitadas.
- **Skill** → un `SKILL.md` indexado del filesystem. **Nunca guardamos el contenido en BD, solo ruta + hash SHA256.** Si el usuario edita un SKILL.md en disco, el scanner (chokidar) lo detecta y actualiza.
- **Task** → unidad del kanban. Estados: `todo | in_progress | review | done | blocked`. Puede tener `requiredSkillIds` y `dependsOn` (otras tasks).
- **TaskRun** → una ejecución concreta de una Task por un Agent. Separada de Task adrede: permite reintentos y auditoría de tokens. Estados: `queued | running | succeeded | failed | cancelled`.
- **ClaudeMd** → contenido markdown con scope `global | project | agent`. El del proyecto se inyecta como `CLAUDE.md` en el workspace de cada run.

## Flujo crítico: ejecución de una task

1. `POST /tasks/:id/run` → crea `TaskRun` con status `queued`, lo mete en `p-queue`.
2. Worker toma la run → `executor.executeTaskRun(runId)`:
   a. Crea workspace en `WORKSPACES_ROOT/{taskId}/{runId}/`.
   b. Copia el repo del proyecto allí (ignora `node_modules` y `.git`).
   c. Hace symlinks de las skills permitidas en `.claude/skills/{name}/`.
   d. Escribe `CLAUDE.md` del proyecto en la raíz del workspace.
   e. Construye el prompt (systemPrompt + task + lista de skills).
   f. `spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--model', model, '--permission-mode', 'acceptEdits'], { cwd: workspace, detached: true })`.
   g. Parsea cada línea de stdout como JSON, acumula tokens desde `usage`, emite eventos por `bus`.
3. Al terminar: status final, task → `review` si éxito.
4. SSE en `/runs/:id/stream` reenvía todos los eventos al frontend en vivo.

**Invariantes que no debes romper:**
- Spawn con `detached: true`. Para matar usamos `process.kill(-pid, 'SIGTERM')` para matar el process group entero.
- Guarda siempre el log NDJSON en `LOGS_ROOT/{runId}.ndjson`. Una línea = un evento.
- Una run cancelada o fallida **no** mueve la task a `review`. Solo las `succeeded`.

## Convenciones de código

- **TypeScript estricto.** Si necesitas `any`, coméntalo.
- **Imports con extensión `.js`** en la API (es ESM con tsx; los imports relativos necesitan `.js` incluso apuntando a `.ts`). Regla: si importas de `./foo.ts`, escribe `./foo.js`.
- **Paths absolutos en config**, nunca relativos. `config.ts` expande `~` y resuelve todo.
- **Errores de Prisma**: usa `reply.notFound()` / `reply.badRequest()` de `@fastify/sensible`.
- **No pongas lógica de negocio en las rutas.** Las rutas orquestan; la lógica de runner vive en `src/runner/`.
- **No duplicar tipos entre API y Web.** Si un tipo es compartido, extraer a `packages/types` antes de crecer.
- **Nombres en inglés** en código; mensajes al usuario y docs en español.
- **Comentarios explican "por qué", no "qué".** El código ya dice "qué".

## Cosas que el usuario no quiere

- ❌ Docker obligatorio para dev local.
- ❌ Multi-tenancy, organizaciones, roles, permisos. Esto es single-user.
- ❌ Autenticación compleja. Si en algún momento se añade, será un bearer token simple en .env.
- ❌ Reinventar Claude Code. Spawneamos el CLI. Punto.
- ❌ Heartbeats, cron de agentes, agentes 24/7. Este no es Paperclip.
- ❌ Inter-agent messaging. No en el MVP. Si se necesita, discutir antes.
- ❌ Abstraer prematuramente. Primero código directo que funciona, después refactor.

## Prioridad actual del MVP

1. Kanban + asignar tareas a agentes (backend ✅, frontend pendiente).
2. Skills manager centralizado (backend ✅, frontend pendiente).
3. Editor de CLAUDE.md (backend ✅, frontend pendiente).

Fase 2 (no empezar sin decirlo): dashboard de tokens/costes con Recharts. La instrumentación ya está guardando datos en `TaskRun`.

## Cosas concretas que pueden salir mal

- **`claude` CLI no está en PATH** → falla el spawn. Mensaje de error claro al usuario, no traza cruda.
- **El SKILL.md tiene frontmatter roto** → `gray-matter` lanza. El scanner debe capturarlo y loggear, no crashear la app.
- **stream-json no emite JSON en una línea** → ya hay un try/catch en `executor.ts` que lo trata como log plano. No rompas esa tolerancia.
- **El usuario borra un SKILL.md que está asignado a un agente** → la fila en `AgentSkill` queda huérfana hasta que se limpie. Aceptable por ahora; si molesta, un cleanup al arranque.
- **Workspace no se limpia al terminar la run** → adrede, para poder inspeccionar. GC manual o cuando el usuario lo decida.

## Cuándo preguntar al usuario

- Si vas a añadir una dependencia nueva que no sea trivial (> 50KB o con subdependencias pesadas).
- Si vas a cambiar el schema de Prisma.
- Si vas a introducir un concepto nuevo al modelo de dominio (un modelo, un estado nuevo en una máquina).
- Si algo en estas instrucciones choca con lo que el usuario te pide en el chat.
