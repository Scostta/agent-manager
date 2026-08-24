# Claude Cockpit

Dashboard personal para gestionar tus agentes Claude, sus skills, CLAUDE.md y un kanban de tareas que esos agentes ejecutan.

## Arquitectura

```
┌─────────────────┐        HTTP / SSE         ┌──────────────────────┐
│   Next.js UI    │ ◄──────────────────────►  │  Fastify API         │
│   (puerto 3000) │                           │  (puerto 3001)       │
└─────────────────┘                           │                      │
                                              │  - Prisma / SQLite   │
                                              │  - Skills scanner    │
                                              │  - Runner (p-queue)  │
                                              │                      │
                                              │    spawns            │
                                              │    ▼                 │
                                              │  ┌──────────────┐   │
                                              │  │  claude CLI  │   │
                                              │  │  (stream-json)│  │
                                              │  └──────────────┘   │
                                              └──────────────────────┘
```

Todo corre en tu PC. Sin Docker, sin Redis, sin Postgres.

## Requisitos

- Node.js 20+
- pnpm 9+
- `claude` CLI instalado y accesible en PATH (`npm i -g @anthropic-ai/claude-code`)
- Una API key de Anthropic

## Arranque

```bash
pnpm install

cd apps/api
cp .env.example .env
# Edita .env y pon tu ANTHROPIC_API_KEY

pnpm db:migrate       # crea la base de datos SQLite
pnpm db:seed          # datos de ejemplo (un proyecto, dos agentes)

cd ../..
pnpm dev              # arranca API (3001) y Web (3000) en paralelo
```

Abre http://localhost:3000

## Estructura

```
apps/
  api/               # Fastify + Prisma + Runner
    prisma/
      schema.prisma  # modelo de datos
      seed.ts        # datos iniciales
    src/
      config.ts
      db.ts
      bus.ts         # event bus interno (runner ↔ SSE)
      runner/
        executor.ts  # spawnea claude CLI, parsea stream-json
        queue.ts     # cola p-queue
        pricing.ts   # cálculo de coste por tokens
      skills/
        scanner.ts   # indexa SKILL.md del filesystem
      routes/
        projects.ts
        agents.ts
        skills.ts
        tasks.ts     # kanban + lanzar runs
        claudeMd.ts
        sse.ts       # streams en vivo
      index.ts

  web/               # Next.js 15 + Tailwind
    src/
      app/           # pages: /, /projects/[id], /agents, /skills, /claude-md
      components/    # KanbanBoard, TaskCard, RunConsole, SkillPicker
      lib/api.ts
```

## Flujo completo al arrastrar una task

1. Arrastras la card de "Todo" a "In Progress" y seleccionas agente.
2. Frontend llama `POST /tasks/:id/run` con el `agentId`.
3. API crea un `TaskRun` en estado `queued` y lo mete en la cola.
4. El worker saca la run, prepara el workspace (copia el repo, enlaza skills, escribe CLAUDE.md), y hace `spawn('claude', ['-p', prompt, '--output-format', 'stream-json', ...])`.
5. Parsea cada evento JSON de stdout y emite por el event bus.
6. Los endpoints SSE (`/runs/:id/stream`) reenvían esos eventos al frontend.
7. El frontend abre una consola en vivo con el stream del agente.
8. Al terminar, la task pasa a "Review" automáticamente y tú la validas manualmente → "Done".

## Qué queda por hacer

El esqueleto está montado con los componentes base. Para un MVP funcional faltan las páginas/componentes del frontend:

- `app/page.tsx` — listado de proyectos.
- `app/projects/[id]/page.tsx` — kanban del proyecto con @dnd-kit.
- `app/agents/page.tsx` — CRUD de agentes y picker de skills.
- `app/skills/page.tsx` — catálogo de SKILL.md indexados.
- `app/claude-md/page.tsx` — editor Monaco para CLAUDE.md.
- Componente `RunConsole` que se suscribe a `/runs/:runId/stream`.

La API ya expone todo lo que necesitas para construirlos.

## Decisiones de diseño

- **SQLite, no Postgres:** single-user, single-machine. Si un día lo necesitas, cambiar el provider en Prisma es una línea.
- **p-queue, no BullMQ/Redis:** para un PC personal, 2-3 runs concurrentes con cola en memoria es suficiente.
- **Skills por referencia, no copia:** guardamos ruta y hash en BD. Editar un SKILL.md en disco se refleja sin migración. El runner crea symlinks en el workspace.
- **Workspace aislado por run:** `workspaces/{taskId}/{runId}/` con copia del repo. Evita que runs paralelas se pisen.
- **stream-json, no terminal scraping:** `claude --output-format stream-json` da eventos tipados. Usar esto y no parsear terminal.
- **Detached + kill(-pid):** spawneamos con `detached: true` para poder matar el process group entero con `kill(-pid)` y cazar sub-procesos que claude pueda crear.
```
# agent-manager
