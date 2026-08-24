/**
 * Precios USD por millón de tokens.
 * Fuente: consultar docs.claude.com/en/docs/about-claude/pricing antes de usar en prod.
 * Valores aproximados para placeholder — actualízalos con los precios vigentes.
 */
export const PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number }
> = {
  "claude-opus-4-7": { input: 15, output: 75, cacheRead: 1.5 },
  "claude-opus-4-6": { input: 15, output: 75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1 },
};

export function estimateCost(
  model: string,
  input: number,
  output: number,
  cacheRead: number,
): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (input * p.input) / 1_000_000 +
    (output * p.output) / 1_000_000 +
    (cacheRead * p.cacheRead) / 1_000_000
  );
}
