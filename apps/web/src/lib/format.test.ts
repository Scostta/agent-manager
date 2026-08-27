import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { describeToolPolicy, sameTools, splitTools } from "@/lib/format";

/**
 * Lo que el editor de agentes usa para traducir entre las dos listas escritas a
 * mano y lo que se manda a la API. Un fallo aquí no da error: te deja creyendo
 * que un agente está restringido cuando no lo está.
 */

describe("splitTools", () => {
  test("separa por comas y limpia los espacios", () => {
    assert.deepEqual(splitTools(" Read , Glob,Grep "), ["Read", "Glob", "Grep"]);
  });

  // Vacío significa "sin restricción", nunca "ninguna herramienta". Devolver un
  // array con un hueco haría que la API guardase una lista de una entrada vacía.
  test("lo vacío no genera entradas fantasma", () => {
    assert.deepEqual(splitTools(""), []);
    assert.deepEqual(splitTools("   "), []);
    assert.deepEqual(splitTools("Read,,Glob"), ["Read", "Glob"]);
    assert.deepEqual(splitTools("Read,"), ["Read"]);
  });

  test("un patrón del CLI sobrevive entero, paréntesis y espacios incluidos", () => {
    assert.deepEqual(splitTools("Bash(git *), Read"), ["Bash(git *)", "Read"]);
  });
});

describe("sameTools", () => {
  test("el formato no cuenta, solo la lista", () => {
    assert.ok(sameTools("Read, Glob", "Read,Glob"));
    assert.ok(sameTools("  Read  ", "Read"));
    assert.ok(sameTools("", "   "));
  });

  test("el orden sí cuenta, y lo que falta también", () => {
    assert.ok(!sameTools("Read, Glob", "Glob, Read"));
    assert.ok(!sameTools("Read", "Read, Glob"));
    assert.ok(!sameTools("Read", ""));
  });
});

describe("describeToolPolicy", () => {
  test("sin listas lo dice sin rodeos", () => {
    assert.equal(
      describeToolPolicy({ allowedTools: [], disallowedTools: [] }),
      "sin restricción",
    );
  });

  test("resume cada lista y las dos juntas", () => {
    assert.equal(
      describeToolPolicy({ allowedTools: ["Read", "Glob"], disallowedTools: [] }),
      "solo Read, Glob",
    );
    assert.equal(
      describeToolPolicy({ allowedTools: [], disallowedTools: ["Bash"] }),
      "sin Bash",
    );
    assert.equal(
      describeToolPolicy({ allowedTools: ["Read"], disallowedTools: ["Bash"] }),
      "solo Read · sin Bash",
    );
  });
});
