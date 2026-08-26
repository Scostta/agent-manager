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
- **Tiempo real:** Server-Sent Events (SSE). **No introduzcas WebSockets** — añaden complejidad que no necesitamos.
- **Validación:** Zod en todos los endpoints de API.
- **Drag & drop:** `@dnd-kit/core`. **No uses react-beautiful-dnd** (está archivado).
- **Editor:** Monaco Editor para CLAUDE.md.
- **Workspaces:** estrategia híbrida `worktree` / `copy` según si el `repoPath` del proyecto es un repo Git o no.

## Comandos principales

```powershell
# Desde el root del monorepo (PowerShell en Windows)
pnpm dev              # API (3001) + Web (3000) en paralelo
pnpm dev:api          # solo API
pnpm dev:web          # solo frontend
pnpm db:migrate       # aplicar migraciones Prisma
pnpm db:studio        # abrir Prisma Studio
pnpm db:seed          # datos de ejemplo
pnpm typecheck        # typecheck de todo el monorepo
pnpm test             # tests con node:test (por ahora solo apps/api)
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
      lib/
        git.ts                   # helpers de git (worktree, diff, etc)
        process.ts               # kill multiplataforma (taskkill / signals)
        paths.ts                 # normalización POSIX de paths
      runner/
        workspace.ts             # setup híbrido worktree/copy
        executor.ts              # spawn de claude CLI, parser stream-json
        queue.ts                 # p-queue global
        pricing.ts               # $ por millón de tokens por modelo
        reaper.ts                # limpia runs huérfanas al arrancar
      skills/
        scanner.ts               # indexa SKILL.md con chokidar (hot-reload)
      routes/
        projects.ts
        agents.ts
        skills.ts
        tasks.ts                 # endpoints del kanban + lanzar runs
        claudeMd.ts
        sse.ts                   # /runs/:id/stream y /board/stream
        queue.ts                 # /queue/stats y /runs/:id/diff
      test/
        harness.ts               # SQLite temporal para los tests con BD
      app.ts                     # buildApp(): plugins + rutas, sin arrancar nada
      index.ts                   # entry point: arranque real (reaper, scanner, GC, listen)

  web/                          # Frontend Next.js
    src/
      app/
        <ruta>/
          page.tsx               # server component delgado: metadata + monta la vista
          _components/           # componentes de ESA ruta, colocados aquí
      components/
        shell/                   # app-shell, sidebar, header, command palette
        ui/                      # primitivos compartidos (Icon, Modal, Toast, …)
      lib/
        api.ts                   # cliente HTTP + helper SSE
        hooks.ts                 # hooks SWR + streams SSE
        types.ts                 # espejo de los modelos de la API
        format.ts
```

**Convenciones del frontend:**
- Un componente usado por una sola ruta vive en el `_components/` de esa ruta. Solo sube a `src/components/` cuando lo comparten varias.
- Client components con sufijo `.client.tsx`; `"use client"` solo cuando hace falta.
- `export default` únicamente en `page.tsx` y `layout.tsx`; el resto, named exports.
- Props tipadas inline y retorno `: ReactElement`.
- `import type` agrupado al final del bloque de imports. Alias `@/` para lo compartido, relativo para hermanos dentro de `_components/`.
- `as const` en objetos de constantes.

## Conceptos del dominio

- **Project** → un repo local o carpeta. Tiene su propio kanban.
  - `workspaceStrategy: "worktree"` si es repo Git → cada run usa `git worktree` con rama nueva.
  - `workspaceStrategy: "copy"` si no es repo Git → copia recursiva (excluye `node_modules`, `.git`, `.next`, `dist`, `build`).
  - La estrategia se detecta automáticamente al crear el proyecto.
- **Agent** → plantilla de ejecución: nombre, rol, modelo, `systemPrompt`, budget, y un set de `Skill` habilitadas.
- **Skill** → un `SKILL.md` indexado del filesystem. **Nunca guardamos el contenido en BD, solo ruta + hash SHA256.** Si el usuario edita un SKILL.md en disco, el scanner (chokidar) lo detecta y actualiza.
- **Task** → unidad del kanban. Estados: `todo | in_progress | review | done | blocked`. Puede tener `requiredSkillIds` y `dependsOn` (otras tasks).
- **TaskRun** → una ejecución concreta de una Task por un Agent. Separada de Task adrede: permite reintentos y auditoría de tokens. Estados: `queued | running | succeeded | failed | cancelled`. Guarda `branchName` si la estrategia es worktree.
- **ClaudeMd** → contenido markdown con scope `global | project | agent`. El del proyecto se inyecta como `CLAUDE.md` en el workspace de cada run.

## Flujo crítico: ejecución de una task

