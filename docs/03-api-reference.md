# API Reference

Base URL: `http://localhost:3001`.

## Health
- `GET /health` → `{ ok, time }`

## Projects
- `GET /projects` — lista
- `GET /projects/:id`
- `POST /projects` — `{ name, description?, repoPath, workspaceStrategy?, claudeMdId? }`. La estrategia se detecta si no se pasa.
- `PATCH /projects/:id` — mismos campos, todos opcionales. `claudeMdId` es la única
  forma de vincular un `ClaudeMd` de scope `project`.
- `DELETE /projects/:id`

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

## ClaudeMd
- `GET/POST/PATCH/DELETE /claude-md` y `/claude-md/:id`
