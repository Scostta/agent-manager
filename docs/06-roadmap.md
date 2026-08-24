# Roadmap

## Estado actual (MVP backend)

Completado:

- Schema Prisma con SQLite.
- API Fastify con rutas de projects, agents, skills, tasks, runs, claude-md.
- Runner que spawnea `claude` CLI y parsea stream-json.
- Cola en memoria con p-queue.
- Skills scanner con hot-reload via chokidar.
- SSE para stream de runs y del kanban.
- Seed inicial.

Pendiente:

- **Frontend completo** (es lo más urgente).
- Tests.
- Dashboard de tokens/costes con gráficas.

## Fase 1 — Frontend MVP

Prioridad por orden:

1. **Layout base con sidebar**
   - Sidebar con: Proyectos, Agentes, Skills, CLAUDE.md, Ajustes.
   - Header con estado de cola (N runs activas).

2. **Página de Proyectos**
   - Lista / grid de proyectos.
   - Botón "nuevo proyecto" con modal.
   - Click → kanban del proyecto.

3. **Kanban de proyecto** (la página más importante)
   - Columnas: todo, in_progress, review, done, blocked.
   - Drag & drop con `@dnd-kit/core`.
   - Card de task muestra: título, agente asignado (avatar), último run (status, tokens, coste).
   - Click en card → modal/drawer con detalles + historial de runs.
   - Botón "Run" en la card si está asignado a un agente.

4. **Run Console**
   - Drawer o panel lateral que se abre al lanzar una run.
   - Se suscribe a `/runs/:runId/stream`.
   - Muestra: tokens en vivo, coste en vivo, log streaming.
   - Botón "Cancelar".

5. **Página de Agentes**
   - Lista con stats (runs totales, coste acumulado).
   - Form de creación/edición: nombre, rol, modelo (select), systemPrompt (textarea grande), maxBudget, **skill picker** (multi-select con search y filtros por tag).

6. **Página de Skills**
   - Catálogo tipo grid con search y filtros por tag/scope.
   - Click → panel con el SKILL.md renderizado (markdown preview).
   - Botón "rescan" manual.

7. **Editor de CLAUDE.md**
   - Lista de CLAUDE.md existentes por scope.
   - Editor Monaco con split-view (edición + preview markdown).
   - Guardar persiste en BD y opcionalmente en disco.

## Fase 2 — Refinamientos

- **Dashboard de tokens/costes**
  - Recharts, gráfica temporal de coste por día/semana.
  - Top agentes por coste.
  - Breakdown por proyecto.

- **Dependencias de tasks**
  - Enforzar: una task con `dependsOn` sin terminar no arranca.
  - Visualizar el grafo de dependencias en el kanban (líneas entre cards).

- **Validación de skills requeridas**
  - Al asignar agente a una task, warning si al agente le faltan las `requiredSkillIds` de la task.

- **Cleanup de workspaces**
  - GC automático de workspaces > N días.
  - Botón manual "limpiar runs viejas".

- **Kill switch global**
  - Tipo AgentManager. Un botón que mata todos los procesos y bloquea nuevos hasta desactivar.

- **Watcher de runs huérfanas**
  - Al arrancar la API, marcar como `failed` las runs que quedaron en `running` (el proceso padre cayó).

## Fase 3 — Ideas a evaluar

- **Multi-máquina / acceso desde móvil**
  - Tailscale para el caso personal.
  - O migrar a Postgres + desplegar API en VPS.

- **Templates de proyecto**
  - Guardar configs completas (proyecto + agentes + skills asignadas) y clonarlas.

- **Hooks post-run**
  - Tras terminar una run, ejecutar un command configurable (ej: `git push`, notificación).

- **Inter-agent messaging** — **solo si lo pides**. No antes.

- **Heartbeats / agentes 24/7** — solo si se convierte en una necesidad real. No antes.

## Cosas que no se van a hacer (a menos que cambie el objetivo)

- Multi-tenancy / organizaciones.
- Sistema de roles y permisos granulares.
- Pasarelas de pago, suscripciones.
- IDE integrado en la UI. Usa tu editor.
- Chatbot conversacional con el agente. Los agentes ejecutan tasks, no conversan.
