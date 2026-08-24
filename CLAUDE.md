# CLAUDE.md

Instrucciones para Claude Code cuando trabajes en este repositorio.

## Qué es esto

**Claude Cockpit** es un dashboard personal para orquestar agentes Claude Code CLI. Un solo usuario, máquina local. El usuario define proyectos, agentes (con su prompt, modelo, skills permitidas), y un kanban de tareas. Arrastrar una task al estado `in_progress` spawnea un proceso `claude` CLI que ejecuta esa tarea en un workspace aislado.

## Stack y decisiones no-negociables

- **Monorepo con pnpm workspaces.** No añadas npm, yarn, lerna, nx, turbo. pnpm basta.
- **Backend:** Fastify 5 + TypeScript + Prisma + SQLite. ESM puro (`"type": "module"`).
- **Frontend:** Next.js 15 App Router + React 19 + Tailwind + shadcn/ui cuando necesitemos componentes complejos.
- **Cola de tasks:** `p-queue` en memoria. **No introduzcas Redis ni BullMQ** sin permiso explícito del usuario.
- **Runner:** spawn del binario `claude` CLI con `--output-format stream-json`. **No uses el SDK de Anthropic directamente.**
- **Tiempo real:** Server-Sent Events (SSE). **No introduzcas WebSockets.**
- **Validación:** Zod en todos los endpoints de API.
- **Drag & drop:** `@dnd-kit/core`.
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
```

## Estructura del repo

```
apps/
  api/
    prisma/
      schema.prisma
      seed.ts
    src/
      config.ts
      db.ts
      bus.ts
      lib/
        git.ts               # helpers de git (worktree, diff, etc)
        process.ts           # kill multiplataforma (taskkill / signals)
        paths.ts             # normalización POSIX de paths
      runner/
        workspace.ts         # setup híbrido worktree/copy
        executor.ts          # spawn de claude CLI, parser stream-json
        queue.ts             # p-queue global
        pricing.ts
        reaper.ts            # limpia runs huérfanas al arrancar
      skills/
        scanner.ts           # indexa SKILL.md del filesystem
      routes/
        projects.ts
        agents.ts
        skills.ts
        tasks.ts
        claudeMd.ts
        sse.ts
        queue.ts             # /queue/stats y /runs/:id/diff
      index.ts

  web/                       # Next.js 15 + Tailwind (placeholder por ahora)
```

## Conceptos del dominio

- **Project** → un repo local o carpeta. Tiene su propio kanban.
  - `workspaceStrategy: "worktree"` si es repo Git → cada run usa `git worktree` con rama nueva.
  - `workspaceStrategy: "copy"` si no es repo Git → copia recursiva (excluye `node_modules`, `.git`, `.next`, `dist`, `build`).
  - La estrategia se detecta automáticamente al crear el proyecto.
- **Agent** → plantilla: nombre, rol, modelo, `systemPrompt`, budget, skills habilitadas.
- **Skill** → un `SKILL.md` indexado del filesystem. **Nunca guardamos el contenido en BD, solo ruta + hash SHA256.**
- **Task** → unidad del kanban. Estados: `todo | in_progress | review | done | blocked`.
- **TaskRun** → una ejecución concreta. Separada de Task adrede. Guarda `branchName` si estrategia worktree.
- **ClaudeMd** → contenido markdown con scope `global | project | agent`.

## Flujo crítico: ejecución de una task

1. `POST /tasks/:id/run` → crea `TaskRun` con status `queued`, lo mete en `p-queue`.
2. Worker toma la run → `executor.executeTaskRun(runId)`:
   a. `setupWorkspace()` → si worktree: `git worktree add`. Si copy: `copyDirShallow`.
   b. `injectWorkspaceResources()` → symlinks de skills (junction en Windows, dir en Unix) + CLAUDE.md.
   c. Construye el prompt.
   d. `spawn('claude', ['-p', prompt, '--output-format', 'stream-json', ...])` con `spawnOptions()` multiplataforma.
   e. Parsea cada línea, acumula tokens, emite eventos por `bus`.
3. Al terminar: status final, task → `review` si éxito. Cleanup automático si `failed`/`cancelled`.
4. Al pasar la task a `done`, cleanup de worktrees de runs `succeeded`.

**Invariantes que no debes romper:**
- Windows usa `spawn` sin `detached` + `killProcessTree` con taskkill.
- Unix usa `spawn` con `detached: true` + kill de process group.
- Todo esto ya está en `src/lib/process.ts`, no lo reimplementes.
- Guarda siempre el log NDJSON en `LOGS_ROOT/{runId}.ndjson`.
- Una run cancelada/fallida NO mueve la task a `review`.

## Convenciones de código

- **TypeScript estricto.** Si necesitas `any`, coméntalo.
- **Imports con extensión `.js`** en la API (ESM con tsx).
- **Paths absolutos en config**, nunca relativos.
- **Errores de Prisma**: usa `reply.notFound()` / `reply.badRequest()` de `@fastify/sensible`.
- **No pongas lógica de negocio en las rutas.** Las rutas orquestan; la lógica de runner vive en `src/runner/`.
- **Nombres en inglés** en código; mensajes al usuario y docs en español.
- **Comentarios explican "por qué", no "qué".**

## Cosas que el usuario no quiere

- ❌ Docker obligatorio para dev local.
- ❌ Multi-tenancy, organizaciones, roles, permisos.
- ❌ Autenticación compleja.
- ❌ Reinventar Claude Code. Spawneamos el CLI.
- ❌ Heartbeats, cron de agentes, agentes 24/7.
- ❌ Inter-agent messaging (en el MVP).
- ❌ Abstraer prematuramente.

## Prioridad actual del MVP

1. Kanban + asignar tareas a agentes (backend ✅, frontend pendiente).
2. Skills manager centralizado (backend ✅, frontend pendiente).
3. Editor de CLAUDE.md (backend ✅, frontend pendiente).

## Windows-specific gotchas ya resueltos

- `scopeFromPath` normaliza separadores con `toPosix()`.
- `spawnOptions()` devuelve `detached: false` en Windows.
- `killProcessTree` usa `taskkill /T /F` en Windows.
- Symlinks de skills usan `'junction'` en Windows (no requiere admin).
- Reaper de runs huérfanas al arrancar.

## Cuándo preguntar al usuario

- Si vas a añadir una dependencia nueva no trivial.
- Si vas a cambiar el schema de Prisma.
- Si vas a introducir un concepto nuevo al modelo de dominio.
- Si algo en estas instrucciones choca con lo que el usuario te pide en el chat.
