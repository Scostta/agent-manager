/**
 * Color de identidad de un agente. Vive en `lib/` y no en los primitivos
 * porque el reparto es lógica pura y se testea sin montar un componente.
 *
 * La verdad la guarda la API en `Agent.color`. Aquí solo está la paleta que
 * ofrece el selector, cómo se elige el color por defecto al crear un agente y
 * el respaldo para las filas que aún tienen `color` a null (las que se crearon
 * antes de que existiera la columna, o desde el seed y curl).
 */

export const AGENT_COLORS = [
  "#7B6CF6",
  "#3FBA6E",
  "#E05050",
  "#C9961A",
  "#4A9EE8",
  "#D9784A",
  "#B06CB0",
  "#2FB5AD",
  "#E0699B",
] as const;

export type AgentColor = (typeof AGENT_COLORS)[number];

/** Lo que acepta la API: hex de 6 dígitos con almohadilla. */
export const AGENT_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Respaldo para agentes sin color guardado. FNV-1a y no la suma de los códigos
 * de carácter que había antes: sumar ignora la posición, así que cualquier
 * anagrama colisiona y los nombres cortos y parecidos se apelotonaban en el
 * mismo resto (Reviewer, Tester y Backend salían los tres del mismo color).
 * Sigue sin garantizar nada —son 9 colores— y por eso es solo el respaldo.
 */
export function agentColor(name: string): string {
  let hash = 2166136261;
  for (const ch of name) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

/** El color de un agente: el suyo si lo tiene, si no el derivado del nombre. */
export function resolveAgentColor(agent: { name: string; color?: string | null }): string {
  return agent.color ?? agentColor(agent.name || "??");
}

/**
 * Color por defecto al crear un agente: el menos usado de la paleta, y a
 * igualdad de uso el primero. Mientras queden colores libres eso es siempre
 * uno sin estrenar, que es justo lo que se busca; a partir del décimo agente
 * empieza una segunda vuelta repartida en vez de amontonarse.
 */
export function pickAgentColor(used: readonly (string | null | undefined)[]): string {
  const counts = new Map<string, number>(AGENT_COLORS.map((color) => [color, 0]));
  for (const color of used) {
    if (!color) continue;
    const key = color.toUpperCase();
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
  }
  let best = AGENT_COLORS[0] as string;
  for (const color of AGENT_COLORS) {
    if (counts.get(color)! < counts.get(best)!) best = color;
  }
  return best;
}
