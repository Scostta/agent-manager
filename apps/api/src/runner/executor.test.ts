// Este import va SIEMPRE el primero: monta la SQLite temporal y redirige las
// rutas de config antes de que db.ts abra ninguna conexión.
import { assertUsingTestDb, closeDb, resetDb, tempDir } from "../test/harness.js";

import test, { afterEach, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { config } from "../config.js";
import { bus } from "../bus.js";
import { db } from "../db.js";
import { executeTaskRun, runtime } from "./executor.js";

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Task, TaskRun } from "@prisma/client";

assertUsingTestDb(config.databaseUrl);

const realSpawn = runtime.spawn;

/** Cómo se llamó al CLI: es donde se ve si una run retomó sesión o empezó de cero. */
type SpawnCall = { args: string[]; cwd: string };
let spawnCalls: SpawnCall[] = [];

/**
 * Proceso simulado que escupe stream-json por stdout y termina. No es un mock
 * del parser: el executor lee estas líneas con el mismo readline y las mete por
 * el mismo camino que las del CLI de verdad.
 */
function fakeCli(opts: {
  lines?: unknown[];
  stderr?: string;
  exitCode?: number;
  /** Para simular un spawn que ni siquiera arranca (binario ausente). */
  spawnError?: NodeJS.ErrnoException;
}): typeof runtime.spawn {
  return (((_cmd: string, args: string[], spawnOpts: { cwd: string }) => {
    spawnCalls.push({ args, cwd: spawnOpts.cwd });
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      pid?: number;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    // Windows no asigna PIDs que no sean múltiplos de 4, así que este no puede
    // ser de un proceso real: si algo intentara matarlo, no se lleva a nadie.
    child.pid = 999999;

    if (opts.spawnError) {
      // El executor engancha 'error' justo después del spawn, antes de los
      // awaits, así que aquí basta con el tick siguiente.
      setImmediate(() => child.emit("error", opts.spawnError));
    } else {
      // Entre el spawn y el `child.on("exit")` el executor hace varios updates
      // en BD. Emitir antes perdería el evento y la run se quedaría colgada
      // hasta el timeout, así que esperamos a que haya alguien escuchando.
      child.on("newListener", (event) => {
        if (event !== "exit") return;
        setImmediate(() => {
          for (const line of opts.lines ?? []) {
            child.stdout.write(`${typeof line === "string" ? line : JSON.stringify(line)}\n`);
          }
          if (opts.stderr) child.stderr.write(opts.stderr);
          child.stdout.end();
          child.stderr.end();
          child.emit("exit", opts.exitCode ?? 0, null);
        });
      });
    }

    return child as unknown as ChildProcessWithoutNullStreams;
    // El tipo de `spawn` son seis sobrecargas según los stdio; el executor solo
    // usa la de stdio heredado, así que pasamos por unknown en vez de fingirlas.
  }) as unknown) as typeof runtime.spawn;
}

const ASSISTANT_USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 10,
  cache_creation_input_tokens: 5,
};

async function seedRun(): Promise<{ task: Task; run: TaskRun }> {
  // Estrategia 'copy': el workspace se monta sin depender de git.
  const repoPath = tempDir("repo");
  await fs.writeFile(path.join(repoPath, "README.md"), "# demo\n", "utf8");

  const project = await db.project.create({
    data: { name: "demo", repoPath, workspaceStrategy: "copy" },
  });
  const agent = await db.agent.create({
    data: {
      name: "agente",
      role: "dev",
      model: "claude-sonnet-5",
      systemPrompt: "Haz la tarea.",
      // Sin presupuesto a propósito: el guard mataría el proceso simulado.
      maxBudgetUsd: null,
    },
  });
  const task = await db.task.create({
    data: {
      projectId: project.id,
      title: "Hacer algo",
      description: "Lo que sea",
      status: "in_progress",
      position: 0,
    },
  });
  const run = await db.taskRun.create({
    data: {
      taskId: task.id,
      agentId: agent.id,
      status: "queued",
      workspacePath: "",
      logPath: "",
    },
  });

  return { task, run };
}

