# Roadmap

## Estado actual

Backend completo con estrategia híbrida worktree/copy y compatibilidad Windows.
Frontend con todas las pantallas del MVP y el dashboard de consumo.

Las runs ya no son de un solo tiro: se pueden retomar con `--resume`, cada
agente decide qué herramientas del CLI puede usar, el navegador avisa cuando una
termina y el log guarda con qué se lanzó.

El ciclo completo está validado en real: spawn del CLI → stream-json → SSE → UI,
con tokens y coste registrados, y el trabajo saliendo del worktree al repo.

**Las ocho fases están cerradas y no hay pendientes.** Lo que queda al final del
documento está descartado a propósito, no aparcado. Antes de proponer trabajo
nuevo conviene mirar ahí: alguna de las ideas obvias ya tiene su motivo escrito.

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

320 tests con `node:test`, sin dependencias nuevas: 268 en `apps/api` y 52 en
`apps/web`. Además de la lógica pura ya
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
- **Inyección de CLAUDE.md**: que el global llegue de verdad al workspace (era
  el bug), que vaya antes del de proyecto, que no machaque el del repo, que
  reinyectar no acumule copias, y que sin nada que inyectar no se cree el
  fichero. Y en la ruta, que no se cuelen dos globales por ningún camino.
- **Herramientas por agente**: que sin listas no salga ningún flag (un
  `--allowedTools` vacío sería "ninguna herramienta"), que un JSON roto no tumbe
  la run, que un patrón con espacios no se parta en varios argv, que la
  restricción sobreviva al retomar una sesión, y que un PATCH parcial no borre
  los permisos que no menciona.
- **Aviso y registro**: que el `run_finished` lleve título y agente dentro (si
  no, el navegador tendría que ir a buscarlos), que avise también la run que ni
  arranca —el silencio más caro— y que la línea de petición vaya la primera y no
  repita el prompt dentro de los flags.
- **Continuar sesión**: qué se puede retomar y qué no, que el CLI se llame con
  `--resume` y el prompt corto desde el workspace del padre, que una
  continuación fallida no borre el workspace que no es suyo, que la cuota
  agotada lo conserve mientras un fallo normal sí se limpia, y que el GC no
  feche una carpeta por la run que le da nombre sino por la última que la usó.

Los tests se validan reintroduciendo el bug que cubren: si el test sigue en
verde con el bug dentro, no cuenta. Así apareció el hueco del reaper (faltaba el
caso mixto: historial y huérfana conviviendo en la misma BD).

## Fase 5 ✅

Ordenados por lo que aportan. Salieron de revisar el código, no de una lluvia de
ideas: cada uno apunta al sitio concreto que lo justifica.

### 1. Continuar una sesión en vez de relanzarla ✅

El `session_id` del evento `init` se guarda en `TaskRun`, y con él `--resume`
sigue la conversación en vez de reconstruirla. Una continuación es una
`TaskRun` nueva con `resumedFromId`: hereda el workspace y la rama del padre
—el CLI busca las sesiones por directorio— y no las limpia, porque no son suyas.

- **"Seguir con instrucciones"** en el visor de run, que es lo natural al
  revisar un diff. Falla si la sesión no se puede retomar en vez de relanzar de
  cero: quien pide un ajuste no espera pagar una run entera.
- **Los tres modos de retry** retoman si pueden y avisan de cuál fue. Para que
  puedan, una run cortada por cuota ya no borra su workspace: se conservan tanto
  el sitio al que volver como el trabajo hecho antes del corte.
- El GC fecha cada carpeta por la run más reciente que la usó, no por la que le
  da nombre, y no toca una donde haya una continuación viva.

Detalles en `docs/04-runner.md`.

### 2. Qué herramientas puede usar cada agente ✅

`Agent` tiene `allowedTools` y `disallowedTools`, y el spawn añade los flags
correspondientes. Sin listas no se añade nada, así que los agentes que ya
existían corren exactamente igual que antes.

Las dos listas y no solo la de permitidas porque la lista de herramientas del
CLI crece con cada versión: expresar "todo menos Bash" con una allowlist obliga
a enumerar el resto y se queda obsoleta sola.

La UI del agente trae los tres casos como atajos (Todo / Solo lectura / Todo
menos Bash) y deja escribir a mano lo que sea, patrones del CLI incluidos. El
`Reviewer` del seed pasa a ser de solo lectura: su prompt ya decía "no
implementas", pero hasta ahora eso era una petición, no una restricción.

