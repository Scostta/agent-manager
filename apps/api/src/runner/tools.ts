/**
 * Qué herramientas del CLI puede usar un agente.
 *
 * Hasta ahora todas las runs salían con `--permission-mode acceptEdits` y sin
 * ninguna lista, así que cualquier agente podía ejecutar bash arbitrario en su
 * workspace. Un revisor o un documentador no necesitan eso.
 */

export type ToolPolicy = {
  allowedTools: string | null;
  disallowedTools: string | null;
};

/**
 * Lo guardado es un JSON string, como el resto de arrays en SQLite. Si viene
 * roto no reventamos la run: se ignora la lista y se avisa. Quedarse sin
 * restricción es lo mismo que hacía el cockpit antes de que esto existiera.
 */
export function parseToolList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tool): tool is string => typeof tool === "string" && !!tool.trim());
  } catch {
    console.warn(`[tools] lista de herramientas ilegible, se ignora: ${raw}`);
    return [];
  }
}

/**
 * Los flags que hay que añadir al spawn. Sin listas no se añade nada: pasar
 * `--allowedTools` vacío no es "todo", es "ninguna", y dejaría al agente
 * mirando el repo sin poder tocarlo.
 *
 * El CLI acepta la lista separada por comas en un solo argumento, que es como
 * ya la pasa el planificador. Va en un único argv, así que un patrón con
 * espacios como `Bash(git *)` viaja entero.
 */
export function toolArgs(policy: ToolPolicy): string[] {
  const args: string[] = [];
  const allowed = parseToolList(policy.allowedTools);
  const disallowed = parseToolList(policy.disallowedTools);

  if (allowed.length) args.push("--allowedTools", allowed.join(","));
  if (disallowed.length) args.push("--disallowedTools", disallowed.join(","));

  return args;
}

/** Para explicar en la UI y en los logs con qué restricción corre un agente. */
export function describeToolPolicy(policy: ToolPolicy): string {
  const allowed = parseToolList(policy.allowedTools);
  const disallowed = parseToolList(policy.disallowedTools);

  if (!allowed.length && !disallowed.length) return "sin restricción";

  const parts: string[] = [];
  if (allowed.length) parts.push(`solo ${allowed.join(", ")}`);
  if (disallowed.length) parts.push(`sin ${disallowed.join(", ")}`);
  return parts.join(" · ");
}
