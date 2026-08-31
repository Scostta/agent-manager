import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  describeToolPolicy,
  sameTools,
  slugifySkillName,
  slugifySkillNameDraft,
  splitTools,
} from "@/lib/format";

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

describe("slugifySkillName", () => {
  test("lo que ya es válido se queda igual", () => {
    assert.equal(slugifySkillName("revisar-migraciones"), "revisar-migraciones");
  });

  test("mayúsculas y espacios se normalizan", () => {
    assert.equal(slugifySkillName("Revisar Migraciones"), "revisar-migraciones");
  });

  // Borrar el acento en vez de transliterarlo dejaría "migracin".
  test("los acentos se transliteran, no se pierden", () => {
    assert.equal(slugifySkillName("Migración SQL"), "migracion-sql");
    assert.equal(slugifySkillName("diseño ágil"), "diseno-agil");
  });

  test("los separadores no se acumulan ni sobran en los bordes", () => {
    assert.equal(slugifySkillName("  a // b  "), "a-b");
    assert.equal(slugifySkillName("---x---"), "x");
    assert.equal(slugifySkillName("a__b..c"), "a-b-c");
  });

  // Lo que la guarda del servidor rechaza por escribir fuera del workspace.
  test("una ruta deja de serlo", () => {
    assert.equal(slugifySkillName("../fuera"), "fuera");
    assert.equal(slugifySkillName("C:\\tmp\\x"), "c-tmp-x");
  });

  test("recorta a 64 sin dejar un guion colgando al final", () => {
    const long = slugifySkillName("a".repeat(70));
    assert.equal(long.length, 64);
    const cut = slugifySkillName(`${"a".repeat(64)} b`);
    assert.ok(!cut.endsWith("-"));
  });

  test("lo que no deja nada aprovechable da cadena vacía", () => {
    assert.equal(slugifySkillName("///"), "");
    assert.equal(slugifySkillName(""), "");
  });
});

describe("slugifySkillNameDraft", () => {
  /** Simula teclear carácter a carácter, que es como lo usa el modal. */
  function typing(text: string): string {
    let value = "";
    for (const ch of text) value = slugifySkillNameDraft(value + ch);
    return slugifySkillName(value);
  }

  // El bug que se vio en pantalla: salía "revisarmigracionsql".
  test("tecleado letra a letra conserva los separadores", () => {
    assert.equal(typing("Revisar Migración SQL"), "revisar-migracion-sql");
    assert.equal(typing("Backend API v2"), "backend-api-v2");
  });

  test("mantiene el guion final para que la siguiente letra no se pegue", () => {
    assert.equal(slugifySkillNameDraft("revisar "), "revisar-");
    assert.equal(slugifySkillNameDraft("revisar-"), "revisar-");
  });

  test("no deja que el nombre empiece por guion", () => {
    assert.equal(slugifySkillNameDraft(" x"), "x");
    assert.equal(slugifySkillNameDraft("--x"), "x");
  });

  test("al enviar, el guion suelto del final se va", () => {
    assert.equal(slugifySkillName(slugifySkillNameDraft("revisar ")), "revisar");
  });
});
