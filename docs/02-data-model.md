# Modelo de datos

Ver `apps/api/prisma/schema.prisma`.

## Entidades

- **Project**: `repoPath` + `workspaceStrategy` (worktree/copy detectado automáticamente).
- **Agent**: plantilla de ejecución con `systemPrompt`, `model`, `maxBudgetUsd`, skills asignadas.
- **Skill**: solo metadata (ruta, hash, frontmatter). El contenido vive en disco.
- **AgentSkill**: n:n entre Agent y Skill.
- **Task**: kanban card con estados `todo | in_progress | review | done | blocked`.
- **TaskRun**: ejecución concreta con `branchName` (solo si worktree), tokens, coste, log.
  Los tokens se desglosan en cuatro contadores: `inputTokens`, `outputTokens`,
  `cacheReadTokens` y `cacheWriteTokens`. El último corresponde a
  `cache_creation_input_tokens` (facturado a 1.25x el input) y suele ser el
  componente dominante del coste — ver `docs/04-runner.md`.
- **ClaudeMd**: markdown con scope global/project/agent. La FK del scope `project`
  vive en `Project.claudeMdId`, así que el vínculo se crea desde
  `PATCH /projects/:id`, no desde las rutas de `claude-md`.

## SQLite notas

- Arrays serializados como JSON string (`tags`, `requiredSkillIds`, `dependsOn`).
- `Float` en vez de `Decimal` (SQLite no lo tiene).
- Migración a Postgres = cambiar `provider` + convertir campos JSON string a arrays nativos.
