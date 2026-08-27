# Guía de desarrollo

## Setup Windows PowerShell

```powershell
cd C:\code\claude-cockpit
pnpm install
cd apps\api
Copy-Item .env.example .env
pnpm db:migrate
pnpm db:seed
cd ..\..
pnpm dev
```

Los valores por defecto del `.env.example` sirven tal cual: `AUTH_MODE` es
`subscription`, así que las runs consumen de tu plan usando el login de
claude.ai del propio CLI. **No hace falta `ANTHROPIC_API_KEY`** para empezar; solo
si quieres facturar por API (`AUTH_MODE=api_key`) o relanzar a mano una run que
se quedó sin cuota. De hecho, en modo suscripción el runner borra la key del
entorno del proceso hijo: si está presente, el CLI le da precedencia sobre tu
login y facturaría por API sin decir nada.

Hace falta el `claude` CLI instalado y en el PATH — el cockpit no habla con la
API de Anthropic, spawnea el binario.

## Comandos

- `pnpm dev` — API + Web en paralelo
- `pnpm dev:api` / `pnpm dev:web`
- `pnpm db:migrate` — migraciones Prisma
- `pnpm db:studio` — GUI de la BD
- `pnpm typecheck` — typecheck monorepo
- `pnpm test` — tests con `node:test` (por ahora solo `apps/api`)
- `pnpm db:seed` — datos de ejemplo

## Flujos habituales

### Añadir endpoint API
1. Handler en `apps/api/src/routes/<módulo>.ts`
2. Validar con Zod
3. Si es módulo nuevo, registrarlo en **`src/app.ts`**, no en `src/index.ts`.
   `app.ts` monta plugins y rutas; `index.ts` solo arranca el proceso. Una ruta
   registrada en `index.ts` no existiría para los tests, que levantan la app con
   `buildApp()`.
4. La lógica de negocio no va en la ruta: las rutas orquestan y lo demás vive en
   `src/runner/`, `src/tasks/`, `src/projects/`…

### Modificar schema
1. Pregunta antes: tocar el schema es de las cosas que el usuario quiere decidir.
2. Editar `apps/api/prisma/schema.prisma`
3. `pnpm db:migrate --name descripción`
4. Actualizar rutas y el espejo de tipos en `apps/web/src/lib/types.ts`

**Si la migración borra datos** (quitar una columna con valores), `prisma migrate
dev` es interactivo y se niega a generarla sin terminal. Escribe el
`migration.sql` a mano siguiendo el patrón `RedefineTables` de las migraciones ya
existentes —tabla nueva, `INSERT ... SELECT` con las columnas que sobreviven,
`DROP`, `RENAME`, recrear índices— y aplícalo con `prisma migrate deploy`, que sí
es no interactivo. Comprueba después que la columna se fue y que las filas siguen.

Las migraciones son historia: no edites una ya aplicada. El harness de tests las
aplica tal cual, así que una migración mal escrita se ve enseguida en verde o rojo.

### Añadir un test
1. Junto al código que prueba, como `foo.test.ts`.
2. Si necesita BD, **importa `src/test/harness.js` el primero de todo**: fija el
   entorno antes de que `config.ts` y `db.ts` se evalúen. Si `db.ts` carga antes,
   el cliente se conecta al `dev.db` real.
3. Nada de mockear Prisma, y nada de spawnear el CLI: se sustituye
   `runtime.spawn` por un proceso simulado que escupe stream-json.
4. Para probar qué se encola sin ejecutarlo, `stopEverything()` deja la cola en
   pausa.
5. **Valida el test reintroduciendo el bug que cubre.** Si sigue en verde con el
   bug dentro, no vale — y a veces lo que descubres es que el "bug" no cambiaba
   nada observable, que también es información.

### Debug de una run
1. Lanza desde UI o `curl`
2. Log completo en `LOGS_ROOT/{runId}.ndjson`. **Empieza por la primera línea**:
   la escribe el cockpit, no el CLI, y dice con qué se lanzó la run — modelo,
   flags y el prompt entero. Es lo que explica una salida rara sin adivinar.
3. `curl -N localhost:3001/runs/<runId>/stream` para eventos en vivo
4. `pnpm db:studio` para ver `TaskRun`, o `GET /runs?taskId=…` para el historial

### Inspeccionar workspace
Una run que salió bien deja su workspace en `WORKSPACES_ROOT/{taskId}/{runId}/`
hasta que pasas la tarea a `done`, mergeas o descartas. Desde la UI tienes el
diff y el botón de integrar; a mano, `GET /workspaces` dice qué hay, cuánto ocupa
y qué se podría liberar, con el porqué de cada veredicto.

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
- **"Author identity unknown" al mergear**: si tienes la identidad de git por repo y no en `--global`, los proyectos que crea el cockpit no tienen ninguna. `commitAll` y `mergeBranch` reintentan con una identidad de respaldo, así que esto ya no debería salir; si sale, configúrala en el repo.
- **`prisma generate` falla con EPERM en Windows**: hay un proceso node vivo (un `pnpm dev`, un test colgado) con el motor de Prisma abierto. Mátalo y repite.
- **Una run se queda sin cuota**: no es un fallo de la tarea. La UI ofrece esperar al reset o tirar de la API key, y en ambos casos retoma la sesión en vez de empezar de cero. Su workspace se conserva justo para eso.
