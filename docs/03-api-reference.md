# API Reference

Base URL: `http://localhost:3001`. Todos los bodies y respuestas son JSON salvo los streams SSE.

## Health

| Método | Path      | Descripción |
|--------|-----------|-------------|
| GET    | `/health` | Devuelve `{ ok: true, time }`. Sin auth. |

## Projects

| Método | Path | Body | Descripción |
|--------|------|------|-------------|
| GET    | `/projects` | — | Lista proyectos con `_count.tasks`. |
| GET    | `/projects/:id` | — | Proyecto con su `claudeMd` y `tasks`. |
| POST   | `/projects` | `{ name, description?, repoPath }` | Crea proyecto. |
| PATCH  | `/projects/:id` | igual, parcial | Actualiza. |
| DELETE | `/projects/:id` | — | Borra. Cascada a tasks. |

## Agents

| Método | Path | Body | Descripción |
|--------|------|------|-------------|
| GET    | `/agents` | — | Lista con skills y `_count.runs`. |
| GET    | `/agents/:id` | — | Detalle con skills expandidas. |
| POST   | `/agents` | `{ name, role, model, systemPrompt, maxBudgetUsd?, skillIds? }` | Crea. |
| PATCH  | `/agents/:id` | parcial | Si pasas `skillIds`, reemplaza el set completo. |
| DELETE | `/agents/:id` | — | Borra. |

## Skills

| Método | Path | Descripción |
|--------|------|-------------|
| GET    | `/skills` | Catálogo completo. `tags` vienen parseados como array. |
| GET    | `/skills/:id/content` | Devuelve `{ content, filePath }` leyendo el SKILL.md del disco. |
| POST   | `/skills/rescan` | Fuerza un rescan de las rutas configuradas. Devuelve `{ ok, indexed }`. |

Los skills se descubren automáticamente al arrancar y con watcher. Este endpoint es solo para forzar manualmente.

## Tasks (Kanban)

| Método | Path | Body | Descripción |
|--------|------|------|-------------|
| GET    | `/projects/:projectId/tasks` | — | Tasks del proyecto ordenadas por status + position. Incluye el último run. |
| POST   | `/tasks` | `{ projectId, title, description, assignedAgentId?, requiredSkillIds?, dependsOn?, priority? }` | Crea; se añade al final de la columna `todo`. |
| PATCH  | `/tasks/:id` | parcial | Actualiza. |
| POST   | `/tasks/:id/move` | `{ status, position }` | Mueve entre columnas (drag & drop). |
| DELETE | `/tasks/:id` | — | Borra. |
| POST   | `/tasks/:id/run` | `{ agentId? }` | Lanza la task. Usa `assignedAgentId` si no se pasa `agentId`. Devuelve `{ runId }`. |

## Runs

| Método | Path | Body | Descripción |
|--------|------|------|-------------|
| GET    | `/runs/:runId` | — | Detalle con task y agent. |
| POST   | `/runs/:runId/cancel` | — | Envía SIGTERM al process group del `claude` CLI. |

## ClaudeMd

| Método | Path | Body | Descripción |
|--------|------|------|-------------|
| GET    | `/claude-md` | — | Lista. |
| GET    | `/claude-md/:id` | — | Detalle. |
| POST   | `/claude-md` | `{ scope, content, filePath? }` | Crea. |
| PATCH  | `/claude-md/:id` | parcial | Actualiza. Si tiene `filePath`, también escribe a disco. |
| DELETE | `/claude-md/:id` | — | Borra. |

## Streams SSE

### `GET /runs/:runId/stream`

Stream de eventos de una run. Eventos posibles (formato `data: <json>\n\n`):

```ts
{ type: "status", status: "running" | "succeeded" | "failed" | "cancelled" }
{ type: "stream", data: <evento stream-json de claude CLI> }
{ type: "tokens", input, output, cacheRead, costUsd }
{ type: "log", line: string }
```

### `GET /board/stream`

Stream global de cambios en el kanban:

```ts
{ type: "task_created", taskId }
{ type: "task_updated", taskId }
{ type: "task_deleted", taskId }
```

Incluye pings `: ping\n\n` cada 30s para mantener la conexión.

## Ejemplos con `curl`

```bash
# Crear proyecto
curl -X POST localhost:3001/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mi proyecto","repoPath":"/home/yo/code/mi-repo"}'

# Crear agente developer
curl -X POST localhost:3001/agents \
  -H 'Content-Type: application/json' \
  -d '{"name":"Dev","role":"developer","model":"claude-sonnet-4-6","systemPrompt":"Eres un dev senior..."}'

# Crear task
curl -X POST localhost:3001/tasks \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"<id>","title":"Añadir login","description":"...","assignedAgentId":"<agentId>"}'

# Lanzarla
curl -X POST localhost:3001/tasks/<taskId>/run

# Seguir el stream
curl -N localhost:3001/runs/<runId>/stream
```
