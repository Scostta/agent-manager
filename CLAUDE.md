# CLAUDE.md

Instrucciones para Claude Code cuando trabajes en este repositorio.

## Qué es esto

**Claude Cockpit** es un dashboard personal para orquestar agentes Claude Code CLI. Un solo usuario, máquina local. El usuario define proyectos, agentes (con su prompt, modelo, skills permitidas), y un kanban de tareas. Arrastrar una task a `in_progress` es el gesto para lanzarla: pide confirmación —spawnear un agente cuesta dinero y un arrastre torpe no puede costarlo— y entonces spawnea un proceso `claude` CLI que la ejecuta en un workspace aislado.

**Referencias mentales:** Paperclip (paperclipai/paperclip) y AgentManager (simonstaton/AgentManager). No copiamos ninguno, tomamos ideas.

## Stack y decisiones no-negociables

- **Monorepo con pnpm workspaces.** No añadas npm, yarn, lerna, nx, turbo. pnpm basta.
- **Backend:** Fastify 5 + TypeScript + Prisma + SQLite. ESM puro (`"type": "module"`).
- **Frontend:** Next.js 15 App Router + React 19 + Tailwind. Los primitivos son propios (`components/ui/primitives.client.tsx`: Button, Input, Badge, Chip, Modal, Toast…). shadcn/ui se contempló y nunca hizo falta: antes de añadirlo, mira si el primitivo ya está.
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
pnpm test             # tests con node:test (apps/api y apps/web)
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
        git.ts                   # helpers de git (worktree, diff, merge, etc)
        process.ts               # kill multiplataforma (taskkill / signals)
        paths.ts                 # normalización POSIX de paths
        browse.ts                # listar carpetas del disco con guardas
      runner/
        workspace.ts             # setup híbrido worktree/copy
        executor.ts              # spawn de claude CLI, parser stream-json
        queue.ts                 # p-queue global + encolar/retomar runs
        pricing.ts               # $ por millón de tokens por modelo
        reaper.ts                # limpia runs huérfanas al arrancar
        integrate.ts             # estado de la rama, merge y descarte
        gc.ts                    # barrido de workspaces viejos
        rateLimit.ts             # detecta "sin cuota" y su hora de reset
        scheduler.ts             # reintento programado al reponerse la cuota
        resume.ts                # si una sesión se puede retomar, y con qué
        tools.ts                 # --allowedTools/--disallowedTools del agente
      skills/
        scanner.ts               # indexa SKILL.md con chokidar (hot-reload)
      tasks/
        dependencies.ts          # lógica pura: bloqueos y ciclos
        sync.ts                  # aplica esos bloqueos contra la BD
      projects/
        scaffold.ts              # git init + commit inicial del alta guiada
        planner.ts               # backlog propuesto por el CLI (no es TaskRun)
      stats/
        aggregate.ts             # agregados del dashboard
      routes/
        projects.ts
        agents.ts
        skills.ts
        tasks.ts                 # endpoints del kanban + lanzar runs
        runs.ts                  # historial, log, diff, retry, merge, resume
        claudeMd.ts
        stats.ts                 # /stats/summary y /stats/plan
        queue.ts                 # /queue/stats, pausa, concurrencia, kill switch
        workspaces.ts            # /workspaces y /workspaces/gc
        fs.ts                    # explorador de carpetas para el alta guiada
        sse.ts                   # /runs/:id/stream, /board/stream y el del plan
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
        shell/                   # app-shell, sidebar, header, paleta, avisos
        ui/                      # primitivos compartidos (Icon, Modal, Toast, …)
      lib/
        api.ts                   # cliente HTTP + helper SSE
        hooks.ts                 # hooks SWR + streams SSE
        types.ts                 # espejo de los modelos de la API
        format.ts                # formateo + helpers de listas de herramientas
        run-log.ts               # traduce el NDJSON de una run a líneas legibles
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
- **Agent** → plantilla de ejecución: nombre, rol, modelo, `systemPrompt`, budget, un set de `Skill` habilitadas y qué herramientas del CLI puede usar (`allowedTools` / `disallowedTools`; vacías = sin restricción).
- **Skill** → un `SKILL.md` indexado del filesystem. **Nunca guardamos el contenido en BD, solo ruta + hash SHA256.** Si el usuario edita un SKILL.md en disco, el scanner (chokidar) lo detecta y actualiza.
- **Task** → unidad del kanban. Estados: `todo | in_progress | review | done | blocked`. Puede tener `dependsOn` (otras tasks). Las skills no se declaran aquí: las trae el `Agent` que la ejecuta.
- **TaskRun** → una ejecución concreta de una Task por un Agent. Separada de Task adrede: permite reintentos y auditoría de tokens. Estados: `queued | running | succeeded | failed | cancelled`. Guarda `branchName` si la estrategia es worktree, y el `sessionId` del CLI para poder retomarla. Una run con `resumedFromId` continúa la sesión de otra: comparte su workspace y su rama, y por eso no los limpia.
- **ClaudeMd** → contenido markdown con scope `global | project`. El global (solo puede haber uno) se inyecta en el workspace de **todas** las runs; el de un proyecto, solo en las suyas, y va después para poder matizarlo. Hubo un scope `agent` que no consumía nadie: el `systemPrompt` del agente ya es ese sitio.

