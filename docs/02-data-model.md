# Modelo de datos

Todas las entidades viven en `apps/api/prisma/schema.prisma`. Este documento explica las decisiones y las relaciones.

## Entidades

### Project

Un proyecto equivale a un repo local en el que trabajarán los agentes. Tiene un kanban de tasks propio y opcionalmente un `CLAUDE.md` asociado.

Campos relevantes:
- `repoPath` — ruta absoluta en el filesystem. El runner la copia al workspace de cada run.
- `claudeMdId` — referencia opcional a `ClaudeMd`. Si existe, su contenido se escribe como `CLAUDE.md` en la raíz del workspace antes de ejecutar `claude`.

### Agent

Plantilla de ejecución. No es un proceso corriendo, es una **configuración**. El proceso solo existe durante una `TaskRun`.

Campos relevantes:
- `role` — etiqueta semántica (`developer`, `reviewer`, `researcher`, custom). No tiene comportamiento asociado, es para organización.
- `model` — modelo Claude a usar. Afecta al coste (ver `runner/pricing.ts`).
- `systemPrompt` — se prepende al prompt de cada task que ejecute este agente.
- `maxBudgetUsd` — si el coste acumulado de una run supera este valor, el runner mata el proceso. Null = sin límite.
- `status` — informativo. `idle | running | paused | disabled`.

### Skill

Un `SKILL.md` indexado. **No guarda contenido, solo metadatos:**

- `filePath` — ruta absoluta al `SKILL.md`.
- `contentHash` — SHA256. Permite detectar cambios.
- `scope` — `public | user | project`. Inferido del path.
- `tags` — JSON serializado (SQLite no tiene arrays nativos).
- `name` — único; usado como identificador del skill.

El campo `description` se extrae del frontmatter YAML del propio `SKILL.md`.

**Por qué no guardar el contenido:** el usuario edita SKILL.md con su editor habitual. Si los duplicáramos, habría que sincronizar. Con referencia + hash, la fuente de verdad es el filesystem y el scanner resincroniza con chokidar.

### AgentSkill

Tabla n:n entre `Agent` y `Skill`. Un agente solo tiene acceso a las skills aquí listadas; el runner hace symlink de exactamente estas dentro de `.claude/skills/` del workspace.

### Task

Una tarjeta del kanban.

Campos relevantes:
- `status` — `todo | in_progress | review | done | blocked`. **El runner mueve a `review` automáticamente al completar con éxito una run**; el humano decide si pasa a `done` o vuelve a `todo`.
- `position` — orden dentro de su columna. Se actualiza con drag & drop.
- `requiredSkillIds` — JSON array. Informativo por ahora; el runner usa las skills del agente asignado, no las de la task. Futuro: validar que el agente asignado tenga todas las requeridas.
- `dependsOn` — JSON array de IDs de otras tasks. **No se enforza aún.** Futuro: una task bloqueada por una dependencia sin `done` no arranca.
- `assignedAgentId` — agente por defecto; se puede sobrescribir al lanzar la run.

### TaskRun

Una ejecución concreta de una Task por un Agent. Una Task puede tener muchas runs (reintentos, iteraciones).

Separada de Task porque:
- Los tokens y coste son por ejecución, no por tarea.
- Permite historial de intentos sin perder información.
- La Task puede reutilizarse en otro proyecto y arrastrar confusión de costes.

Campos relevantes:
- `workspacePath` — ruta al workspace aislado de esta run.
- `logPath` — NDJSON con el stream-json completo del `claude` CLI.
- `pid` — PID del proceso, para poder matarlo. Null cuando termina.
- `inputTokens`, `outputTokens`, `cacheReadTokens`, `costUsd` — se actualizan en vivo.

### ClaudeMd

Ficheros markdown reutilizables, con scope `global | project | agent`. Solo el scope `project` se usa actualmente (se inyecta en el workspace). Los otros dos están preparados para:
- `global` — se prependaría al prompt de cualquier agente del usuario.
- `agent` — específico de un agente, se concatenaría a su `systemPrompt`.

Si `filePath` está seteado, al guardar en BD también se escribe a disco. Útil si el usuario también usa Claude Code manualmente y quiere que el CLAUDE.md viva en su filesystem.

## Relaciones

```
Project ───< Task ───< TaskRun >─── Agent
                           └─ uses ──> Skill (via AgentSkill)
Project ──> ClaudeMd (1:1 opcional)
```

## Consideraciones de SQLite

- Los arrays de strings se guardan como JSON serializado (`tags`, `requiredSkillIds`, `dependsOn`). Hay que parsearlos al leer — las rutas lo hacen.
- `Decimal` no existe en SQLite; usamos `Float`. Para cálculos monetarios es aceptable porque redondeamos a 4 decimales.
- Migraciones con `prisma migrate dev`.

## Migración futura a Postgres

Cambiar `provider = "postgresql"` en `schema.prisma` y la `DATABASE_URL`. Después:
- Convertir las columnas de JSON string a `String[]` nativo.
- Cambiar `Float` a `Decimal` en campos monetarios.
- Regenerar cliente y migrar.

El resto del código no cambia.
