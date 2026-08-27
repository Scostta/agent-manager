import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { describeToolPolicy, parseToolList, toolArgs } from "./tools.js";

/**
 * Lógica pura: qué flags acaba recibiendo el CLI según lo que tenga guardado el
 * agente. Es el sitio donde un fallo se traduce en un agente que puede ejecutar
 * bash cuando no debía, o en uno que no puede hacer nada.
 */

describe("parseToolList", () => {
  test("lee la lista guardada como JSON string", () => {
    assert.deepEqual(parseToolList('["Read","Glob"]'), ["Read", "Glob"]);
  });

  test("null y vacío son 'sin restricción'", () => {
    assert.deepEqual(parseToolList(null), []);
    assert.deepEqual(parseToolList(""), []);
    assert.deepEqual(parseToolList("[]"), []);
  });

  // Editar la BD a mano, una migración a medias: nada de esto justifica tumbar
  // una run. Sin lista se corre como se corría antes de que esto existiera.
  test("un JSON roto se ignora en vez de reventar la run", () => {
    assert.deepEqual(parseToolList("{no es json"), []);
    assert.deepEqual(parseToolList('"Read"'), [], "un string suelto no es una lista");
    assert.deepEqual(parseToolList('["Read", 42, null, "  "]'), ["Read"]);
  });
});

describe("toolArgs", () => {
  test("sin listas no añade ningún flag", () => {
    assert.deepEqual(toolArgs({ allowedTools: null, disallowedTools: null }), []);
  });

  /**
   * Lo importante de este caso: `--allowedTools` con la lista vacía no
   * significa "todas", significa "ninguna". Pasarlo dejaría al agente mirando
   * el repo sin poder tocarlo, y el fallo se vería como un agente tonto, no
   * como un bug de permisos.
   */
  test("una lista vacía no se traduce en un flag vacío", () => {
    assert.deepEqual(toolArgs({ allowedTools: "[]", disallowedTools: "[]" }), []);
  });

  test("las permitidas van separadas por comas en un solo argumento", () => {
    assert.deepEqual(
      toolArgs({ allowedTools: '["Read","Glob","Grep"]', disallowedTools: null }),
      ["--allowedTools", "Read,Glob,Grep"],
    );
  });

  test("las prohibidas cubren el caso de 'todo menos X'", () => {
    assert.deepEqual(
      toolArgs({ allowedTools: null, disallowedTools: '["Bash"]' }),
      ["--disallowedTools", "Bash"],
    );
  });

  test("se pueden combinar las dos", () => {
    assert.deepEqual(
      toolArgs({ allowedTools: '["Read","Bash"]', disallowedTools: '["Bash"]' }),
      ["--allowedTools", "Read,Bash", "--disallowedTools", "Bash"],
    );
  });

  // Un patrón lleva espacios y paréntesis. Va en un único argv, así que llega
  // entero: si se partiera, el CLI recibiría "Bash(git" y "*)".
  test("un patrón con espacios viaja en un solo argumento", () => {
    const args = toolArgs({ allowedTools: '["Bash(git *)","Read"]', disallowedTools: null });
    assert.deepEqual(args, ["--allowedTools", "Bash(git *),Read"]);
    assert.equal(args.length, 2, "el patrón no se parte en varios argv");
  });
});

describe("describeToolPolicy", () => {
  test("dice sin rodeos cuando no hay restricción", () => {
    assert.equal(describeToolPolicy({ allowedTools: null, disallowedTools: null }), "sin restricción");
  });

  test("resume las dos listas", () => {
    assert.equal(
      describeToolPolicy({ allowedTools: '["Read","Glob"]', disallowedTools: '["Bash"]' }),
      "solo Read, Glob · sin Bash",
    );
  });
});
