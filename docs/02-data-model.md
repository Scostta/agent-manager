# Modelo de datos

Ver `apps/api/prisma/schema.prisma`.

## Entidades

- **Project**: `repoPath` + `workspaceStrategy` (worktree/copy detectado automáticamente).
- **Agent**: plantilla de ejecución con `systemPrompt`, `model`, `maxBudgetUsd`, skills asignadas.
  `allowedTools` y `disallowedTools` (JSON string, null = sin restricción) acotan
  qué herramientas del CLI puede usar. Hacen falta las dos: la lista de
  herramientas crece con cada versión del CLI, así que "todo menos Bash" con
  solo allowlist obligaría a enumerar el resto y envejecería sola.
- **Skill**: solo metadata (ruta, hash, frontmatter). El contenido vive en disco.
- **AgentSkill**: n:n entre Agent y Skill.
- **Task**: kanban card con estados `todo | in_progress | review | done | blocked`.
- **TaskRun**: ejecución concreta con `branchName` (solo si worktree), tokens, coste, log.
  Los tokens se desglosan en cuatro contadores: `inputTokens`, `outputTokens`,
  `cacheReadTokens` y `cacheWriteTokens`. El último corresponde a
  `cache_creation_input_tokens` (facturado a 1.25x el input) y suele ser el
  componente dominante del coste — ver `docs/04-runner.md`.
  Guarda además el `sessionId` que anuncia el CLI y, si es una continuación,
  `resumedFromId` (la run cuya sesión retoma) y `followUpPrompt` (con qué se
  retomó). Una continuación **comparte el `workspacePath` y el `branchName` del
  padre**: el CLI indexa las sesiones por directorio, así que `--resume` solo las
  encuentra volviendo al mismo sitio. Por eso el dueño del workspace es la run
  que lo creó y es la única que lo limpia.
- **ClaudeMd**: markdown con scope global/project/agent. La FK del scope `project`
  vive en `Project.claudeMdId`, así que el vínculo se crea desde
  `PATCH /projects/:id`, no desde las rutas de `claude-md`.

## SQLite notas

- Arrays serializados como JSON string (`tags`, `dependsOn`, `allowedTools`).
- `Float` en vez de `Decimal` (SQLite no lo tiene).
- Migración a Postgres = cambiar `provider` + convertir campos JSON string a arrays nativos.
