import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { PlanError, parsePlan } from "./planner.js";

/**
 * Lo que sale de aquí se guarda como backlog del proyecto sin que nadie más lo
 * mire: un JSON envuelto en prosa o una dependencia hacia adelante fallan en
 * silencio (proyecto sin tareas, o tareas bloqueadas para siempre).
 */
describe("parsePlan", () => {
  test("extrae las tareas de un JSON limpio", () => {
    const tasks = parsePlan(
      '{"tasks":[{"title":"Montar el esqueleto","description":"pnpm init","dependsOn":[]}]}',
    );
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, "Montar el esqueleto");
    assert.deepEqual(tasks[0].dependsOn, []);
  });

  test("tolera prosa y bloques de código alrededor del JSON", () => {
    const raw = [
      "Claro, aquí tienes el plan:",
      "```json",
      '{"tasks":[{"title":"A","description":"","dependsOn":[]},',
      '{"title":"B","description":"","dependsOn":[0]}]}',
      "```",
      "Avísame si quieres más detalle.",
    ].join("\n");

    const tasks = parsePlan(raw);
    assert.deepEqual(
      tasks.map((t) => t.title),
      ["A", "B"],
    );
    assert.deepEqual(tasks[1].dependsOn, [0]);
  });

  test("descarta dependencias hacia adelante y hacia sí misma", () => {
    // Ambas serían un ciclo: la 0 esperaría a la 1, que espera a la 0.
    const tasks = parsePlan(
      '{"tasks":[{"title":"A","dependsOn":[1]},{"title":"B","dependsOn":[1,0]}]}',
    );
    assert.deepEqual(tasks[0].dependsOn, []);
    assert.deepEqual(tasks[1].dependsOn, [0]);
  });

  test("deduplica y ordena las dependencias", () => {
    const tasks = parsePlan(
      '{"tasks":[{"title":"A"},{"title":"B"},{"title":"C","dependsOn":[1,0,1]}]}',
    );
    assert.deepEqual(tasks[2].dependsOn, [0, 1]);
  });

  test("corta a 12 tareas", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `T${i}` }));
    const tasks = parsePlan(JSON.stringify({ tasks: many }));
    assert.equal(tasks.length, 12);
  });

  test("falla si no hay JSON", () => {
    assert.throws(() => parsePlan("No he podido leer el proyecto."), PlanError);
  });

  test("falla si el JSON no tiene la forma esperada", () => {
    assert.throws(() => parsePlan('{"tareas":["hacer cosas"]}'), PlanError);
    assert.throws(() => parsePlan('{"tasks":[]}'), PlanError);
    assert.throws(() => parsePlan('{"tasks":[{"description":"sin título"}]}'), PlanError);
  });
});
