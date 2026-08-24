# Roadmap

## Estado actual

Backend completo con estrategia híbrida worktree/copy y compatibilidad Windows. Frontend es un placeholder.

## Fase 1 — Frontend MVP

Por orden:
1. **Layout base con sidebar** (Projects, Agents, Skills, CLAUDE.md, Ajustes) + header con `/queue/stats`.
2. **Lista de Projects** + modal para crear (detecta estrategia automáticamente).
3. **Kanban del proyecto** con `@dnd-kit/core`, drawer de detalle de task, botón Run.
4. **Run Console** con SSE en vivo, tokens/coste actualizándose, botón Cancel.
5. **Agentes**: CRUD + skill picker.
6. **Skills**: catálogo con búsqueda y preview del SKILL.md.
7. **CLAUDE.md**: editor Monaco con split preview.

## Fase 2 — Review PR-style

Aprovechar los worktrees:
- Botón "Ver diff" en cada run que usa `GET /runs/:id/diff`.
- Botón "Mergear a main" ejecutando `git merge --no-ff` en el repo.
- Botón "Descartar" (borra worktree y rama).

## Fase 3 — Dashboard de tokens/costes

Recharts + endpoint de agregados por agente/proyecto/día.

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