### 3. Decidir qué es `requiredSkillIds` ✅ — se quita

Se guardaba, se validaba y se pintaba, y no lo consumía nadie: el executor
inyecta las skills del *agente*, no las que la task declaraba requerir. Marcar
una skill en una task no cambiaba nada de lo que veía el agente.

Decisión: fuera. Las skills ya están conectadas a los agentes, que es donde el
executor las lee. Un campo decorativo en el modelo de dominio envenena las
decisiones que vengan después.

Con él se va toda su fontanería: el `skills` que atravesaba `Column` →
`TaskCard` → `TaskDrawer` sin más uso que pintarlo, y el `useSkills()` del
kanban. La ruta ignora el campo si llega (Zod descarta lo que no conoce), que es
lo que pasa con una pestaña abierta con el bundle viejo.

### 4. Avisar cuando una run termina ✅

El executor emite `run_finished` por el canal `board` con lo justo para pintar
el aviso sin pedir nada más. El listener vive en el `AppShell` —el aviso solo
sirve si llega estés donde estés— y hay un interruptor en la cabecera que pide
permiso al pulsarlo, que es el gesto que los navegadores esperan.

Solo salta con la pestaña de fondo: con el cockpit delante la UI ya se actualiza
sola y avisar encima sería ruido. Al activarlo se lanza un aviso de prueba,
porque si no quien lo enciende y se queda mirando no ve nada y lo da por roto.
Una run cancelada no avisa: la cancelaste tú.

### 5. Registrar el prompt que se envió ✅

Primera línea del NDJSON, escrita antes del spawn para que la run que ni
arranca también deje constancia: modelo, flags (sin el `-p`, que duplicaría el
prompt), de qué run se retoma y el prompt entero. El visor la pinta como un
bloque aparte; los logs viejos se leen igual.

## Fase 6 ✅ — Lo que no hacía nada, y lo que faltaba

Salió de revisar el proyecto al cerrar la Fase 5.

### El scope `global` de CLAUDE.md no llegaba a ninguna run ✅

`executor.ts` solo inyectaba `project.claudeMd`. Un documento global —"para
todos los proyectos", según la propia UI— se guardaba, se editaba en Monaco y
no lo veía ningún agente. Peor que un campo decorativo: el editor **creaba los
documentos nuevos con scope global por defecto** y la lista los etiquetaba
"Global", así que la etiqueta mentía y se tragaba en silencio lo que escribías.

Ahora se inyecta en todas las runs, antes del bloque del proyecto para que lo
específico pueda matizar lo general. Solo puede haber uno: con dos y sin un
orden visible en la UI, qué acaba leyendo el agente sería un misterio, así que
crear (o convertir) un segundo devuelve un 400 que dice qué hacer.

El scope `agent` se quita, y este sí por redundante: el `systemPrompt` del
agente ya es el sitio de las instrucciones propias de un agente, y nunca tuvo
FK que lo enlazara.

### `Agent.status` ✅ — se quita

`idle | running | paused | disabled`: nadie lo escribía —el Zod del PATCH ni lo
aceptaba— y nadie lo leía. Una máquina de estados en el modelo de dominio que no
existía.

Se quita en vez de conectarse porque los dos valores que suenan útiles son
estado del **sistema**, no tuyo, y guardarlos es pedir que se desincronicen: un
cierre a lo bruto dejaría un agente en `running` para siempre, exactamente el
problema que el reaper tiene que limpiar con las runs. Si algún día hace falta
"qué agente está ocupado", se deriva de sus runs en `queued`/`running`, que es
la verdad en vivo.

### Borrar un proyecto dejaba su `ClaudeMd` huérfano ✅

Las tasks y las runs caen en cascada; el `ClaudeMd` no, porque la FK vive en
`Project`. La fila sobrevivía al proyecto y se quedaba en el editor como un
documento "sin asignar" que ya no era de nadie. Ahora la ruta lo borra.

El fichero en disco se conserva: ese es del repo, no del cockpit. Hay test de
las dos cosas — que la fila se va y que el fichero se queda.

### Tests en `apps/web` ✅

