# Roadmap

## Estado actual

Backend completo con estrategia híbrida worktree/copy y compatibilidad Windows.
Frontend con todas las pantallas del MVP y el dashboard de consumo.

El ciclo completo está validado en real: spawn del CLI → stream-json → SSE → UI,
con tokens y coste registrados, y el trabajo saliendo del worktree al repo.

## Fase 1 — Frontend MVP ✅

1. ✅ **Layout base con sidebar** + header con `/queue/stats`.
2. ✅ **Lista de Projects** + modal para crear (detecta estrategia automáticamente).
3. ✅ **Kanban del proyecto** con `@dnd-kit/core`, drawer de detalle, botón Run.
4. ✅ **Run Console** con SSE en vivo, tokens/coste actualizándose, botón Cancel.
5. ✅ **Agentes**: CRUD + skill picker.
6. ✅ **Skills**: catálogo con búsqueda y preview del SKILL.md.
7. ✅ **CLAUDE.md**: editor Monaco.

## Fase 2 — Review PR-style ✅

Aprovechar los worktrees:
- ✅ Pestaña "Diff" en el visor de run, contra `GET /runs/:id/diff`. Diffea el
  árbol de trabajo, no la rama: Claude Code no hace commit salvo que se lo pidas.
- ✅ Botón "Mergear en main": commitea lo que el agente dejó suelto y hace
  `git merge --no-ff`. Exige repo limpio y en la base; si hay conflicto aborta.
- ✅ Botón "Descartar" (borra worktree y rama, con confirmación).
- ✅ Pasar la task a `done` solo limpia worktrees ya integrados.

El estado de integración (`GET /runs/:id/branch`) se deriva de git en vivo, no
de la BD: por eso al mergear se conserva la rama, que es lo que recuerda que esa
run ya está integrada. La rama muere cuando la task pasa a `done`.

## Fase 3 — Dashboard de tokens/costes ✅

- `GET /stats/summary?days=N` agrega por día, agente, proyecto y modelo.
- `/dashboard`: tiles de totales, tokens por día apilados por tipo, coste por
  día y cortes por agente/proyecto/modelo. Recharts.
- `GET /projects/:id/tasks` devuelve `totals` por task (suma de todas sus runs),
  que es lo que pintan la tarjeta del kanban y el drawer.

## Fase 4 — Refinamientos ✅

- ✅ **Dependencias entre tasks enforzadas.** Cumplida = la tarea está en `done`
  (en `review` el trabajo aún no está revisado ni integrado). El cockpit pone y
  quita `blocked` solo; al cumplirse la última dependencia la tarea pasa a
  `todo` y espera, no se lanza sola. Una dependencia borrada deja de contar; los
  ciclos se rechazan al guardar.
- ✅ **GC de workspaces por edad**, con la regla de no borrar nunca trabajo que
  no esté guardado en otro sitio.
- ✅ **Control de la cola**: concurrencia en caliente, pausa y kill switch.
- ✅ **Historial de runs** con filtros y reintentos visibles.
- ✅ **Suscripción por defecto** + aviso de cuota agotada con opción de esperar
  al reset o tirar de la API key.
- ✅ **Alta de proyecto guiada** (`/projects/new`), en cuatro pasos: descripción
  → carpeta (explorador servido por la API, porque el navegador no puede dar
  rutas absolutas) → `CLAUDE.md` opcional → backlog propuesto por Claude.
  - El `git init` lleva commit inicial obligatorio: sin `HEAD` no hay
    `git worktree add`, así que el proyecto no podría lanzar ni una run.
  - La planificación spawnea el CLI con `--allowedTools Read,Glob,Grep` y
    devuelve JSON. No es una `TaskRun`: no hay Task de la que colgar, no pasa
    por la cola y su consumo no entra en el dashboard (queda el NDJSON en
    `LOGS_ROOT/plan-<projectId>.ndjson`).
  - Ni la home ni la raíz del disco valen como carpeta de proyecto: `git init`
    ahí versionaría el perfil entero y cada run lo copiaría al workspace.
- ❌ Templates de proyecto — descartadas: las sustituye el alta guiada.

## Tests

146 tests con `node:test`, sin dependencias nuevas. Además de la lógica pura ya
están cubiertos los sitios donde salieron los bugs caros:

- **Scanner de skills**: indexado, frontmatter roto, borrados y el watcher de
  chokidar reaccionando a un `SKILL.md` nuevo.
- **Executor**: el CLI se sustituye por un proceso simulado que escupe
  stream-json (`runtime.spawn`). Cubre el recuento de tokens con deduplicación
  por `message.id`, el coste autoritativo del evento `result`, los estados
  finales de run y task, la cuota agotada y el binario ausente.
- **Rutas**: `app.inject()` sobre `buildApp()`, con la BD real en una SQLite
  temporal que se monta aplicando los `migration.sql` con `node:sqlite`
  (`src/test/harness.ts`).
