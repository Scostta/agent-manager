import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { PRICING, estimateCost, resolvePricing } from "./pricing.js";

const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

describe("resolvePricing", () => {
  test("un ID exacto usa su propia tarifa", () => {
    assert.equal(resolvePricing("claude-opus-5"), PRICING["claude-opus-5"]);
    assert.equal(resolvePricing("claude-haiku-4-5"), PRICING["claude-haiku-4-5"]);
  });

  test("un ID con sufijo de fecha cae en su tarifa base", () => {
    // El CLI reporta el modelo con fecha en modelUsage: sin esto, cada run
    // real se cobraría a la tarifa de fallback, la más cara de la tabla.
    assert.equal(
      resolvePricing("claude-haiku-4-5-20251001"),
      PRICING["claude-haiku-4-5"],
    );
  });

  test("un modelo desconocido usa la tarifa más cara, no la más barata", () => {
    // El fallback alimenta el guard de presupuesto: sobreestimar corta de más,
    // subestimar deja pasar gasto sin tope.
    const unknown = resolvePricing("claude-modelo-que-no-existe");
    const mostExpensive = Object.values(PRICING).reduce((max, p) =>
      p.output > max.output ? p : max,
    );
    assert.equal(unknown.output, mostExpensive.output);
    assert.equal(unknown.input, mostExpensive.input);
  });

  test("la caché es más barata que el input y la escritura más cara", () => {
    for (const [model, price] of Object.entries(PRICING)) {
      assert.ok(price.cacheRead < price.input, `${model}: la lectura de caché debería ser barata`);
      assert.ok(price.cacheWrite > price.input, `${model}: escribir caché cuesta más que el input`);
      assert.ok(price.output > price.input, `${model}: el output cuesta más que el input`);
    }
  });
});

describe("estimateCost", () => {
  test("un millón de tokens de input cuesta exactamente la tarifa", () => {
    const cost = estimateCost("claude-opus-5", { ...NO_TOKENS, input: 1_000_000 });
    assert.equal(cost, PRICING["claude-opus-5"].input);
  });

  test("suma las cuatro clases de token", () => {
    const price = PRICING["claude-sonnet-5"];
    const cost = estimateCost("claude-sonnet-5", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
    });
    const expected = price.input + price.output + price.cacheRead + price.cacheWrite;
    assert.ok(Math.abs(cost - expected) < 1e-9);
  });

  test("una run sin tokens no cuesta nada", () => {
    assert.equal(estimateCost("claude-opus-5", NO_TOKENS), 0);
  });

  test("la caché sale mucho más barata que el input equivalente", () => {
    const cached = estimateCost("claude-opus-5", { ...NO_TOKENS, cacheRead: 1_000_000 });
    const fresh = estimateCost("claude-opus-5", { ...NO_TOKENS, input: 1_000_000 });
    assert.ok(cached < fresh / 5, "leer de caché debería costar una fracción del input");
  });
});