30 tests, con el mismo `node:test` + tsx que la API y sin dependencias nuevas.
La regla: **solo lógica pura, sin DOM ni render.** Lo testeable se saca del
componente a `src/lib/` en vez de montar jsdom — si algún día hace falta probar
un componente de verdad, eso ya es una dependencia que hay que hablar.

El primero era `formatLogLine`, ahora en `lib/run-log.ts`: traduce cada evento
del stream-json a la línea que ves en el visor. Cuando el CLI cambie la forma de
un evento no saltará ningún error, simplemente dejarás de ver parte del log —
que es la peor manera de enterarte. Cubre los bloques del asistente, los
resultados de herramienta con su truncado, el evento final, la línea de petición
del cockpit y la salida que no es JSON.

De paso, `splitTools`/`sameTools` salieron del editor de agentes a
`lib/format.ts`, junto a `describeToolPolicy` que ya vivía ahí.

### Export/backup ✅

Todo el cockpit vive en un SQLite y no había copia en ningún sitio. Ahora la API
hace una al arrancar en `BACKUPS_ROOT` y conserva las `BACKUP_KEEP` últimas, y
`GET /backup` baja una cuando quieras desde el dashboard.

Tres decisiones que importan:

- **`VACUUM INTO`, no `copyFile`.** Da un snapshot consistente aunque haya
  escrituras en marcha, y de paso compacta.
- **Automática, no solo un botón.** Un backup que hay que acordarse de pulsar es
  un backup que no tienes. Va lo primero del arranque, antes que el reaper y el
  scanner: si algo de lo que viene después dejara la BD en mal estado, la copia
  es de justo antes. Y no puede tumbar el arranque — quedarse sin copia es malo,
  no arrancar es peor.
- **Restaurar es manual.** Parar la API, copiar el fichero encima de `dev.db`,
  arrancar. Un endpoint que sobrescriba la BD viva desde una petición web es
  justo lo que no quieres tener a un clic.

`keep: 0` desactiva la copia automática pero **no borra** las que ya tuvieras:
interpretarlo como "no conserves ninguna" sería lo contrario de lo que quiere
quien la desactiva. Tiene su test, como que la poda no toque ficheros que no ha
puesto ella.

### Editar SKILL.md desde la UI ✅

El catálogo era solo lectura. Ahora se edita con el mismo Monaco que CLAUDE.md:
al guardar se escribe en disco y se reindexa al momento, sin esperar a chokidar
—el watcher lo vería igual, pero durante ese instante la ficha enseñaría el hash
y los tags viejos.

Tres guardas antes de tocar el fichero, y las tres tienen test:

- **El frontmatter tiene que parsear.** El scanner ya captura un YAML roto y
  sigue, así que guardarlo no rompe nada… pero deja la skill con los metadatos
  viejos y sin decírtelo. Mejor negarse cuando puedes arreglarlo.
- **El `name` no puede cambiar.** Es la clave del upsert del scanner:
  renombrarlo desde el editor crearía una segunda entrada apuntando al mismo
  fichero.
- **La ruta tiene que estar dentro de `SKILLS_PATHS`.** El `filePath` sale de la
  BD, y una fila tocada a mano convertiría el endpoint en un "escribe donde
  quieras" con los permisos de la API.

Crear y borrar SKILL.md se queda fuera: eso es tu editor y un `mkdir`.

### Repesca de avisos perdidos ✅

El SSE no reemite nada, así que una run que terminara mientras el
`EventSource` reconectaba no avisaba nunca. `GET /runs` acepta ahora
`endedAfter`, y el hook pregunta en cada `onopen` —que es también cada
reconexión— qué ha terminado desde la última vez que supo algo.

Estrictamente posterior, no "desde": con `gte` cada reconexión reavisaría de la
última run. Y las que llegan por el stream se marcan como vistas aunque no se
notifiquen (pestaña delante, o canceladas), para que la repesca no las saque
después.

## Fase 7 ✅ — Color propio para cada agente

Salió de mirar la pantalla de agentes: tres de los cuatro salían del mismo
verde.

`agentColor()` sumaba los códigos de carácter del nombre y hacía módulo 7.
Sumar ignora la posición —cualquier anagrama colisiona— y con nombres cortos y
parecidos el reparto se apelotona: `Reviewer`, `Tester` y `Backend` daban los
tres el mismo resto.

