# Claude Cockpit

Dashboard personal para gestionar agentes Claude, sus skills, CLAUDE.md y un kanban de tareas que esos agentes ejecutan.

## Arquitectura

```
Navegador (localhost:3000)  ─── HTTP/SSE ───▶  Fastify (localhost:3001)
                                                    │
                                                    ▼
                                              SQLite + Prisma
                                                    │
                                                    ▼ spawn
                                              claude CLI (stream-json)
```

Todo corre en tu PC. Sin Docker, sin Redis, sin Postgres.

## Requisitos

- Node.js 22 LTS (v22 recomendado, v20 también válido).
- pnpm 9+.
- Git.
- `claude` CLI (`npm i -g @anthropic-ai/claude-code`).
- Una API key de Anthropic.

## Arranque en Windows (PowerShell)

```powershell
# 1. Clonar en ruta corta para evitar problemas de rutas largas
cd C:\
git clone <url-del-repo> code\claude-cockpit
cd code\claude-cockpit

# 2. Instalar dependencias
pnpm install

# 3. Configurar API
cd apps\api
Copy-Item .env.example .env
# Edita .env y pon tu ANTHROPIC_API_KEY

# 4. Migrar BD y sembrar datos de ejemplo
pnpm db:migrate
pnpm db:seed

# 5. Arrancar en modo desarrollo
cd ..\..
pnpm dev
```

Abre `http://localhost:3000` para ver el placeholder del frontend.
Abre `http://localhost:3001/health` para comprobar que la API responde.

## Notas Windows

- **Modo desarrollador de Windows recomendado**: aunque los symlinks del runner usan `junction` que no requiere admin, activar Modo Desarrollador (Configuración → Privacidad y seguridad → Para programadores) evita fricción con otras herramientas.
- **Git line endings**: antes de clonar, ejecuta esto una vez:
  ```powershell
  git config --global core.autocrlf false
  git config --global core.eol lf
  ```
- **No pongas el repo en OneDrive**. OneDrive intentaría sincronizar `node_modules` y colapsa el equipo. Usa `C:\code\` o similar.
- **Windows Defender**: si notas ralentización compilando, puedes añadir tu carpeta de proyectos a exclusiones (Configuración → Seguridad de Windows → Protección contra virus → Exclusiones).

## Estructura

Ver [`CLAUDE.md`](./CLAUDE.md) para el layout completo del proyecto.

## Documentación

Ver carpeta `docs/`:
- `docs/01-architecture.md`
- `docs/02-data-model.md`
- `docs/03-api-reference.md`
- `docs/04-runner.md`
- `docs/05-development.md`
- `docs/06-roadmap.md`

## Estado

- Backend ✅ funcional con estrategia híbrida worktree/copy y compatibilidad Windows.
- Frontend ⏳ placeholder — pendiente de construir con los mocks de Claude Design.

## Flujo de una task (resumen)

1. Arrastras task de "Todo" a "In Progress" y eliges agente.
2. Frontend llama `POST /tasks/:id/run` con el `agentId`.
3. API crea `TaskRun`, lo encola. El worker prepara el workspace:
   - Si el proyecto es repo Git → `git worktree add -b cockpit/task-X/run-Y`.
   - Si no → copia recursiva con exclusiones.
4. Inyecta skills (symlinks) y CLAUDE.md del proyecto.
5. Spawn de `claude -p ...` con stream-json.
6. Parseo de eventos, tokens en vivo, log NDJSON.
7. Al terminar OK, task pasa a "Review".
8. Cuando marcas "Done", cleanup del worktree/copia.
