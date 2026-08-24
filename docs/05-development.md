# Guía de desarrollo

## Setup Windows PowerShell

```powershell
cd C:\code\claude-cockpit
pnpm install
cd apps\api
Copy-Item .env.example .env
# editar .env con tu ANTHROPIC_API_KEY
pnpm db:migrate
pnpm db:seed
cd ..\..
pnpm dev
```

## Comandos

- `pnpm dev` — API + Web en paralelo
- `pnpm dev:api` / `pnpm dev:web`
- `pnpm db:migrate` — migraciones Prisma
- `pnpm db:studio` — GUI de la BD
- `pnpm typecheck` — typecheck monorepo

## Flujos habituales

### Añadir endpoint API
1. Handler en `apps/api/src/routes/<módulo>.ts`
2. Validar con Zod
3. Si es módulo nuevo, registrar en `src/index.ts`

### Modificar schema
1. Editar `apps/api/prisma/schema.prisma`
2. `pnpm db:migrate --name descripción`
3. Actualizar rutas y tipos

### Debug de una run
1. Lanza desde UI o `curl`
2. Log completo en `LOGS_ROOT/{runId}.ndjson`
3. `curl -N localhost:3001/runs/<runId>/stream` para eventos en vivo
4. `pnpm db:studio` para ver `TaskRun`

### Inspeccionar workspace
Cada run deja su workspace intacto en `WORKSPACES_ROOT/{taskId}/{runId}/` hasta cleanup.

## Convenciones

- Imports ESM con `.js` incluso apuntando a `.ts`
- Zod en todas las entradas
- Config centralizada en `src/config.ts`
- Errores HTTP con `@fastify/sensible`

## Troubleshooting

- **`claude` no encontrado**: verifica que está en PATH, `where claude` en PowerShell.
- **SQLITE_BUSY**: cierra `db:studio` u otras conexiones abiertas.
- **Run atascada en running**: reinicia la API, el reaper lo marcará como failed al arranque.
- **Skills no aparecen**: comprueba `SKILLS_PATHS` en `.env`, luego `POST /skills/rescan`.
- **git worktree failed**: si el repo tiene la rama de la run ya existente, el helper la borra antes. Si falla otra cosa, ejecuta `git worktree prune` manualmente en el repo.