beforeEach(async () => {
  spawnCalls = [];
  await resetDb();
});

afterEach(() => {
  runtime.spawn = realSpawn;
});

after(() => closeDb());

describe("executeTaskRun", () => {
  test("una run que termina bien deja la task en review y persiste consumo y log", async () => {
    const { task, run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [
        { type: "system", subtype: "init" },
        { type: "assistant", message: { id: "msg_1", usage: ASSISTANT_USAGE } },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Listo, he tocado README.md",
          total_cost_usd: 0.1234,
          modelUsage: {
            "claude-sonnet-5": {
              inputTokens: 1000,
              outputTokens: 200,
              cacheReadInputTokens: 30,
              cacheCreationInputTokens: 40,
            },
          },
        },
      ],
    });

    await executeTaskRun(run.id);

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.status, "succeeded");
    assert.equal(saved.failureKind, null);
    assert.equal(saved.resultSummary, "Listo, he tocado README.md");
    assert.ok(saved.endedAt, "la run tiene que quedar cerrada");
    assert.equal(saved.pid, null, "el pid se limpia al terminar");

    // El desglose de `modelUsage` manda: incluye subagentes y modelos auxiliares.
    assert.equal(saved.inputTokens, 1000);
    assert.equal(saved.outputTokens, 200);
    assert.equal(saved.cacheReadTokens, 30);
    assert.equal(saved.cacheWriteTokens, 40);
    // total_cost_usd es autoritativo, no la estimación por tarifa.
    assert.equal(saved.costUsd, 0.1234);

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(after.status, "review");

    const log = await fs.readFile(path.join(config.logsRoot, `${run.id}.ndjson`), "utf8");
    const events = log.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.type),
      ["cockpit", "system", "assistant", "result"],
      "el NDJSON guarda una línea por evento, en orden, tras la petición del cockpit",
    );
  });

  test("no cuenta dos veces el usage del mismo mensaje", async () => {
    const { run } = await seedRun();
    // El CLI emite un evento `assistant` por bloque de contenido, todos con el
    // mismo message.id y el mismo usage: sumarlos infla el gasto.
    runtime.spawn = fakeCli({
      lines: [
        { type: "assistant", message: { id: "msg_1", usage: ASSISTANT_USAGE } },
        { type: "assistant", message: { id: "msg_1", usage: ASSISTANT_USAGE } },
        { type: "assistant", message: { id: "msg_2", usage: ASSISTANT_USAGE } },
        // Sin modelUsage ni usage: obliga a usar el acumulado por mensaje.
        { type: "result", subtype: "success", is_error: false, result: "ok" },
      ],
    });

    await executeTaskRun(run.id);

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.inputTokens, 200, "dos mensajes distintos, no tres eventos");
    assert.equal(saved.outputTokens, 100);
    assert.ok(saved.costUsd > 0, "sin total_cost_usd se estima por tarifa");
  });

  test("una run fallida devuelve la task a todo, no la pasa a review", async () => {
    const { task, run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "error", is_error: true, result: "algo explotó" }],
      stderr: "boom\n",
      exitCode: 1,
    });

    await executeTaskRun(run.id);

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.status, "failed");
    assert.equal(saved.failureKind, "error");

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(after.status, "todo");
  });

  test("quedarse sin cuota se marca aparte de un fallo normal", async () => {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [
        {
          type: "result",
          subtype: "error",
          is_error: true,
          result: "You've hit your session limit · resets 3:45pm",
        },
      ],
      exitCode: 1,
    });

    await executeTaskRun(run.id);

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.status, "failed");
    assert.equal(saved.failureKind, "rate_limit", "no es un error de la tarea");
    assert.ok(saved.rateLimitResetAt, "se guarda cuándo vuelve la cuota");
  });

  test("si el binario no existe, el mensaje explica qué hacer y la API sobrevive", async () => {
    const { task, run } = await seedRun();
    const enoent: NodeJS.ErrnoException = new Error("spawn claude ENOENT");
    enoent.code = "ENOENT";
    runtime.spawn = fakeCli({ spawnError: enoent });

    // Que resuelva ya es media prueba: este 'error' llega en el tick siguiente
    // al spawn y sin handler tumbaba el proceso entero de la API.
    await executeTaskRun(run.id);

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.status, "failed");
    assert.match(saved.resultSummary ?? "", /No se encontró el ejecutable/);
    assert.match(saved.resultSummary ?? "", /CLAUDE_CLI/);

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(after.status, "todo");
  });

  test("una línea que no es JSON no rompe el parseo del resto", async () => {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [
        "esto no es json y el CLI a veces lo escupe",
        { type: "assistant", message: { id: "msg_1", usage: ASSISTANT_USAGE } },
        { type: "result", subtype: "success", is_error: false, result: "ok" },
      ],
    });

    await executeTaskRun(run.id);

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.status, "succeeded");
    assert.equal(saved.inputTokens, 100);
  });

  test("respeta que hayas movido la task a mano mientras corría", async () => {
    const { task, run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
    });
    // El usuario la saca de 'in_progress' antes de que termine la run.
    await db.task.update({ where: { id: task.id }, data: { status: "done" } });

    await executeTaskRun(run.id);

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(after.status, "done", "solo se toca la task si sigue en in_progress");
  });
});

