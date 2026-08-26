# API Reference

Base URL: `http://localhost:3001`.

## Health
- `GET /health` → `{ ok, time }`

## Projects
- `GET /projects` — lista
- `GET /projects/:id`
- `POST /projects` — `{ name, description?, repoPath, workspaceStrategy?, claudeMdId?, initGit?, claudeMdContent? }`.
  Crea la carpeta si no existe, escribe el `CLAUDE.md` y, con `initGit`, hace
  `git init` + commit inicial **antes** de detectar la estrategia (si no, todo
  proyecto nuevo saldría `copy`). Rechaza la home y la raíz del disco.
- `PATCH /projects/:id` — mismos campos, todos opcionales. `claudeMdId` es la única
  forma de vincular un `ClaudeMd` de scope `project`.
- `DELETE /projects/:id`
- `POST /projects/:id/plan` — `{ model? }`. Spawnea el CLI en solo lectura y
  devuelve `{ tasks, model, tokens, costUsd, logPath }`. No guarda nada: las
  `tasks` traen `dependsOn` como índices del propio array.
- `DELETE /projects/:id/plan` — cancela la planificación en marcha.

## Filesystem
- `GET /fs/roots` — inicio y unidades del disco.
- `GET /fs/browse?path=&hidden=` — solo directorios. Devuelve `{ path, name,
  parent, exists, isGitRepo, isEmpty, separator, entries }`.
- `GET /fs/claude-md?path=` — `CLAUDE.md` que ya viva en esa carpeta.

## Agents
- `GET /agents`, `GET /agents/:id`
- `POST /agents` — `{ name, role, model, systemPrompt, maxBudgetUsd?, skillIds? }`
- `PATCH /agents/:id` (si pasas `skillIds`, reemplaza el set)
- `DELETE /agents/:id`

## Skills
- `GET /skills`
- `GET /skills/:id/content` — lee del disco
- `POST /skills/rescan`

## Tasks
- `GET /projects/:projectId/tasks`
- `POST /tasks`
- `POST /projects/:projectId/tasks/bulk` — `{ tasks: [{ title, description?, dependsOn? }] }`.
  Alta del backlog inicial; `dependsOn` son índices del propio array y solo
  cuentan hacia atrás.
- `PATCH /tasks/:id`
- `POST /tasks/:id/move` — `{ status, position }`. Si pasa a `done`, cleanup de worktrees.
- `DELETE /tasks/:id`
- `POST /tasks/:id/run` — devuelve `{ runId }`

## Runs
- `GET /runs/:runId`
- `POST /runs/:runId/cancel`
- `GET /runs/:runId/diff` — solo si worktree, devuelve diff contra main/master.

## Queue
- `GET /queue/stats` — `{ pending, waiting, concurrency }`

## SSE
- `GET /runs/:runId/stream` — eventos de una run.
- `GET /board/stream` — cambios del kanban.
- `GET /projects/:projectId/plan/stream` — actividad del planificador mientras
  propone el backlog inicial.

## ClaudeMd
- `GET/POST/PATCH/DELETE /claude-md` y `/claude-md/:id`
