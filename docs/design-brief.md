# Design Brief para Claude Design

---

## Contexto

Necesito que diseñes la interfaz de **Claude Cockpit**, una aplicación web de escritorio para un solo usuario (desarrollador) que orquesta agentes de IA (Claude Code CLI) para ejecutar tareas sobre proyectos de código.

El backend está hecho. Lo que necesito son las pantallas clave del frontend: layouts, jerarquía visual, componentes, interacciones. No código, dirección de diseño.

## El usuario

- Un solo perfil: desarrollador técnico, avanzado, que ya usa Claude Code a diario desde la terminal.
- Abre esto en su navegador en localhost cuando quiere orquestar varias tareas en paralelo en lugar de tener 5 terminales abiertas.
- Quiere ver de un vistazo qué están haciendo sus agentes, cuánto le están costando, y mover tareas en un kanban como en Linear o Notion.
- Valora densidad de información, atajos de teclado, y que todo sea rápido. No es un usuario casual. Nada de onboarding tutorial ni microcopy amable.

## El producto en una frase

> Un panel de control local donde defino agentes Claude, les asigno skills, y los pongo a trabajar sobre tareas de un kanban por proyecto.

## Conceptos del dominio (para que los entiendas antes de diseñar)

- **Project** — un repositorio de código local. Tiene su propio kanban de tasks.
- **Agent** — una configuración reutilizable: nombre, rol, modelo (Opus/Sonnet/Haiku), system prompt largo, skills habilitadas, presupuesto máximo en USD.
- **Skill** — un fichero `SKILL.md` de Anthropic indexado desde el filesystem del usuario. Describe una capacidad específica (crear PDFs, manejar Word, diseñar UIs...). El usuario asigna qué skills puede usar cada agente.
- **Task** — una tarjeta del kanban con estados: Todo, In Progress, Review, Done, Blocked. Se asigna a un agente.
- **TaskRun** — una ejecución concreta. Una task puede tener varias runs (reintentos). Cada run acumula tokens y coste en vivo mientras el agente ejecuta.
- **CLAUDE.md** — ficheros markdown con instrucciones que se inyectan en el contexto del agente.

## Flujo principal del usuario

1. Entra a la app. Ve lista de proyectos.
2. Click en un proyecto → **Kanban de tasks del proyecto**.
3. Crea una nueva task (título + descripción larga).
4. Arrastra la task de "Todo" a "In Progress" y elige qué agente la ejecuta.
5. Se abre un **panel de ejecución en vivo** donde ve logs streaming, tokens acumulándose, coste en vivo.
6. Cuando el agente termina, la task pasa automáticamente a "Review". El usuario la abre, revisa el trabajo hecho, y decide si va a "Done" o vuelve a "Todo" para reintento.

## Pantallas que necesito diseñar

### 1. Shell / Layout base

- Sidebar izquierda (fina, vertical, con iconos + labels): Projects, Agents, Skills, CLAUDE.md, Settings.
- Header top: nombre del proyecto actual (breadcrumb), contador de "N runs activas" que es clickable y abre un tray con las runs corriendo.
- Área central: contenido de la página.
- Posible panel lateral derecho que se abre con el Run Console cuando hay runs en curso.

### 2. Lista de Projects

- Grid o lista densa de cards de proyectos.
- Cada card: nombre, descripción, ruta del repo (monoespaciada), número de tasks (badges por estado).
- Botón prominente "New project".

### 3. Kanban del proyecto (la pantalla estrella)

- 5 columnas: **Todo / In Progress / Review / Done / Blocked**.
- Scroll horizontal si hace falta; cada columna con scroll vertical propio.
- Cards de task compactas pero informativas:
  - Título.
  - Agente asignado (avatar pequeño + nombre).
  - Si tiene run activa: indicador pulsante + tokens acumulados + coste en vivo.
  - Última run: estado (ok/fail/cancelled) + timestamp relativo.
  - Skills requeridas como chips pequeños.
- Drag & drop entre columnas con feedback visual claro.
- Botón para añadir task al final de cada columna.
- Click en card → drawer lateral con detalles + historial de runs + botón "Run now".
- Considerar un modo compacto/denso (toggle).

### 4. Run Console

- Puede abrirse en panel lateral derecho (preferido) o en modal fullscreen.
- Cabecera: task, agent, modelo, tiempo transcurrido.
- Métricas en vivo bien visibles: input tokens, output tokens, cache read, coste USD. Que se actualicen con animación suave cuando llegan nuevos valores.
- Stream de eventos: tipo terminal/consola pero legible. Distinguir visualmente:
  - Tool calls del agente (bash, edit file, read file...) con un icono por tipo.
  - Respuestas de texto del agente.
  - Errores.
- Botones: Cancel run, Expand, View workspace files.