describe("continuar una sesión", () => {
  const SESSION = "sess_abc123";

  /** Lo que se le pasó a `-p`: el prompt con el que arrancó esa ejecución. */
  function promptOf(call: SpawnCall): string {
    return call.args[call.args.indexOf("-p") + 1];
  }

  function resumeOf(call: SpawnCall): string | null {
    const at = call.args.indexOf("--resume");
    return at === -1 ? null : call.args[at + 1];
  }

  /** Una run terminada bien, con sesión guardada y su workspace en disco. */
  async function seedFinishedRun(): Promise<TaskRun> {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [
        { type: "system", subtype: "init", session_id: SESSION },
        { type: "result", subtype: "success", is_error: false, result: "hecho" },
      ],
    });
    await executeTaskRun(run.id);
    return db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
  }

  test("guarda el session_id que anuncia el CLI", async () => {
    const saved = await seedFinishedRun();
    assert.equal(saved.sessionId, SESSION, "sin esto no hay nada que retomar");
  });

  test("se queda con el primer session_id, aunque el CLI lo repita en cada evento", async () => {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [
        { type: "system", subtype: "init", session_id: SESSION },
        { type: "assistant", session_id: SESSION, message: { id: "msg_1", usage: ASSISTANT_USAGE } },
        { type: "result", subtype: "success", is_error: false, result: "ok", session_id: SESSION },
      ],
    });

    await executeTaskRun(run.id);

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.sessionId, SESSION);
  });

  test("una run que muere antes del init se queda sin sesión", async () => {
    const { run } = await seedRun();
    // Cuota agotada de entrada: el CLI ni llega a abrir conversación.
    runtime.spawn = fakeCli({
      lines: [
        {
          type: "result",
          subtype: "error",
          is_error: true,
          result: "You've hit your session limit · resets 3:45pm",
        },
      ],
      exitCode: 1,
    });

    await executeTaskRun(run.id);

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.sessionId, null, "sin session_id no se puede fingir que la hay");
  });

  test("una continuación retoma la sesión del padre en su mismo workspace", async () => {
    const parent = await seedFinishedRun();
    spawnCalls = [];

    const child = await db.taskRun.create({
      data: {
        taskId: parent.taskId,
        agentId: parent.agentId,
        status: "queued",
        workspacePath: "",
        logPath: "",
        resumedFromId: parent.id,
        followUpPrompt: "Extrae la validación a su propio módulo.",
      },
    });

    runtime.spawn = fakeCli({
      lines: [
        { type: "system", subtype: "init", session_id: "sess_segunda_vuelta" },
        { type: "result", subtype: "success", is_error: false, result: "hecho" },
      ],
    });
    await executeTaskRun(child.id);

    assert.equal(spawnCalls.length, 1);
    const [call] = spawnCalls;
    assert.equal(resumeOf(call), SESSION, "retoma la sesión del padre");
    assert.equal(
      promptOf(call),
      "Extrae la validación a su propio módulo.",
      "solo se le manda lo que falta: el contexto ya está en la sesión",
    );
    assert.ok(
      !promptOf(call).includes("Haz la tarea."),
      "repetir el systemPrompt sería pagar otra vez lo que ya sabe",
    );
    assert.equal(
      call.cwd,
      parent.workspacePath,
      "el CLI indexa las sesiones por directorio: fuera de él no la encuentra",
    );

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: child.id } });
    assert.equal(saved.workspacePath, parent.workspacePath);
    assert.equal(
      saved.sessionId,
      "sess_segunda_vuelta",
      "la siguiente vuelta retoma desde la sesión que devolvió esta, no desde la del padre",
    );
  });

  test("una continuación que falla no borra el workspace del padre", async () => {
    const parent = await seedFinishedRun();

    const child = await db.taskRun.create({
      data: {
        taskId: parent.taskId,
        agentId: parent.agentId,
        status: "queued",
        workspacePath: "",
        logPath: "",
        resumedFromId: parent.id,
        followUpPrompt: "Cambia esto",
      },
    });

    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "error", is_error: true, result: "explotó" }],
      exitCode: 1,
    });
    await executeTaskRun(child.id);

    assert.equal(
      (await db.taskRun.findUniqueOrThrow({ where: { id: child.id } })).status,
      "failed",
    );
    await fs.access(parent.workspacePath); // lanza si la limpieza se lo llevó
  });

  test("quedarse sin cuota conserva el workspace; un fallo normal no", async () => {
    const cortada = await seedRun();
    runtime.spawn = fakeCli({
      lines: [
        { type: "system", subtype: "init", session_id: SESSION },
        {
          type: "result",
          subtype: "error",
          is_error: true,
          result: "You've hit your session limit · resets 3:45pm",
        },
      ],
      exitCode: 1,
    });
    await executeTaskRun(cortada.run.id);

    const sinCuota = await db.taskRun.findUniqueOrThrow({ where: { id: cortada.run.id } });
    assert.equal(sinCuota.failureKind, "rate_limit");
    // Es lo que el reintento necesita para retomar ahí mismo en vez de empezar
    // de cero — y lo que el agente ya había hecho antes del corte.
    await fs.access(sinCuota.workspacePath);

    const rota = await seedRun();
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "error", is_error: true, result: "explotó" }],
      exitCode: 1,
    });
    await executeTaskRun(rota.run.id);

    const fallida = await db.taskRun.findUniqueOrThrow({ where: { id: rota.run.id } });
    assert.equal(fallida.failureKind, "error");
    await assert.rejects(
      () => fs.access(fallida.workspacePath),
      "un fallo normal sí se limpia: no hay nada que retomar",
    );
  });
});