Arreglar el hash no bastaba. Con 7 colores y 5 agentes hay ~65% de que dos
choquen por puro cumpleaños, así que un hash, por bueno que sea, nunca puede
prometer que no se repitan. Para eso hay que repartir conociendo el conjunto, y
eso obliga a guardar la elección: **`Agent.color`**, hex `#RRGGBB`.

- **Elige la UI, no la API.** Es la única que conoce la paleta y qué colores
  están cogidos. `pickAgentColor()` propone el menos usado —mientras queden
  libres, siempre uno sin estrenar— y a partir de ahí manda la muestra que
  pulses. La API solo comprueba que sea un hex: ese valor acaba en un `style`
  del frontend, y ahí no puede entrar texto libre.
- **La columna es nullable y no se rellenó a la fuerza.** Una fila sin color cae
  en el hash del nombre, que es exactamente como se veían todas hasta ahora. Al
  abrir la ficha de un agente viejo se siembra el color que ya se le ve, así que
  guardarlo no le cambia el aspecto de golpe.
- **La paleta pasa de 7 a 9.** No arregla nada por sí sola, pero deja margen
  antes de dar la segunda vuelta.

El hash sigue existiendo como respaldo, ya con FNV-1a. Tiene sus tests, y el de
anagramas es el que falla si alguien vuelve a la suma.

## Fase 8 ✅ — Crear skills desde la UI, sin configurar rutas

Dos quejas de uso, y la primera es la que manda:

**"Para las skills hay que poner un path en el `.env`; el CLAUDE.md no lo
necesita y es más cómodo."** Tenía razón en el fondo aunque `SKILLS_PATHS` ya
tuviera un default: el modelo mental era *"dime dónde tienes tus skills"*, y eso
es trabajo del usuario antes de poder empezar. Ahora el cockpit tiene su propia
carpeta (`SKILLS_ROOT`, por defecto `./skills`) que **se crea sola al arrancar**,
como ya hacían `logs`, `backups` y `workspaces`, y que se escanea siempre.

`SKILLS_PATHS` deja de ser el sitio donde viven las skills y pasa a ser
*carpetas adicionales*, opcional y normalmente vacía: solo la tocas si ya tienes
skills en otro lado, como `~/.claude/skills`. Las dos listas se deduplican —en
Windows sin distinguir mayúsculas— para no escanear la misma carpeta dos veces.

**Crear una skill desde la UI.** Desde la Fase 6 se podía *editar* un SKILL.md
pero no *crearlo*, y el motivo que quedó escrito ("eso es tu editor y un
`mkdir`") se sostenía mucho peor con media UI ya hecha. `POST /skills` pide solo
nombre y descripción, escribe la plantilla y devuelve la skill **ya indexada**,
que es lo que permite abrirla en el Monaco de al lado sin esperar a chokidar.

Las decisiones que importan:

- **El destino no es un parámetro.** El endpoint no acepta ruta: escribe siempre
  dentro de `SKILLS_ROOT`. Dejar elegir carpeta convertiría "crear una skill" en
  "escribe este fichero donde yo te diga" con los permisos de la API.
- **El nombre se valida a kebab-case.** No es cosmética: ese nombre es el de la
  carpeta y, sobre todo, el del symlink que `injectWorkspaceResources` planta en
  `.claude/skills/<name>` del workspace. Un `../..` ahí escribiría fuera. Tiene
  test, y de los que fallan si quitas la guarda.
- **La descripción va por `JSON.stringify` en el frontmatter.** Es texto libre y
  un `:` o unas comillas romperían el YAML: la skill quedaría creada en disco
  pero sin indexar, que es el fallo silencioso caro.
- **No se pisa nada.** Se comprueba el nombre en BD *y* el fichero en disco: una
  carpeta suelta que el índice no conoce se machacaría sin avisar.

Se queda fuera **borrar desde la UI**: sigue siendo borrar la carpeta, y el
watcher la desindexa solo.

El slug se aplica según escribes, y ahí salió un bug que solo se ve usándolo:
normalizar en cada tecla se comía el separador entre palabras —"Revisar
Migración SQL" quedaba en "revisarmigracionsql"— porque el guion final se
recortaba como si fuera un borde. Hay una variante para el borrador que lo
conserva y su test simula el tecleo letra a letra.

## Cosas que NO se harán (a menos que cambie el objetivo)

- Multi-tenancy.
- Roles/permisos.
- Inter-agent messaging.
- Agentes 24/7.
