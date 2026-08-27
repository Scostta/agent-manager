import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { MAX_TOOL_RESULT_CHARS, formatLogLine } from "@/lib/run-log";

/**
 * El primer test de `apps/web`, y va aquí por algo: esto traduce el stream-json
 * del CLI a lo que ves en el visor. Cuando el CLI cambie la forma de un evento
 * no saltará ningún error — simplemente dejarás de ver parte del log, que es la
 * peor manera de enterarte.
 */

const line = (event: unknown): string => JSON.stringify(event);

describe("líneas que no son del protocolo", () => {
  test("lo que no es JSON se enseña tal cual", () => {
    assert.deepEqual(formatLogLine("npm warn deprecated"), {
      text: "npm warn deprecated",
      tone: "text",
    });
  });

  // El stderr del CLI llega por aquí, y un fallo que se pinte del mismo color
  // que el resto se pierde entre cien líneas de log.
  test("si huele a fallo, se pinta como fallo", () => {
    for (const raw of ["Error: ENOENT", "the build FAILED", "Unhandled exception"]) {
      assert.equal(formatLogLine(raw)?.tone, "error", raw);
    }
  });

  test("una línea vacía de protocolo desconocido se descarta", () => {
    assert.equal(formatLogLine(line({ type: "system", subtype: "init" })), null);
  });
});

describe("la petición que escribe el cockpit", () => {
  test("resume con qué se lanzó y deja el prompt debajo", () => {
    const entry = formatLogLine(
      line({
        type: "cockpit",
        subtype: "request",
        model: "claude-opus-5",
        flags: ["--allowedTools", "Read"],
        resumedFrom: null,
        prompt: "Haz la tarea",
      }),
    );

    assert.equal(entry?.tone, "request");
    assert.match(entry!.text, /Lanzada con claude-opus-5/);
    assert.match(entry!.text, /--allowedTools Read/);
    assert.match(entry!.text, /Haz la tarea/);
  });

  test("una continuación dice de qué run viene, en corto", () => {
    const entry = formatLogLine(
      line({
        type: "cockpit",
        subtype: "request",
        model: "claude-opus-5",
        flags: [],
        resumedFrom: "cmtb7erlp000nhh5q7c0fc1dt",
        prompt: "Cambia esto",
      }),
    );

    assert.match(entry!.text, /retomando cmtb7erl/);
    assert.ok(!entry!.text.includes("cmtb7erlp000nhh5q7c0fc1dt"), "el id entero no cabe");
  });

  test("sin flags no deja separadores colgando", () => {
    const entry = formatLogLine(
      line({ type: "cockpit", subtype: "request", model: "m", flags: [], prompt: "p" }),
    );

    assert.equal(entry!.text.split("\n")[0], "Lanzada con m");
  });
});

describe("mensajes del asistente", () => {
  const assistant = (content: unknown[]) => line({ type: "assistant", message: { content } });

  test("el texto se enseña limpio", () => {
    const entry = formatLogLine(assistant([{ type: "text", text: "  Hecho.  " }]));
    assert.deepEqual(entry, { text: "Hecho.", tone: "text" });
  });

  test("el thinking se distingue del texto normal", () => {
    const entry = formatLogLine(assistant([{ type: "thinking", thinking: "a ver…" }]));
    assert.equal(entry?.tone, "thinking");
  });

  test("una herramienta se resume con su argumento principal", () => {
    const entry = formatLogLine(
      assistant([{ type: "tool_use", name: "Bash", input: { command: "node --test" } }]),
    );
    assert.deepEqual(entry, { text: "→ Bash · node --test", tone: "tool" });
  });

  test("del argumento se coge solo la primera línea, y acotada", () => {
    const entry = formatLogLine(
      assistant([
        { type: "tool_use", name: "Bash", input: { command: `${"x".repeat(300)}\nsegunda` } },
      ]),
    );

    assert.ok(!entry!.text.includes("segunda"), "un comando de diez líneas reventaría la línea");
    assert.ok(entry!.text.length < 200);
  });

  test("una herramienta sin argumento reconocible sigue diciendo cuál es", () => {
    const entry = formatLogLine(assistant([{ type: "tool_use", name: "TodoWrite", input: {} }]));
    assert.equal(entry?.text, "→ TodoWrite");
  });

  // El evento trae varios bloques y el color lo marca el más informativo.
  test("con texto y herramienta juntos, manda la herramienta", () => {
    const entry = formatLogLine(
      assistant([
        { type: "text", text: "Voy a mirar el fichero" },
        { type: "tool_use", name: "Read", input: { file_path: "src/app.ts" } },
      ]),
    );

    assert.equal(entry?.tone, "tool");
    assert.match(entry!.text, /Voy a mirar el fichero/);
    assert.match(entry!.text, /→ Read · src\/app\.ts/);
  });

  test("un mensaje sin nada que enseñar se descarta en vez de dejar hueco", () => {
    assert.equal(formatLogLine(assistant([])), null);
    assert.equal(formatLogLine(assistant([{ type: "text", text: "   " }])), null);
    // Los bloques de uso de caché y firmas no pintan nada.
    assert.equal(formatLogLine(assistant([{ type: "redacted_thinking", data: "x" }])), null);
  });
});