1. `POST /tasks/:id/run` → crea `TaskRun` con status `queued`, lo mete en `p-queue`.
2. Worker toma la run → `executor.executeTaskRun(runId)`:
   a. `setupWorkspace()` → si worktree: `git worktree add`. Si copy: `copyDirShallow`.
   b. `injectWorkspaceResources()` → symlinks de skills (junction en Windows, dir en Unix) + CLAUDE.md.
   c. Construye el prompt (systemPrompt + task + lista de skills).
   d. `spawn` del binario `claude` con `-p`, `--output-format stream-json` y `spawnOptions()` multiplataforma.
   e. Parsea cada línea de stdout como JSON, acumula tokens desde `usage`, emite eventos por `bus`.
3. Al terminar: status final, task → `review` si éxito. Cleanup automático si `failed`/`cancelled`.
4. Al pasar la task a `done`, cleanup de worktrees de runs `succeeded`.
5. SSE en `/runs/:id/stream` reenvía todos los eventos al frontend en vivo.

**Invariantes que no debes romper:**
- Windows usa `spawn` sin `detached` + `killProcessTree` con taskkill.
- Unix usa `spawn` con `detached: true` + kill del process group.
- Todo esto ya está en `src/lib/process.ts`, no lo reimplementes.
- Guarda siempre el log NDJSON en `LOGS_ROOT/{runId}.ndjson`. Una línea = un evento.
- Una run cancelada o fallida **no** mueve la task a `review`. Solo las `succeeded`.

## Tests

- **Runner:** `node:test` con `tsx`. Sin dependencias de test — no metas vitest
  ni jest sin permiso explícito.
- **Dónde:** junto al código que prueban, como `foo.test.ts`. `tsconfig.json`
  los typechequea; `tsconfig.build.json` los saca del build junto con
  `src/test/`.
- **Qué se prueba:** lo que falla en silencio y sale caro. Lógica pura
  (`rateLimit`, `pricing`, copia de workspace, helpers de git contra repos
  temporales, dependencias, parseo del planificador, guard de rutas) y, con BD
  de verdad, el scanner de skills, el executor y las rutas.
- **Tests con BD:** `src/test/harness.ts` monta una SQLite temporal aplicando
  los `migration.sql` con `node:sqlite`. **Impórtalo siempre el primero**: fija
  el entorno antes de que `config.ts` y `db.ts` se evalúen, y si `db.ts` carga
  antes, el cliente se conecta al `dev.db` real. Nada de mockear Prisma.
- **Tests del executor:** no se spawnea el CLI. `runtime.spawn` se sustituye por
  un proceso simulado que escupe stream-json; lo que se prueba es el parseo, el
  recuento de tokens y en qué estado acaban run y task.
- **Rutas:** `app.inject()` sobre `buildApp()` (`src/app.ts`). `index.ts` es
  solo el arranque de verdad — no lo importes desde un test o abrirá un puerto.
- Un test que no falla cuando reintroduces el bug no vale: comprueba que falla
  antes de darlo por bueno.

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

## Windows-specific gotchas ya resueltos

- `scopeFromPath` normaliza separadores con `toPosix()`.
- `spawnOptions()` devuelve `detached: false` en Windows.
- `killProcessTree` usa `taskkill /T /F` en Windows.
- Symlinks de skills usan `'junction'` en Windows (no requiere admin).
- Reaper de runs huérfanas al arrancar.

## Cosas concretas que pueden salir mal

- **`claude` CLI no está en PATH** → falla el spawn. Mensaje de error claro al usuario, no traza cruda.
- **El SKILL.md tiene frontmatter roto** → `gray-matter` lanza. El scanner debe capturarlo y loggear, no crashear la app.
- **stream-json no emite JSON en una línea** → ya hay un try/catch en `executor.ts` que lo trata como log plano. No rompas esa tolerancia.
- **El usuario borra un SKILL.md que está asignado a un agente** → la fila en `AgentSkill` queda huérfana hasta que se limpie. Aceptable por ahora.
- **Workspace no se limpia al terminar la run** → adrede en runs `succeeded`, para poder inspeccionar el diff. Se limpia al pasar la task a `done` (solo si su trabajo ya está integrado) y, pasados `WORKSPACE_GC_DAYS`, por el GC. El GC nunca borra cambios sin commitear ni copias de runs con la tarea abierta; de un worktree con commits sin integrar borra la carpeta pero conserva la rama.

## Cuándo preguntar al usuario

- Si vas a añadir una dependencia nueva que no sea trivial (> 50KB o con subdependencias pesadas).
- Si vas a cambiar el schema de Prisma.
- Si vas a introducir un concepto nuevo al modelo de dominio (un modelo, un estado nuevo en una máquina).
- Si algo en estas instrucciones choca con lo que el usuario te pide en el chat.
