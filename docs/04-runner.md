# El Runner

El runner es la pieza crítica del sistema: lo que convierte una task en un proceso de `claude` CLI ejecutándose. Vive en `apps/api/src/runner/`.

## Piezas

- **`queue.ts`** — Cola global `p-queue` con `concurrency: 2`. Punto de entrada: `enqueueTaskRun(taskId, agentId)`.
- **`executor.ts`** — Ejecuta una `TaskRun` concreta. Spawnea `claude`, parsea stream-json, actualiza BD, emite eventos.
- **`pricing.ts`** — Tabla de precios por modelo para calcular coste en USD.

## Ciclo de vida de una run

### 1. Encolado

```ts
enqueueTaskRun(taskId, agentId)
  ├─ crea TaskRun en BD con status 'queued'
  ├─ mueve la Task a status 'in_progress'
  └─ añade a p-queue → executeTaskRun(runId)
```

### 2. Preparación del workspace

```
WORKSPACES_ROOT/
  {taskId}/
    {runId}/
      ├─ (copia del repo del proyecto)
      ├─ .claude/
      │   └─ skills/
      │       ├─ {skill-1}/ → symlink a la skill real
      │       └─ {skill-2}/ → symlink
      └─ CLAUDE.md  (inyectado desde el proyecto)
```

El repo se copia sin `node_modules` ni `.git`. Si el repo es grande y molesta, es el primer sitio donde optimizar (git worktree, hardlinks).

### 3. Construcción del prompt

```
<systemPrompt del agente>

---
# Tu tarea asignada

**{task.title}**

{task.description}

---
Tienes disponibles estas skills: {lista}. Cárgalas desde .claude/skills/ cuando sean relevantes.

Trabaja sobre el workspace actual. Cuando termines, entrega un resumen breve del trabajo hecho.
```

Está en `buildPrompt()` dentro de `executor.ts`. Ajusta allí si quieres cambiar la forma de presentar la task.

### 4. Spawn del proceso

```bash
claude \
  -p "<prompt>" \
  --output-format stream-json \
  --verbose \
  --model <modelo> \
  --permission-mode acceptEdits
```

Con `detached: true` en Node para que el proceso vaya a su propio process group. Esto permite matar el árbol completo con `process.kill(-pid, 'SIGTERM')` si hay que cancelar.

El env lleva `ANTHROPIC_API_KEY` inyectada desde `config.anthropicApiKey`.

### 5. Parser stream-json

Cada línea de stdout se parsea como JSON. Los eventos tienen formatos distintos (message_start, content_block_delta, message_stop, etc.). Lo relevante:

- Si `event.message.usage` o `event.usage` existen, se acumulan tokens y se recalcula coste.
- Si la línea no es JSON válida, se emite como `{ type: 'log' }` sin bloquear la run.
- Cada línea se escribe tal cual al NDJSON de `LOGS_ROOT/{runId}.ndjson` para auditoría.

### 6. Cierre

Cuando el proceso termina:

- `signal === 'SIGTERM'` → `cancelled`.
- `code === 0` → `succeeded`; task pasa a `review`.
- Otro → `failed`; task se queda como está.

`endedAt` se marca. `pid` se limpia. Se emite `{type: 'status'}` final por el bus.

## Cancelación

`cancelRun(runId)` busca el proceso en `activeProcesses: Map<runId, ChildProcess>` y:

1. `process.kill(-pid, 'SIGTERM')` para matar el process group.
2. Fallback a `proc.kill('SIGTERM')` si falla el primero.

No se usa SIGKILL porque queremos que `claude` tenga chance de limpiar. Si hiciera falta matanza dura, se añadiría un `setTimeout` con SIGKILL después de N segundos.

## Control de budget

Cada vez que llegan tokens nuevos, se recalcula el coste. Si `agent.maxBudgetUsd` está definido y el coste actual lo supera, se llama a `cancelRun(runId)` y la run acaba como `cancelled`. Es un hard-stop, no hay aviso gradual.

## Concurrencia

`p-queue` con 2 en paralelo por defecto. Configurable en `queue.ts`. El número razonable depende de:

- Cuánta RAM consume cada proceso `claude` (50-150 MB típico).
- Cuánta CPU estés dispuesto a ceder.
- Cuántos repos/workspaces caben en disco simultáneamente.

Para un PC normal con 16GB RAM, 2-4 es razonable. Más allá, la latencia por request empieza a notarse.

## Logs para debugging

- `LOGS_ROOT/{runId}.ndjson` — stream completo del CLI.
- stdout del proceso `api` — logs estructurados de Fastify.
- Los eventos emitidos por el bus se pueden inspeccionar abriendo `/runs/:id/stream` con `curl -N`.

## Limitaciones conocidas

- Si el proceso `api` cae en medio de una run, la run queda huérfana en `running` en BD. Un cleanup al arranque marcando runs `running` como `failed` sería trivial de añadir.
- No hay retry automático. Si una run falla, el usuario decide si relanzar.
- El workspace no se limpia. Los discos se llenan a base de usar esto. Futuro: GC basado en edad.
