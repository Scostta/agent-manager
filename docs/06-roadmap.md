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

## Fase 4 — Refinamientos

- Dependencias entre tasks (`dependsOn`) enforzadas.
- GC programado de worktrees viejos por edad.
- Kill switch global.
- Templates de proyecto.

## Cosas que NO se harán (a menos que cambie el objetivo)

- Multi-tenancy.
- Roles/permisos.
- Inter-agent messaging.
- Agentes 24/7.