### 5. Lista y editor de Agents

- Lista con cards que muestren: avatar/color distintivo, nombre, rol, modelo, runs totales, coste acumulado.
- Editor de agente (página o modal grande):
  - Form vertical: nombre, rol, modelo (select con las opciones disponibles), maxBudgetUsd.
  - **System prompt**: textarea grande, mono, con soporte markdown preview opcional.
  - **Skill picker**: la parte más importante. Multiselect con buscador, filtrable por tag. Las skills aparecen como chips seleccionables con su descripción debajo del nombre.

### 6. Catálogo de Skills

- Grid de cards de skill: nombre, descripción corta (del frontmatter), scope badge (public/user/project), tags.
- Search bar + filtros por tag.
- Click → panel/modal con el SKILL.md renderizado en markdown + metadata (ruta en disco, hash, cuándo se modificó).
- Botón "rescan filesystem" arriba a la derecha.

### 7. Editor de CLAUDE.md

- Sidebar con lista de CLAUDE.md agrupados por scope: Global / Por proyecto / Por agente.
- Editor central: Monaco (VSCode) con split-view (markdown edit | preview).
- Header con el nombre, scope, botón "Save", botón "Sync to disk" si tiene filePath.

### 8. Vacíos y estados de error

- Lista de proyectos vacía: ilustración minimal + CTA "Crea tu primer proyecto".
- Kanban sin tasks: "Añade tu primera task en Todo".
- Skill sin fichero en disco: card en estado warning con botón "Rescan".
- Error al lanzar run: banner dismiss-able con el mensaje.

## Dirección estética

- **Desktop-first.** No necesita funcionar bien en móvil.
- **Tema oscuro por defecto**, claro como opción. Ambos bien.
- **Inspiraciones:** Linear (densidad, velocidad), Raycast (comandos, keyboard-first), GitHub (kanban de projects), Claude.ai (identidad visual si queremos guiño, pero sin copiar).
- **NO inspirarse en:** Jira, Monday, Asana. Son el anti-patrón para este usuario.
- **Tipografía:** sans-serif técnica (Inter, Geist, o similar). Monoespaciada para código y rutas (JetBrains Mono, Geist Mono).
- **Paleta:** pocos colores, mucho gris. Acento único para CTAs. Estados con rojo/amarillo/verde pero saturados bajos, no llamativos.
- **Iconografía:** Lucide o Phosphor.
- **Animaciones:** discretas, funcionales. Al mover una card, feedback inmediato. Al llegar tokens nuevos, pulso sutil. Nada decorativo.
- **Densidad alta.** Este usuario prefiere ver mucho a tener que scrollear. Asume monitor grande.

## Interacciones clave que no se te pueden olvidar

- **Command palette (⌘K)**: saltar a cualquier proyecto, agente, task. Acciones: "new task", "run task X", "cancel run Y".
- **Atajos de teclado** en el kanban: J/K para navegar entre cards, R para run, E para edit, / para focus en search.
- **Drag & drop** con preview del estado destino resaltado.
- **Tooltips informativos** pero no molestos. Mostrar solo al hover sostenido > 500ms.
- **Confirmaciones solo para destructivo.** Borrar proyecto, borrar agente con runs, kill switch. El resto sin modales.

## Entregables que espero de ti

1. **Moodboard / dirección visual**: 1 página con paleta, tipografía, estilo de componentes base, referencias.
2. **Wireframes de las 8 pantallas listadas arriba**: baja fidelidad, enfocados en layout y jerarquía de información.
3. **Mockups alta fidelidad** de las 3 más críticas:
   - Kanban del proyecto.
   - Run Console con stream en vivo.
   - Editor de Agente con skill picker.
4. **Guía de componentes** básica: botones, inputs, cards, badges, chips, tabs. En estados default/hover/active/disabled.
5. **Notas de interacción** para los flows del kanban y del run en vivo (qué pasa al arrastrar, qué se anima, qué se actualiza).

## Lo que NO necesito

- Landing page ni marketing.
- Onboarding paso a paso ni tutoriales.
- Componentes sobre-diseñados con ilustraciones pesadas.
- Modo móvil.
- Sistema de notificaciones complejo (por ahora un simple toast basta).

## Restricciones técnicas que afectan al diseño

- Framework: Next.js 15 + React 19 + Tailwind CSS + shadcn/ui.
- Iconos: Lucide.
- Gráficas (fase 2): Recharts.
- Editor: Monaco.
- Todo corre en localhost. No te preocupes por latencia de red.

---

**Objetivo:** que un desarrollador que abre esta app por primera vez entienda en 30 segundos cómo funciona y se sienta como en casa si ya usa Linear, Raycast o el propio Claude.ai. Que la sensación sea: "esto es potente y está hecho para mí".