describe("herramientas del agente", () => {
  function flagOf(args: string[], flag: string): string | null {
    const at = args.indexOf(flag);
    return at === -1 ? null : args[at + 1];
  }

  test("sin listas, el CLI sale sin flags de herramientas", async () => {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
    });

    await executeTaskRun(run.id);

    const [call] = spawnCalls;
    assert.equal(flagOf(call.args, "--allowedTools"), null);
    assert.equal(flagOf(call.args, "--disallowedTools"), null);
  });

  test("un agente de solo lectura sale con su lista de permitidas", async () => {
    const { run } = await seedRun();
    await db.agent.update({
      where: { id: run.agentId },
      data: { allowedTools: JSON.stringify(["Read", "Glob", "Grep"]) },
    });
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
    });

    await executeTaskRun(run.id);

    assert.equal(flagOf(spawnCalls[0].args, "--allowedTools"), "Read,Glob,Grep");
  });

  test("la restricción también viaja al retomar una sesión", async () => {
    const { run } = await seedRun();
    await db.agent.update({
      where: { id: run.agentId },
      data: { disallowedTools: JSON.stringify(["Bash"]) },
    });
    runtime.spawn = fakeCli({
      lines: [
        { type: "system", subtype: "init", session_id: "sess_x" },
        { type: "result", subtype: "success", is_error: false, result: "ok" },
      ],
    });
    await executeTaskRun(run.id);
    spawnCalls = [];

    const child = await db.taskRun.create({
      data: {
        taskId: run.taskId,
        agentId: run.agentId,
        status: "queued",
        workspacePath: "",
        logPath: "",
        resumedFromId: run.id,
        followUpPrompt: "Cambia esto",
      },
    });
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
    });
    await executeTaskRun(child.id);

    // Una continuación que perdiera la restricción sería la puerta de atrás:
    // basta con retomar para recuperar bash.
    assert.equal(flagOf(spawnCalls[0].args, "--disallowedTools"), "Bash");
  });
});

