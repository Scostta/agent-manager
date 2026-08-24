/**
 * Precios USD por millón de tokens (tarifas first-party de la API de Anthropic).
 * cacheWrite = 1.25x input, cacheRead = 0.1x input.
 *
 * Solo se usa como estimación en vivo mientras la run está en marcha: el evento
 * `result` del stream-json trae `total_cost_usd`, que es autoritativo y
 * sobreescribe esta estimación al terminar.
 */
export type ModelPricing = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

function tier(input: number, output: number): ModelPricing {
  return { input, output, cacheWrite: input * 1.25, cacheRead: input * 0.1 };
}

export const PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": tier(10, 50),
  "claude-mythos-5": tier(10, 50),
  "claude-opus-5": tier(5, 25),
  "claude-opus-4-8": tier(5, 25),
  "claude-opus-4-7": tier(5, 25),
  "claude-opus-4-6": tier(5, 25),
  "claude-sonnet-5": tier(3, 15),
  "claude-sonnet-4-6": tier(3, 15),
  "claude-haiku-4-5": tier(1, 5),
};

/** Tarifa usada cuando el modelo no está en la tabla. Deliberadamente la más
 *  cara: así el guard de presupuesto sobreestima en lugar de dejar pasar gasto. */
const FALLBACK_PRICING = PRICING["claude-fable-5"];

const warnedModels = new Set<string>();

export function resolvePricing(model: string): ModelPricing {
  // Los IDs con sufijo de fecha (claude-haiku-4-5-20251001) mapean a su ID base.
  const exact = PRICING[model];
  if (exact) return exact;

  const base = Object.keys(PRICING).find((id) => model.startsWith(id));
  if (base) return PRICING[base];

  if (!warnedModels.has(model)) {
    warnedModels.add(model);
    console.warn(
      `[pricing] Modelo desconocido "${model}". Usando la tarifa más cara como estimación conservadora.`,
    );
  }
  return FALLBACK_PRICING;
}

export type TokenCounts = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export function estimateCost(model: string, tokens: TokenCounts): number {
  const p = resolvePricing(model);
  return (
    (tokens.input * p.input +
      tokens.output * p.output +
      tokens.cacheRead * p.cacheRead +
      tokens.cacheWrite * p.cacheWrite) /
    1_000_000
  );
}
