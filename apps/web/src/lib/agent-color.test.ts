import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_COLORS,
  agentColor,
  pickAgentColor,
  resolveAgentColor,
} from "@/lib/agent-color";

/**
 * El color es la única pista visual para distinguir agentes de un vistazo en el
 * kanban y en el historial. Que se repita no rompe nada, y por eso se coló:
 * tres agentes salían del mismo verde y nadie se enteró hasta verlo.
 */

describe("pickAgentColor", () => {
  test("sin nadie usando la paleta, el primero", () => {
    assert.equal(pickAgentColor([]), AGENT_COLORS[0]);
  });

  test("no repite mientras queden colores libres", () => {
    const used: string[] = [];
    for (let i = 0; i < AGENT_COLORS.length; i++) used.push(pickAgentColor(used));
    assert.equal(new Set(used).size, AGENT_COLORS.length);
  });

  // Este es el caso de la captura: tres agentes del mismo color. Al añadir el
  // cuarto no puede volver a tocar ese verde habiendo seis sin estrenar.
  test("huye del color que ya se repite", () => {
    const green = AGENT_COLORS[1];
    const next = pickAgentColor([green, green, green]);
    assert.notEqual(next, green);
  });

  test("agotada la paleta reparte la segunda vuelta en vez de amontonar", () => {
    const used = [...AGENT_COLORS, AGENT_COLORS[0]];
    assert.equal(pickAgentColor(used), AGENT_COLORS[1]);
  });

  // Los agentes viejos tienen color null hasta que se les asigne uno; contarlos
  // como si ocupasen un hueco falsearía el reparto.
  test("los nulos y lo que no es de la paleta no cuentan", () => {
    assert.equal(pickAgentColor([null, undefined, "#123456"]), AGENT_COLORS[0]);
  });

  test("da igual cómo venga escrito el hex", () => {
    const first = AGENT_COLORS[0];
    assert.notEqual(pickAgentColor([first.toLowerCase()]), first);
  });
});

describe("agentColor", () => {
  // El motivo de cambiar el hash: sumar códigos de carácter daba el mismo
  // resto para estos tres, que es exactamente lo que se veía en pantalla.
  test("los tres nombres que colisionaban ya no lo hacen", () => {
    const colors = ["Reviewer", "Tester", "Backend"].map(agentColor);
    assert.equal(new Set(colors).size, 3);
  });

  test("la posición de las letras importa: los anagramas se separan", () => {
    assert.notEqual(agentColor("Backend"), agentColor("Bcakend"));
  });

  test("es estable y siempre cae dentro de la paleta", () => {
    assert.equal(agentColor("Frontend"), agentColor("Frontend"));
    for (const name of ["a", "", "Tester", "árbol", "🙂"]) {
      assert.ok((AGENT_COLORS as readonly string[]).includes(agentColor(name)));
    }
  });
});

describe("resolveAgentColor", () => {
  test("el color guardado manda sobre el derivado del nombre", () => {
    assert.equal(resolveAgentColor({ name: "Tester", color: "#123456" }), "#123456");
  });

  test("sin color guardado, cae en el hash del nombre", () => {
    assert.equal(resolveAgentColor({ name: "Tester", color: null }), agentColor("Tester"));
    assert.equal(resolveAgentColor({ name: "Tester" }), agentColor("Tester"));
  });
});