describe("registro de lo que se le pidió al CLI", () => {
  /** La primera línea del NDJSON, que la escribe el cockpit y no el CLI. */
  async function requestLine(runId: string): Promise<any> {
    const log = await fs.readFile(path.join(config.logsRoot, `${runId}.ndjson`), "utf8");
    return JSON.parse(log.trim().split("\n")[0]);
  }

  test("el prompt queda en el log, que antes solo guardaba la respuesta", async () => {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
    });

    await executeTaskRun(run.id);

    const request = await requestLine(run.id);
    assert.equal(request.type, "cockpit");
    assert.equal(request.subtype, "request");
    assert.equal(request.model, "claude-sonnet-5");
    assert.match(request.prompt, /Haz la tarea\./, "lleva el systemPrompt del agente");
    assert.match(request.prompt, /Hacer algo/, "y la task que se le asignó");
    assert.equal(request.resumedFrom, null);
  });

  test("guarda los flags, pero no repite el prompt dentro de ellos", async () => {
    const { run } = await seedRun();
    await db.agent.update({
      where: { id: run.agentId },
      data: { allowedTools: JSON.stringify(["Read"]) },
    });
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
    });

    await executeTaskRun(run.id);

    const request = await requestLine(run.id);
    assert.ok(request.flags.includes("--allowedTools"), "se ve con qué permisos salió");
    assert.ok(request.flags.includes("Read"));
    assert.ok(!request.flags.includes("-p"), "el prompt va aparte");
    assert.ok(
      !request.flags.some((flag: string) => flag.includes("Haz la tarea")),
      "duplicar el prompt en flags hace el log ilegible",
    );
  });

  test("una continuación registra su prompt corto y de quién viene", async () => {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [
        { type: "system", subtype: "init", session_id: "sess_x" },
        { type: "result", subtype: "success", is_error: false, result: "ok" },
      ],
    });
    await executeTaskRun(run.id);

    const child = await db.taskRun.create({
      data: {
        taskId: run.taskId,
        agentId: run.agentId,
        status: "queued",
        workspacePath: "",
        logPath: "",
        resumedFromId: run.id,
        followUpPrompt: "Extrae la validación.",
      },
    });
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
    });
    await executeTaskRun(child.id);

    const request = await requestLine(child.id);
    assert.equal(request.prompt, "Extrae la validación.");
    assert.equal(request.resumedFrom, run.id);
    assert.ok(request.flags.includes("--resume"));
  });

  test("va la primera, antes que nada de lo que devuelva el CLI", async () => {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [
        { type: "system", subtype: "init" },
        { type: "result", subtype: "success", is_error: false, result: "ok" },
      ],
    });

    await executeTaskRun(run.id);

    const log = await fs.readFile(path.join(config.logsRoot, `${run.id}.ndjson`), "utf8");
    const types = log.trim().split("\n").map((line) => JSON.parse(line).type);
    assert.deepEqual(types, ["cockpit", "system", "result"]);
  });

  test("también se registra la run que ni siquiera arranca", async () => {
    const { run } = await seedRun();
    // Sin esto, el caso donde más falta hace saber qué se pidió —el que no
    // deja ni una línea de salida— seguiría sin dejar rastro.
    runtime.spawn = fakeCli({
      spawnError: Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }),
    });

    await executeTaskRun(run.id);

    const request = await requestLine(run.id);
    assert.equal(request.subtype, "request");
  });
});

