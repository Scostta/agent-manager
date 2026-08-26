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
import { db } from "../db.js";
import { executeTaskRun, runtime } from "./executor.js";

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Task, TaskRun } from "@prisma/client";

assertUsingTestDb(config.databaseUrl);

const realSpawn = runtime.spawn;

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
  return (() => {
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
  }) as unknown as typeof runtime.spawn;
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

beforeEach(() => resetDb());

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
      ["system", "assistant", "result"],
      "el NDJSON guarda una línea por evento, en orden",
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