describe("resultados de herramienta", () => {
  const toolResult = (block: Record<string, unknown>) =>
    line({ type: "user", message: { content: [{ type: "tool_result", ...block }] } });

  test("el contenido en texto plano se enseña con su flecha", () => {
    const entry = formatLogLine(toolResult({ content: "3 tests, 0 fallos" }));
    assert.deepEqual(entry, { text: "← 3 tests, 0 fallos", tone: "result" });
  });

  test("el contenido en bloques se junta", () => {
    const entry = formatLogLine(
      toolResult({ content: [{ text: "primera" }, { text: "segunda" }] }),
    );
    assert.equal(entry?.text, "← primera\nsegunda");
  });

  /** Un `cat` de un fichero grande se comería la pantalla entera. */
  test("un resultado enorme se corta con puntos suspensivos", () => {
    const entry = formatLogLine(toolResult({ content: "y".repeat(MAX_TOOL_RESULT_CHARS + 50) }));

    assert.ok(entry!.text.endsWith("…"));
    // "← " son dos caracteres, y los puntos suspensivos uno.
    assert.equal(entry!.text.length, MAX_TOOL_RESULT_CHARS + 3);
  });

  test("un resultado justo en el límite no lleva puntos", () => {
    const entry = formatLogLine(toolResult({ content: "y".repeat(MAX_TOOL_RESULT_CHARS) }));
    assert.ok(!entry!.text.endsWith("…"));
  });

  test("un error de herramienta se pinta como error", () => {
    const entry = formatLogLine(toolResult({ content: "command not found", is_error: true }));
    assert.equal(entry?.tone, "error");
  });

  test("lo vacío y lo que no es un tool_result se descartan", () => {
    assert.equal(formatLogLine(toolResult({ content: "   " })), null);
    assert.equal(formatLogLine(toolResult({ content: 42 })), null);
    assert.equal(
      formatLogLine(line({ type: "user", message: { content: [{ type: "text", text: "x" }] } })),
      null,
    );
  });
});

describe("evento final", () => {
  test("el resumen del agente se enseña tal cual", () => {
    const entry = formatLogLine(
      line({ type: "result", subtype: "success", is_error: false, result: "He tocado 3 ficheros" }),
    );
    assert.deepEqual(entry, { text: "He tocado 3 ficheros", tone: "text" });
  });

  test("un fallo se pinta como fallo aunque traiga texto", () => {
    const entry = formatLogLine(
      line({ type: "result", subtype: "error", is_error: true, result: "explotó" }),
    );
    assert.deepEqual(entry, { text: "explotó", tone: "error" });
  });

  // Sin `result` no hay nada que enseñar, pero dejar la línea en blanco haría
  // parecer que la run se cortó a mitad.
  test("sin texto se dice algo igualmente", () => {
    assert.equal(formatLogLine(line({ type: "result", subtype: "success" }))?.text, "Fin");
    assert.equal(
      formatLogLine(line({ type: "result", subtype: "error_max_turns" }))?.text,
      "La run falló",
    );
  });

  test("un subtype que no sea success cuenta como fallo", () => {
    const entry = formatLogLine(
      line({ type: "result", subtype: "error_during_execution", is_error: false, result: "x" }),
    );
    assert.equal(entry?.tone, "error");
  });
});