describe("aviso de run terminada", () => {
  /** Recoge los `run_finished` que se emitan mientras corre `fn`. */
  async function finishedEvents(fn: () => Promise<void>): Promise<any[]> {
    const seen: any[] = [];
    const handler = (event: any) => {
      if (event?.type === "run_finished") seen.push(event);
    };
    bus.on("board", handler);
    try {
      await fn();
    } finally {
      bus.off("board", handler);
    }
    return seen;
  }

  test("lleva lo justo para pintar el aviso sin pedir nada más", async () => {
    const { task, run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
    });

    const [event, ...resto] = await finishedEvents(() => executeTaskRun(run.id));

    assert.equal(resto.length, 0, "un aviso por run, no uno por evento");
    assert.equal(event.runId, run.id);
    assert.equal(event.taskId, task.id);
    assert.equal(event.status, "succeeded");
    // Sin estos dos, el navegador tendría que ir a buscarlos para el aviso.
    assert.equal(event.taskTitle, "Hacer algo");
    assert.equal(event.agentName, "agente");
  });

  test("una run fallida también avisa", async () => {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({
      lines: [{ type: "result", subtype: "error", is_error: true, result: "explotó" }],
      exitCode: 1,
    });

    const [event] = await finishedEvents(() => executeTaskRun(run.id));

    assert.equal(event.status, "failed");
  });

  test("la que ni arranca es la que más falta hace avisar", async () => {
    const { run } = await seedRun();
    // Si el binario no está, no hay log, no hay stream y la task vuelve a
    // 'todo' sin que nadie se entere. Es el silencio más caro.
    runtime.spawn = fakeCli({
      spawnError: Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }),
    });

    const [event] = await finishedEvents(() => executeTaskRun(run.id));

    assert.equal(event?.status, "failed");
    assert.equal(event?.runId, run.id);
  });
});

describe("CLAUDE.md que llega a la run", () => {
  const OK = [{ type: "result", subtype: "success", is_error: false, result: "ok" }];

  async function workspaceClaudeMd(runId: string): Promise<string> {
    const run = await db.taskRun.findUniqueOrThrow({ where: { id: runId } });
    return fs.readFile(path.join(run.workspacePath, "CLAUDE.md"), "utf8");
  }

  /**
   * El global no cuelga de ninguna FK, así que el executor tiene que ir a
   * buscarlo. Sin esto se guardaba, se editaba en la UI con la etiqueta
   * "Global"… y no lo veía ningún agente.
   */
  test("el global se inyecta aunque el proyecto no tenga el suyo", async () => {
    const { run } = await seedRun();
    await db.claudeMd.create({
      data: { scope: "global", content: "REGLA-GLOBAL: no toques el .env" },
    });
    runtime.spawn = fakeCli({ lines: OK });

    await executeTaskRun(run.id);

    assert.match(await workspaceClaudeMd(run.id), /REGLA-GLOBAL/);
  });

  test("global y proyecto conviven, en ese orden", async () => {
    const { run } = await seedRun();
    const projectMd = await db.claudeMd.create({
      data: { scope: "project", content: "REGLA-DEL-PROYECTO" },
    });
    const saved = await db.taskRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { task: true },
    });
    await db.project.update({
      where: { id: saved.task.projectId },
      data: { claudeMdId: projectMd.id },
    });
    await db.claudeMd.create({ data: { scope: "global", content: "REGLA-GLOBAL" } });
    runtime.spawn = fakeCli({ lines: OK });

    await executeTaskRun(run.id);

    const written = await workspaceClaudeMd(run.id);
    assert.match(written, /REGLA-GLOBAL/);
    assert.match(written, /REGLA-DEL-PROYECTO/);
    assert.ok(
      written.indexOf("REGLA-GLOBAL") < written.indexOf("REGLA-DEL-PROYECTO"),
      "lo del proyecto va después para poder matizar lo global",
    );
  });

  test("sin ningún CLAUDE.md del cockpit no se inventa uno", async () => {
    const { run } = await seedRun();
    runtime.spawn = fakeCli({ lines: OK });

    await executeTaskRun(run.id);

    const saved = await db.taskRun.findUniqueOrThrow({ where: { id: run.id } });
    await assert.rejects(() => fs.access(path.join(saved.workspacePath, "CLAUDE.md")));
  });
});
