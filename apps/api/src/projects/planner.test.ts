// El arnés va el primero: manda los logs del planificador al temporal en vez
// de a LOGS_ROOT de verdad, y fija la BD temporal para lo que arrastra el
// import del executor.
import { LOGS_DIR, SCRATCH_DIR, closeDb } from "../test/harness.js";

import test, { after, afterEach, describe } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";

import { runtime } from "../runner/executor.js";
import { PlanError, cancelPlan, parsePlan, planInitialTasks } from "./planner.js";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

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

/* ── planInitialTasks de extremo a extremo ────────────────────────────────── */

const realSpawn = runtime.spawn;

/** CLI simulado. `hold` deja el proceso vivo hasta que se le suelta. */
function fakeCli(opts: {
  lines?: unknown[];
  stderr?: string;
  exitCode?: number;
  spawnError?: NodeJS.ErrnoException;
  hold?: { release: () => void };
}): typeof runtime.spawn {
  return (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      pid?: number;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 999999;

    const emit = (): void => {
      for (const line of opts.lines ?? []) {
        child.stdout.write(`${typeof line === "string" ? line : JSON.stringify(line)}\n`);
      }
      if (opts.stderr) child.stderr.write(opts.stderr);
      child.stdout.end();
      child.stderr.end();
      child.emit("exit", opts.exitCode ?? 0, null);
    };

    if (opts.spawnError) {
      setImmediate(() => child.emit("error", opts.spawnError));
    } else if (opts.hold) {
      opts.hold.release = emit;
    } else {
      child.on("newListener", (event) => {
        if (event === "exit") setImmediate(emit);
      });
    }

    return child as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof runtime.spawn;
}

const PLAN_JSON = JSON.stringify({
  tasks: [
    { title: "Montar el esqueleto", description: "package.json y carpetas", dependsOn: [] },
    { title: "Escribir el parser", description: "src/parse.js", dependsOn: [0] },
  ],
});

function planInput(projectId: string) {
  return {
    projectId,
    name: "csv2json",
    description: "Una CLI que convierte CSV a JSON",
    repoPath: SCRATCH_DIR,
    claudeMdContent: null,
  };
}

afterEach(() => {
  runtime.spawn = realSpawn;
});

after(() => closeDb());

describe("planInitialTasks", () => {
  test("devuelve el backlog, el consumo y deja el NDJSON en LOGS_ROOT", async () => {
    runtime.spawn = fakeCli({
      lines: [
        { type: "system", subtype: "init" },
        {
          type: "assistant",
          message: {
            id: "msg_1",
            usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 0 },
          },
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: `Aquí tienes el plan:\n\`\`\`json\n${PLAN_JSON}\n\`\`\``,
          total_cost_usd: 0.042,
        },
      ],
    });

    const plan = await planInitialTasks(planInput("proyecto-1"));

    assert.deepEqual(
      plan.tasks.map((task) => task.title),
      ["Montar el esqueleto", "Escribir el parser"],
    );
    assert.deepEqual(plan.tasks[1].dependsOn, [0]);
    assert.equal(plan.costUsd, 0.042);
    assert.equal(plan.tokens.input, 900);

    // El consumo del planificador no entra en el dashboard: el log es lo único
    // que queda para auditarlo.
    const log = await fs.readFile(path.join(LOGS_DIR, "plan-proyecto-1.ndjson"), "utf8");
    assert.equal(log.trim().split("\n").length, 3);
  });

  test("si el CLI termina mal, el error lleva lo que dijo por stderr", async () => {
    runtime.spawn = fakeCli({ stderr: "credenciales caducadas", exitCode: 1 });

    await assert.rejects(() => planInitialTasks(planInput("proyecto-2")), (err: unknown) => {
      assert.ok(err instanceof PlanError);
      assert.match(err.message, /credenciales caducadas/);
      return true;
    });
  });

  test("si el binario no existe lo dice claro, sin traza cruda", async () => {
    const enoent: NodeJS.ErrnoException = new Error("spawn claude ENOENT");
    enoent.code = "ENOENT";
    runtime.spawn = fakeCli({ spawnError: enoent });

    await assert.rejects(() => planInitialTasks(planInput("proyecto-3")), (err: unknown) => {
      assert.ok(err instanceof PlanError);
      assert.match(err.message, /No se encontró el binario/);
      return true;
    });
  });

  test("una respuesta sin JSON no se cuela como backlog vacío", async () => {
    runtime.spawn = fakeCli({
      lines: [
        { type: "result", subtype: "success", is_error: false, result: "No he podido leerlo." },
      ],
    });

    await assert.rejects(() => planInitialTasks(planInput("proyecto-4")), PlanError);
  });

  test("no deja lanzar dos planificaciones a la vez sobre el mismo proyecto", async () => {
    const hold = { release: () => {} };
    runtime.spawn = fakeCli({
      hold,
      lines: [{ type: "result", subtype: "success", is_error: false, result: PLAN_JSON }],
    });

    const primera = planInitialTasks(planInput("proyecto-5"));
    // Le damos tiempo a registrarse como activa antes de pedir la segunda.
    await new Promise((resolve) => setTimeout(resolve, 50));

    await assert.rejects(() => planInitialTasks(planInput("proyecto-5")), (err: unknown) => {
      assert.ok(err instanceof PlanError);
      assert.match(err.message, /Ya hay una planificación/);
      return true;
    });

    hold.release();
    assert.equal((await primera).tasks.length, 2);
  });

  test("cancelar corta la planificación en marcha", async () => {
    const hold = { release: () => {} };
    runtime.spawn = fakeCli({ hold, exitCode: 1 });

    const corriendo = planInitialTasks(planInput("proyecto-6"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(cancelPlan("proyecto-6"), true);
    hold.release();

    await assert.rejects(() => corriendo, (err: unknown) => {
      assert.ok(err instanceof PlanError);
      assert.match(err.message, /cancelada/);
      return true;
    });
  });
});