- **GC de workspaces**: la tabla de decisión aparte, y su ejecución contra disco
  y git de verdad — que no borre cambios sin commitear, que conserve la rama
  cuando es lo único que guarda el trabajo, y que pode el registro del worktree.
- **Cola**: encolado, pausa, concurrencia en caliente y kill switch (que las
  runs descartadas no se queden en `queued` y sus tasks vuelvan a `todo`).
- **Planificador**: de extremo a extremo con el CLI simulado — backlog, log
  NDJSON, binario ausente, respuesta sin JSON, cancelación y el candado que
  impide dos planificaciones del mismo proyecto a la vez.

Estos tests destaparon un bug de verdad: quien tiene la identidad de git
configurada por repo y no en `--global` no tiene ninguna en los proyectos que
crea el cockpit, así que `commitAll` y `mergeBranch` fallaban con "Author
identity unknown" — el botón "Mergear en main" no funcionaba en ningún proyecto
creado desde el alta guiada. Ambos reintentan ahora con una identidad de
respaldo, igual que ya hacía el commit inicial.

- **Scheduler de cuota**: que no programe a ciegas sin hora de reset, que
  reintente al llegar la hora, que no duplique la run si ya la relanzaste a
  mano, y que un reinicio de la API no pierda la espera.
- **Reaper**: cierra las runs que quedaron vivas y devuelve sus tasks a `todo`
  sin tocar el historial ni la columna donde tú las hayas dejado.

Los tests se validan reintroduciendo el bug que cubren: si el test sigue en
verde con el bug dentro, no cuenta. Así apareció el hueco del reaper (faltaba el
caso mixto: historial y huérfana conviviendo en la misma BD).

## Fase 5 — Candidatos (nada empezado)

Ordenados por lo que aportan. Salieron de revisar el código, no de una lluvia de
ideas: cada uno apunta al sitio concreto que lo justifica.

### 1. Continuar una sesión en vez de relanzarla

Hoy cada run es un `-p` de un solo tiro, y los tres modos de retry (`wait`,
`api_key`, `now`) relanzan desde cero: el agente vuelve a leerse el repo y se
paga otra vez. Pero al revisar un diff lo natural es "casi, pero cambia X", y
para eso hay que crear otra task o reintentar entera.

El CLI acepta `--resume <sessionId>` y el `session_id` ya llega en el evento
`init` del stream-json — simplemente no se guarda. Serían: una columna en
`TaskRun`, guardarlo al parsear, y un botón "Seguir con instrucciones" en el
visor de run. **Toca el schema de Prisma: hablarlo antes.**

Es el cambio que más tiempo y dinero ahorra por línea escrita.

### 2. Qué herramientas puede usar cada agente

Todas las runs salen con `--permission-mode acceptEdits` y sin `--allowedTools`
(`executor.ts`), así que cualquier agente puede ejecutar bash arbitrario en su
workspace. Un agente revisor o documentador debería poder ser solo lectura; el
precedente ya existe: el planificador corre con `--allowedTools Read,Glob,Grep`.
Un campo en `Agent` y un arg más en el spawn.

### 3. Decidir qué es `requiredSkillIds`

Se guarda, se valida y se pinta en la tarjeta y el drawer, y **no lo consume
nadie**: el executor inyecta las skills del *agente* (`agent.skills`), no las
que la task declara requerir. Marcar una skill en una task hoy no cambia nada de
lo que ve el agente.

O se conecta (que las requeridas se inyecten, o que avisen de que el agente
asignado no las tiene) o se quita. Un campo decorativo en el modelo de dominio
envenena las decisiones que vengan después. Esto es decidir, no construir.

### 4. Avisar cuando una run termina

Una run tarda minutos y el cockpit no avisa: sin la pestaña delante, no te
enteras. Una notificación del navegador al pasar a `review` o `failed` basta.
Orquestar agentes y tener que vigilarlos se contradice.

### 5. Registrar el prompt que se envió

`buildPrompt()` compone systemPrompt + task + skills, y el NDJSON solo guarda lo
que devuelve el CLI. Cuando una run sale rara no hay forma de ver qué se le
pidió. Escribirlo como primera línea del log y listo.

### Menores

- **Editar SKILL.md desde la UI.** CLAUDE.md sí se edita y el catálogo de skills
  es solo lectura; el hot-reload del scanner ya lo soportaría.
- **Export/backup.** Todo vive en un SQLite local: si se corrompe, se va el
  historial de costes entero.
- **Tests en `apps/web`.** Cero por ahora. Hay lógica pura sin cubrir, como la
  reindexación de dependencias al borrar una task en el wizard.

## Cosas que NO se harán (a menos que cambie el objetivo)

- Multi-tenancy.
- Roles/permisos.
- Inter-agent messaging.
- Agentes 24/7.
