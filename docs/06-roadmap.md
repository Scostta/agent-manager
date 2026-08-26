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

## Lo que falta por probar

Los tests cubren la lógica pura (`node:test`, sin dependencias nuevas). Sigue
sin cubrirse lo que necesita BD o spawnear procesos — scanner de skills,
executor y rutas —, que es justo donde salieron el bug del glob de chokidar y el
del handler de spawn. Requiere montar una SQLite temporal por test.

## Cosas que NO se harán (a menos que cambie el objetivo)

- Multi-tenancy.
- Roles/permisos.
- Inter-agent messaging.
- Agentes 24/7.