## Flujo crítico: ejecución de una task

1. `POST /tasks/:id/run` → crea `TaskRun` con status `queued`, lo mete en `p-queue`.
   No se lanza nada si a la task le faltan dependencias, esté en la columna que esté.
2. Worker toma la run → `executor.executeTaskRun(runId)`:
   a. `setupWorkspace()` → si worktree: `git worktree add`. Si copy: `copyDirShallow`.
      Salvo que sea una continuación: esa hereda el workspace del padre.
   b. `injectWorkspaceResources()` → symlinks de skills (junction en Windows, dir en Unix) + los CLAUDE.md del cockpit: primero el global, luego el del proyecto, todos en un único bloque marcado dentro del que ya trajera el repo.
   c. Construye el prompt (systemPrompt + task + lista de skills). Al retomar,
      solo las instrucciones nuevas: el resto ya está en la sesión.
   d. Escribe la primera línea del log: con qué se lanza (modelo, flags, prompt).
   e. `spawn` del binario `claude` con `-p`, `--output-format stream-json`,
      los flags de herramientas del agente, `--resume` si continúa una sesión,
      y `spawnOptions()` multiplataforma.
   f. Parsea cada línea de stdout como JSON, acumula tokens desde `usage`,
      guarda el `session_id`, emite eventos por `bus`.
3. Al terminar: status final, task → `review` si éxito. Cleanup automático si
   `failed`/`cancelled`, salvo las dos excepciones de abajo. Se emite
   `run_finished` por el canal `board` para el aviso del navegador.
4. Al pasar la task a `done`, cleanup de worktrees de runs `succeeded` **que ya
   estén integradas**; una rama sin mergear es el único sitio donde vive su trabajo.
5. SSE en `/runs/:id/stream` reenvía todos los eventos al frontend en vivo.

**Invariantes que no debes romper:**
- Windows usa `spawn` sin `detached` + `killProcessTree` con taskkill.
- Unix usa `spawn` con `detached: true` + kill del process group.
- Todo esto ya está en `src/lib/process.ts`, no lo reimplementes.
- Guarda siempre el log NDJSON en `LOGS_ROOT/{runId}.ndjson`. Una línea = un
  evento; la primera la escribe el cockpit con lo que se le pidió al CLI.
- Una run cancelada o fallida **no** mueve la task a `review`. Solo las `succeeded`.
- **Quien crea el workspace es quien lo borra.** Una continuación vive en el del
  padre: limpiarlo al fallar se llevaría por delante el trabajo del padre.
- **Una run cortada por cuota conserva su workspace** aunque esté `failed`: es a
  donde vuelve el reintento para retomar la sesión, y donde está lo ya hecho.
- **Un `--allowedTools` vacío no es "todas", es "ninguna".** Lista vacía se guarda
  como `null` y no llega nunca a la línea de comandos.

## Tests

- **Runner:** `node:test` con `tsx`, en los dos paquetes. Sin dependencias de
  test — no metas vitest ni jest sin permiso explícito.
