# Guía de desarrollo

## Setup inicial

```bash
# 1. Clonar y entrar
git clone <repo>
cd claude-cockpit

# 2. Instalar dependencias del monorepo
pnpm install

# 3. Configurar API
cd apps/api
cp .env.example .env
# Edita .env:
#   - ANTHROPIC_API_KEY=sk-ant-...
#   - WORKSPACES_ROOT, LOGS_ROOT, SKILLS_PATHS (ajusta a tu máquina)

# 4. Base de datos
pnpm db:migrate    # crea dev.db y aplica schema
pnpm db:seed       # crea un proyecto y dos agentes de ejemplo

# 5. Arrancar todo
cd ../..
pnpm dev
```

API en `http://localhost:3001`, Web en `http://localhost:3000`.

## Requisitos de sistema

- Node.js 20+ (probado con 20 y 22).
- pnpm 9+.
- `claude` CLI disponible en PATH. Instala con `npm i -g @anthropic-ai/claude-code`.
- Una API key de Anthropic.

## Flujos habituales

### Añadir un nuevo endpoint a la API

1. Crea el handler en `apps/api/src/routes/<módulo>.ts` (o añade al existente).
2. Valida la entrada con Zod.
3. Registra la ruta en `apps/api/src/index.ts` si es un módulo nuevo (`await app.register(miModulo)`).
4. Prueba con `curl`.

### Modificar el schema de BD

1. Edita `apps/api/prisma/schema.prisma`.
2. `pnpm db:migrate --name descripcion_del_cambio` — genera migración y regenera el cliente.
3. Actualiza rutas y tipos que consumen el modelo.
4. Si cambias algún array serializado como JSON string, actualiza los `.parse()` / `JSON.stringify()`.

### Añadir una dependencia

```bash
# A un workspace concreto
pnpm --filter api add <paquete>
pnpm --filter web add <paquete>

# De desarrollo
pnpm --filter api add -D <paquete>
```

### Debug de una run

1. Lanza la run desde la UI o con curl.
2. Mira `LOGS_ROOT/{runId}.ndjson` para ver el stream completo.
3. `curl -N localhost:3001/runs/<runId>/stream` para ver eventos en vivo.
4. `pnpm db:studio` para inspeccionar la tabla `TaskRun`.

### Inspeccionar un workspace

Cada run deja su workspace intacto en `WORKSPACES_ROOT/{taskId}/{runId}/`. Puedes entrar con tu editor y ver exactamente lo que dejó el agente.

## Convenciones

- **Imports ESM** con extensión `.js` aunque el fichero sea `.ts`. Obligatorio por `"type": "module"` + tsx.
- **Zod para validar entradas**, siempre.
- **No lógica de negocio en rutas.** Las rutas delegan a módulos bajo `runner/`, `skills/`, etc.
- **Config centralizada** en `src/config.ts`. Todas las env vars pasan por ahí con defaults razonables.
- **Errores HTTP** usando `@fastify/sensible`: `reply.notFound()`, `reply.badRequest(msg)`.

## Troubleshooting

**"Cannot find module './foo.js'"**
Has importado sin extensión o sin `.js`. Añádelo.

**"SQLITE_BUSY" al hacer migraciones**
Hay una conexión abierta (probablemente `db:studio`). Ciérrala y reintenta.

**La run se queda en `running` y nada pasa**
Probablemente el proceso `claude` no arrancó bien. Mira los logs de stderr en el NDJSON. Causas típicas: API key inválida, `claude` no está en PATH, permisos del workspace.

**Skills no aparecen en el catálogo**
Comprueba `SKILLS_PATHS` en `.env`. Luego `POST /skills/rescan` o reinicia la API.

**Los precios del coste están desactualizados**
Edita `apps/api/src/runner/pricing.ts` con los valores actuales de `docs.claude.com/en/docs/about-claude/pricing`.

## Testing

No hay tests todavía. Cuando los añadas:
- API: `vitest` + `supertest` contra la instancia de Fastify.
- Runner: mockea `child_process.spawn` y verifica el parsing del stream.
- Prioridad: tests del runner. Es la pieza más crítica y la más difícil de depurar sin tests.

## Deploy

El proyecto está pensado para localhost. Si algún día lo despliegas a un VPS, considera:

- Hacer `pnpm build` en ambos workspaces y servir con `node dist/index.js` y `next start`.
- Poner nginx o Caddy delante para HTTPS.
- Restringir por IP o con un bearer token simple en una cabecera (no hay sistema de auth hoy).
- Usar Tailscale si es solo para ti.
- Migrar a Postgres si va a correr 24/7.
