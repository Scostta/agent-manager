import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { detectRateLimit, describeRateLimit, parseResetTime } from "./rateLimit.js";

/** Martes 25/08/2026 a las 10:00, hora local. */
const NOW = new Date("2026-08-25T10:00:00");

function resultEvent(text: string, extra: Record<string, unknown> = {}) {
  return { type: "result", subtype: "error", is_error: true, result: text, ...extra };
}

describe("parseResetTime", () => {
  test("una hora de hoy que aún no ha pasado se queda hoy", () => {
    const reset = parseResetTime("3:45pm", NOW);
    assert.equal(reset?.getDate(), 25);
    assert.equal(reset?.getHours(), 15);
    assert.equal(reset?.getMinutes(), 45);
  });

  test("una hora que ya pasó salta al día siguiente", () => {
    // Si no, programaríamos el reintento en el pasado y saldría de inmediato.
    const reset = parseResetTime("9:30am", NOW);
    assert.equal(reset?.getDate(), 26);
    assert.equal(reset?.getHours(), 9);
  });

  test("12am es medianoche y 12pm es mediodía", () => {
    assert.equal(parseResetTime("12:00am", NOW)?.getHours(), 0);
    assert.equal(parseResetTime("12:00pm", NOW)?.getHours(), 12);
  });

  test("con día de la semana busca la próxima ocurrencia", () => {
    const reset = parseResetTime("Mon 12:00am", NOW);
    assert.equal(reset?.getDay(), 1);
    assert.equal(reset?.getDate(), 31);
    assert.equal(reset?.getHours(), 0);
  });

  test("el mismo día de la semana a una hora ya pasada se va a la semana siguiente", () => {
    const reset = parseResetTime("Tue 8:00am", NOW);
    assert.equal(reset?.getDate(), 1);
    assert.equal(reset?.getMonth(), 8);
  });

  test("lo que no entiende devuelve null, no una fecha inventada", () => {
    for (const raw of ["cuando sea", "", "25:00", "lunes por la mañana", "3:45xm"]) {
      assert.equal(parseResetTime(raw, NOW), null, `debería rechazar ${JSON.stringify(raw)}`);
    }
  });
});

describe("detectRateLimit", () => {
  test("reconoce los cuatro mensajes que documenta Anthropic", () => {
    const cases = [
      ["You've hit your session limit · resets 3:45pm", "session"],
      ["You've hit your weekly limit · resets Mon 12:00am", "weekly"],
      ["You've hit your Opus limit · resets 3:45pm", "opus"],
      ["You've hit your Sonnet limit · resets 3:45pm", "sonnet"],
    ] as const;

    for (const [message, scope] of cases) {
      const hit = detectRateLimit(resultEvent(message), "", NOW);
      assert.equal(hit?.scope, scope, message);
      assert.ok(hit?.resetsAt instanceof Date, `${message} debería traer hora`);
    }
  });

  test("un 429 sin mensaje reconocible cuenta como cuota, pero sin hora", () => {
    const hit = detectRateLimit({ type: "result", api_error_status: 429 }, "", NOW);
    assert.equal(hit?.scope, "plan");
    assert.equal(hit?.resetsAt, null);
  });

  test("también lo pilla si el aviso salió por stderr", () => {
    const hit = detectRateLimit(
      { type: "result" },
      "ruido\nYou've hit your session limit · resets 11:15am\n",
      NOW,
    );
    assert.equal(hit?.scope, "session");
    assert.equal(hit?.resetsAt?.getHours(), 11);
  });

  test("un mensaje sin hora de reset no impide detectar la cuota", () => {
    const hit = detectRateLimit(resultEvent("You've hit your session limit"), "", NOW);
    assert.equal(hit?.scope, "session");
    assert.equal(hit?.resetsAt, null);
  });

  // Marcar como "sin cuota" una run que solo falló sería peor que no detectarlo:
  // la UI ofrecería esperar a un reset que no existe.
  test("no da falsos positivos en runs normales", () => {
    assert.equal(detectRateLimit(resultEvent("Listo", { api_error_status: null }), "", NOW), null);
    assert.equal(detectRateLimit({ type: "result", result: "OK" }, "", NOW), null);
    assert.equal(
      detectRateLimit({ type: "result" }, "npm warn: rate limit of the registry", NOW),
      null,
    );
  });
});

describe("describeRateLimit", () => {
  test("traduce el ámbito y conserva la hora tal cual la dio el CLI", () => {
    const text = describeRateLimit({
      scope: "session",
      resetsAtText: "3:45pm",
      resetsAt: new Date(),
    });
    assert.match(text, /límite de sesión/);
    assert.match(text, /3:45pm/);
  });

  test("sin hora no promete una", () => {
    const text = describeRateLimit({ scope: "weekly", resetsAtText: null, resetsAt: null });
    assert.match(text, /límite semanal/);
    assert.doesNotMatch(text, /a las/);
  });
});