- **En `apps/web` solo se prueba lógica pura**, sin DOM ni render: por eso lo
  testeable se extrae del componente a `src/lib/` en vez de montar jsdom. Si
  algún día hace falta probar un componente de verdad, eso sí hay que hablarlo.
- **Dónde:** junto al código que prueban, como `foo.test.ts`. `tsconfig.json`
  los typechequea; `tsconfig.build.json` los saca del build junto con
  `src/test/`.
- **Qué se prueba:** lo que falla en silencio y sale caro. En la web, el
  traductor del NDJSON del visor (`lib/run-log.ts`) y los helpers de listas de
  herramientas. En la API, lógica pura
  (`rateLimit`, `pricing`, `tools`, `resume`, tabla de decisión del GC, copia de
  workspace, helpers de git contra repos temporales, dependencias, parseo del
  planificador) y, con BD de verdad, el scanner de skills, el executor, la cola,
  el GC contra disco, el reaper, el scheduler de cuota y las rutas.
  Son 204 tests; el desglose y por qué existe cada uno está en `docs/06-roadmap.md`.
- **Tests con BD:** `src/test/harness.ts` monta una SQLite temporal aplicando
  los `migration.sql` con `node:sqlite`. **Impórtalo siempre el primero**: fija
  el entorno antes de que `config.ts` y `db.ts` se evalúen, y si `db.ts` carga
  antes, el cliente se conecta al `dev.db` real. Nada de mockear Prisma.
- **Tests del executor:** no se spawnea el CLI. `runtime.spawn` se sustituye por
  un proceso simulado que escupe stream-json; lo que se prueba es el parseo, el
  recuento de tokens, con qué argumentos se habría llamado al CLI y en qué estado
  acaban run y task.
- **Tests que encolan:** `stopEverything()` deja la cola en pausa, así que un test
  puede comprobar *qué* se encola sin que se ejecute ni se spawnee nada.
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

## Dónde está el proyecto

El MVP está entero y el ciclo validado en real: kanban, agentes, skills, editor
de CLAUDE.md, dashboard de tokens y costes con Recharts, review PR-style sobre
los worktrees, dependencias entre tasks, control de la cola, GC de workspaces y
alta guiada de proyectos.

Lo último cerrado (Fase 5): retomar sesiones con `--resume` en vez de relanzar
de cero, herramientas permitidas por agente, aviso del navegador al terminar una
run y registro en el log de con qué se lanzó.

`docs/06-roadmap.md` lleva la cuenta y explica el porqué de cada decisión,
incluidas las que se descartaron. **Míralo antes de proponer trabajo nuevo**:
alguna de las ideas obvias ya está descartada ahí con su motivo.

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
- **Borrar un proyecto** → tasks y runs caen en cascada, pero el `ClaudeMd` no (la FK vive en Project), así que la ruta lo borra a mano. El fichero en disco se queda: es del repo. Sus workspaces también, y de esos se encarga el GC.
- **Una migración que borra datos** → `prisma migrate dev` es interactivo y se niega a generarla desde una sesión de agente. Escribe el `migration.sql` a mano siguiendo el patrón `RedefineTables` de las migraciones ya existentes y aplícalo con `prisma migrate deploy`, que sí es no interactivo. Comprueba después que la columna se fue y que las filas siguen ahí.
- **`prisma generate` falla con EPERM en Windows** → hay un proceso node vivo (un `pnpm dev`, un test colgado) con el motor de Prisma abierto. Mátalo y repite.
- **Workspace no se limpia al terminar la run** → adrede en runs `succeeded`, para poder inspeccionar el diff. Se limpia al pasar la task a `done` (solo si su trabajo ya está integrado) y, pasados `WORKSPACE_GC_DAYS`, por el GC. El GC nunca borra cambios sin commitear ni copias de runs con la tarea abierta; de un worktree con commits sin integrar borra la carpeta pero conserva la rama.

## Cuándo preguntar al usuario

- Si vas a añadir una dependencia nueva que no sea trivial (> 50KB o con subdependencias pesadas).
- Si vas a cambiar el schema de Prisma.
- Si vas a introducir un concepto nuevo al modelo de dominio (un modelo, un estado nuevo en una máquina).
- Si algo en estas instrucciones choca con lo que el usuario te pide en el chat.
