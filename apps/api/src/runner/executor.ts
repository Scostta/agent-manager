import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { db } from "../db.js";
import { bus } from "../bus.js";
import { config } from "../config.js";
import { estimateCost, type TokenCounts } from "./pricing.js";
import {
  setupWorkspace,
  injectWorkspaceResources,
  cleanupWorkspace,
} from "./workspace.js";
import { killProcessTree, spawnOptions } from "../lib/process.js";
import { RESUME_AFTER_LIMIT_PROMPT } from "./resume.js";
import { toolArgs } from "./tools.js";
import { describeRateLimit, detectRateLimit, type RateLimitHit } from "./rateLimit.js";

const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

/**
 * Único punto por el que se lanza el CLI, aislado para poder sustituirlo en los
 * tests: en Windows un CLI falso no se puede spawnear sin shell (un .cmd no es
 * ejecutable directo), y lanzar el de verdad cuesta dinero y minutos. Lo que se
 * prueba sustituyéndolo es lo que de verdad se rompe: el parseo del
 * stream-json, el recuento de tokens y en qué estado acaban run y task.
 */
export const runtime = { spawn };

/**
 * En Windows matamos con `taskkill`, que no deja señal: el proceso sale con
 * code != 0 y signal null, indistinguible de un fallo real. Marcamos la run
 * antes de matarla para poder clasificar el exit como 'cancelled'.
 */
const cancelledRuns = new Set<string>();

/** Subconjunto de `cancelledRuns`: las que matamos nosotros por timeout. Estas
 *  se clasifican como 'failed', no como 'cancelled' — nadie las canceló. */
const timedOutRuns = new Set<string>();

const MAX_SUMMARY_CHARS = 4000;

export async function cancelRun(runId: string): Promise<boolean> {
  const proc = activeProcesses.get(runId);
  if (!proc || !proc.pid) return false;
  cancelledRuns.add(runId);
  await killProcessTree(proc.pid);
  return true;
}

/**
 * Mata todas las runs en marcha. Se llama al cerrar la API: el proceso muere
 * justo después, así que no esperamos a que `finish()` persista nada — de eso
 * se encarga el reaper en el siguiente arranque.
 */
export async function killActiveRuns(): Promise<number> {
  const running = [...activeProcesses.keys()];
  await Promise.all(running.map((runId) => cancelRun(runId)));
  return running.length;
}

function emptyCounts(): TokenCounts {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function readUsage(usage: any): TokenCounts {
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * El evento `result` trae `modelUsage` con el desglose por modelo, incluyendo
 * subagentes y modelos auxiliares que no aparecen en el `usage` de nivel
 * superior. Es el agregado más completo de toda la run.
 */
function totalsFromResult(event: any): TokenCounts | null {
  if (event.modelUsage && typeof event.modelUsage === "object") {
    const totals = emptyCounts();
    for (const usage of Object.values<any>(event.modelUsage)) {
      totals.input += usage.inputTokens ?? 0;
      totals.output += usage.outputTokens ?? 0;
      totals.cacheRead += usage.cacheReadInputTokens ?? 0;
      totals.cacheWrite += usage.cacheCreationInputTokens ?? 0;
    }
    return totals;
  }
  if (event.usage) return readUsage(event.usage);
  return null;
}

export type AuthMode = "subscription" | "api_key";

/**
 * Una ANTHROPIC_API_KEY presente en el entorno tiene precedencia sobre el login
 * de claude.ai, así que para consumir del plan hay que borrarla del entorno del
 * hijo — heredarla sin más factura por API sin decir nada.
 */
export function childEnv(mode: AuthMode): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (mode === "api_key") {
    env.ANTHROPIC_API_KEY = config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
    return env;
  }
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export async function executeTaskRun(
  runId: string,
  authMode: AuthMode = config.authMode,
): Promise<void> {
  const run = await db.taskRun.findUnique({
    where: { id: runId },
    include: {
      task: { include: { project: { include: { claudeMd: true } } } },
      agent: { include: { skills: { include: { skill: true } } } },
    },
  });

  if (!run) throw new Error(`TaskRun ${runId} no encontrado`);

  const { task, agent } = run;
  const project = task.project;

  // Una continuación retoma la sesión del padre, y el CLI indexa las sesiones
  // por el directorio donde corrieron: tiene que volver al mismo workspace.
  const parent = run.resumedFromId
    ? await db.taskRun.findUnique({ where: { id: run.resumedFromId } })
    : null;

  if (parent && !parent.sessionId) {
    throw new Error(
      `La run ${parent.id} no guardó sesión del CLI, así que no se puede retomar.`,
    );
  }

  // Quien creó el workspace es quien puede destruirlo. Una continuación vive en
  // el del padre: limpiarlo al fallar se llevaría por delante su trabajo.
  const ownsWorkspace = !parent;

  const { workspacePath, branchName } = parent
    ? { workspacePath: parent.workspacePath, branchName: parent.branchName }
    : await setupWorkspace(project, run, config.workspacesRoot);

  // Idempotente: en una continuación las skills ya están enlazadas y el
  // CLAUDE.md inyectado, pero repetirlo cuesta nada y cubre que hayan cambiado.
  await injectWorkspaceResources({
    workspacePath,
    agentSkills: agent.skills,
    claudeMdContent: project.claudeMd?.content ?? null,
  });

  const skillNames = agent.skills.map((s) => s.skill.name);
  // Al retomar, el contexto de la tarea ya está en la sesión: repetir el
  // systemPrompt entero solo serviría para pagarlo otra vez.
  const prompt = parent
    ? (run.followUpPrompt ?? RESUME_AFTER_LIMIT_PROMPT)
    : buildPrompt({
        systemPrompt: agent.systemPrompt,
        taskTitle: task.title,
        taskDescription: task.description,
        skillNames,
      });

  await fs.mkdir(config.logsRoot, { recursive: true });
  const logPath = path.join(config.logsRoot, `${runId}.ndjson`);
  const logStream = createWriteStream(logPath, { flags: "a" });

  // El NDJSON solo guardaba lo que devuelve el CLI, así que cuando una run
  // salía rara no había forma de ver qué se le había pedido. Va como primera
  // línea, con el mismo formato que el resto para que el visor la lea igual.
  function logRequest(args: string[]): void {
    const event = {
      type: "cockpit",
      subtype: "request",
      model: agent.model,
      // Solo los flags: el prompt va aparte y duplicarlo hace el log ilegible.
      flags: args.slice(2),
      resumedFrom: parent?.id ?? null,
      prompt,
    };
    logStream.write(JSON.stringify(event) + "\n");
  }

  await db.taskRun.update({
    where: { id: runId },
    data: { status: "running", workspacePath, branchName, logPath },
  });

  bus.emit(`run:${runId}`, { type: "status", status: "running" });

  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--model", agent.model,
    "--permission-mode", "acceptEdits",
  ];

  // Sin listas no añade nada: el agente sale con acceso a todo, como antes.
  args.push(...toolArgs(agent));

  if (parent?.sessionId) args.push("--resume", parent.sessionId);

  logRequest(args);

  const child = runtime.spawn(config.claudeCli, args, {
    cwd: workspacePath,
    env: childEnv(authMode),
    ...spawnOptions(),
  });

  // Node emite 'error' (ENOENT del binario, permisos…) en el tick siguiente al
  // spawn. Cualquier await entre medias deja el evento sin escuchar y eso tumba
  // el proceso entero, no solo la run. Lo enganchamos aquí y lo reproducimos
  // luego, cuando el manejador de verdad está montado.
  let earlySpawnError: Error | null = null;
  let onSpawnError = (err: Error): void => {
    earlySpawnError = err;
  };
  child.on("error", (err) => onSpawnError(err));

  activeProcesses.set(runId, child);
  await db.taskRun
    .update({ where: { id: runId }, data: { pid: child.pid ?? null } })
    .catch(() => {});

  // El guard de presupuesto solo salta si el agente tiene budget y si siguen
  // llegando eventos de tokens; una run que se queda muda no la para nadie.
  const timeoutTimer =
    config.runTimeoutMs > 0
      ? setTimeout(() => {
          if (!activeProcesses.has(runId)) return;
          console.warn(
            `[runner] run ${runId} superó el timeout de ${config.runTimeoutMs} ms, abortando`,
          );
          timedOutRuns.add(runId);
          void cancelRun(runId);
        }, config.runTimeoutMs)
      : null;

  function clearRunTimeout(): void {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }

  // El CLI emite un evento `assistant` por cada bloque de contenido del mismo
  // mensaje, todos con el mismo usage. Deduplicamos por message.id para no
  // contar el mismo consumo varias veces.
  const usageByMessage = new Map<string, TokenCounts>();
  // El session_id que anuncia el CLI. Guardarlo es lo que permite retomar esta
  // run más adelante con `--resume` en vez de empezar de cero.
  let sessionId: string | null = null;
  let resultTotals: TokenCounts | null = null;
  let resultCostUsd: number | null = null;
  let resultSummary: string | null = null;
  let resultIsError = false;
  let rateLimit: RateLimitHit | null = null;
  // El aviso de cuota agotada a veces llega por stderr y no por el evento
  // `result`, así que guardamos lo último que escupió.
  let stderrBuffer = "";

  function currentTotals(): TokenCounts {
    if (resultTotals) return resultTotals;
    const totals = emptyCounts();
    for (const usage of usageByMessage.values()) {
      totals.input += usage.input;
      totals.output += usage.output;
      totals.cacheRead += usage.cacheRead;
      totals.cacheWrite += usage.cacheWrite;
    }
    return totals;
  }

  // total_cost_usd del evento `result` es autoritativo; mientras la run está en
  // marcha solo tenemos la estimación local.
  function currentCost(totals: TokenCounts): number {
    return resultCostUsd ?? estimateCost(agent.model, totals);
  }

  // Escribir en BD por cada evento saturaba SQLite y provocaba updates
  // concurrentes sobre la misma fila. Agrupamos en un flush periódico.
  let dirty = false;
  let writing: Promise<unknown> = Promise.resolve();

  function persistTokens(): Promise<unknown> {
    const totals = currentTotals();
    writing = writing
      .then(() =>
        db.taskRun.update({
          where: { id: runId },
          data: {
            inputTokens: totals.input,
            outputTokens: totals.output,
            cacheReadTokens: totals.cacheRead,
            cacheWriteTokens: totals.cacheWrite,
            costUsd: currentCost(totals),
            ...(sessionId ? { sessionId } : {}),
          },
        }),
      )
      .catch((err) => console.warn(`[runner] persist de tokens falló:`, err));
    return writing;
  }

  const flushTimer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    void persistTokens();
  }, 1000);

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

  rl.on("line", (line) => {
    if (!line.trim()) return;
    logStream.write(line + "\n");

    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      bus.emit(`run:${runId}`, { type: "log", line });
      return;
    }

    bus.emit(`run:${runId}`, { type: "stream", data: event });

    // Lo trae el evento `init`, pero todos los demás lo repiten: cogemos el
    // primero que llegue. Al retomar, el CLI puede devolver un id distinto del
    // que le pasamos — el que vale para la siguiente vuelta es este.
    if (!sessionId && typeof event.session_id === "string") {
      sessionId = event.session_id;
      // Se escribe en el flush periódico, junto a los tokens: dos updates
      // sueltos sobre la misma fila es justo lo que satura SQLite.
      dirty = true;
    }

    if (event.type === "result") {
      resultTotals = totalsFromResult(event);
      if (typeof event.total_cost_usd === "number") resultCostUsd = event.total_cost_usd;
      resultIsError = event.is_error === true || event.subtype !== "success";
      if (typeof event.result === "string") {
        resultSummary = event.result.slice(0, MAX_SUMMARY_CHARS);
      }
      rateLimit = detectRateLimit(event, stderrBuffer);
    } else if (event.type === "assistant" && event.message?.usage) {
      const messageId = event.message.id;
      // Sin id no podemos deduplicar; ignoramos antes que inflar el contador.
      if (typeof messageId !== "string") return;
      usageByMessage.set(messageId, readUsage(event.message.usage));
    } else {
      return;
    }

    const totals = currentTotals();
    const costUsd = currentCost(totals);
    dirty = true;

    bus.emit(`run:${runId}`, {
      type: "tokens",
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      costUsd,
    });

    if (agent.maxBudgetUsd && costUsd > agent.maxBudgetUsd && !cancelledRuns.has(runId)) {
      console.warn(
        `[runner] Budget excedido para agent ${agent.name} (${costUsd.toFixed(4)} > ${agent.maxBudgetUsd}), matando run ${runId}`,
      );
      void cancelRun(runId);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrBuffer = `${stderrBuffer}${text}`.slice(-4000);
    logStream.write(`[stderr] ${text}\n`);
    bus.emit(`run:${runId}`, { type: "log", line: text });
  });

  /**
   * Una run tarda minutos y el cockpit no avisaba: sin la pestaña delante no te
   * enterabas. Orquestar agentes y tener que vigilarlos se contradice.
   */
  function announceFinished(status: "succeeded" | "failed" | "cancelled"): void {
    bus.emit("board", {
      type: "run_finished",
      runId,
      taskId: task.id,
      taskTitle: task.title,
      agentName: agent.name,
      status,
    });
  }

  return new Promise<void>((resolve) => {
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let stdoutClosed = false;
    let finished = false;

    // El proceso puede salir antes de que readline haya emitido las últimas
    // líneas. Esperamos a ambos para no perder el evento `result`.
    async function finish() {
      if (finished || !exitInfo || !stdoutClosed) return;
      finished = true;

      clearInterval(flushTimer);
      clearRunTimeout();
      activeProcesses.delete(runId);
      const wasCancelled = cancelledRuns.delete(runId);
      const wasTimeout = timedOutRuns.delete(runId);
      logStream.end();

      await persistTokens();

      const { code, signal } = exitInfo;
      const finalStatus = wasTimeout
        ? "failed"
        : wasCancelled || signal === "SIGTERM" || signal === "SIGKILL"
          ? "cancelled"
          : code === 0 && !resultIsError
            ? "succeeded"
            : "failed";

      // Quedarse sin cuota del plan no es un fallo de la tarea: la run se marca
      // aparte para que la UI pueda ofrecer esperar al reset o tirar de la key.
      const hitLimit =
        finalStatus === "failed" && !wasTimeout && rateLimit ? rateLimit : null;

      const updated = await db.taskRun.update({
        where: { id: runId },
        data: {
          status: finalStatus,
          endedAt: new Date(),
          pid: null,
          failureKind: hitLimit ? "rate_limit" : finalStatus === "failed" ? "error" : null,
          rateLimitResetAt: hitLimit ? hitLimit.resetsAt : null,
          resultSummary: wasTimeout
            ? `Run abortada por timeout tras ${Math.round(config.runTimeoutMs / 60_000)} min.`
            : hitLimit
              ? describeRateLimit(hitLimit)
              : resultSummary,
        },
      });

      if (hitLimit) {
        console.warn(`[runner] run ${runId} cortada por cuota: ${describeRateLimit(hitLimit)}`);
      }

      await settleTaskStatus(task.id, finalStatus);

      // Quedarse sin cuota no es motivo para tirar el trabajo: el workspace es
      // lo que el reintento necesita para retomar la sesión ahí mismo.
      if (ownsWorkspace && !hitLimit) {
        await cleanupWorkspace(project, updated).catch((err) => {
          console.warn(`[runner] cleanup falló para run ${runId}:`, err);
        });
      }

      bus.emit(`run:${runId}`, { type: "status", status: finalStatus });
      bus.emit("board", { type: "task_updated", taskId: task.id });
      announceFinished(finalStatus);
      resolve();
    }

    rl.on("close", () => {
      stdoutClosed = true;
      void finish();
    });

    child.on("exit", (code, signal) => {
      exitInfo = { code, signal };
      void finish();
    });

    async function handleSpawnError(err: Error): Promise<void> {
      if (finished) return;
      finished = true;

      clearInterval(flushTimer);
      clearRunTimeout();
      activeProcesses.delete(runId);
      cancelledRuns.delete(runId);
      timedOutRuns.delete(runId);
      logStream.end();

      console.error(`[runner] error en spawn de claude CLI:`, err);
      // ENOENT aquí siempre significa lo mismo, y "spawn claude ENOENT" no se
      // lo dice a nadie.
      const summary =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `No se encontró el ejecutable '${config.claudeCli}'. Comprueba que Claude Code está instalado y en el PATH, o ajusta CLAUDE_CLI en el .env.`
          : `Error lanzando claude CLI: ${err.message}`;

      await db.taskRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          endedAt: new Date(),
          resultSummary: summary,
          failureKind: "error",
          pid: null,
        },
      });

      await settleTaskStatus(task.id, "failed");

      bus.emit(`run:${runId}`, { type: "status", status: "failed" });
      bus.emit("board", { type: "task_updated", taskId: task.id });
      announceFinished("failed");
      resolve();
    }

    onSpawnError = (err) => void handleSpawnError(err);
    // Si el spawn ya falló mientras montábamos todo esto, lo procesamos ahora.
    if (earlySpawnError) onSpawnError(earlySpawnError);
  });
}

/**
 * La task pasa a 'review' solo si la run terminó bien. Si falló o se canceló
 * vuelve a 'todo' para que no se quede colgada en 'in_progress' para siempre.
 * Solo tocamos la task si sigue en 'in_progress': si el usuario la movió a mano
 * mientras corría, respetamos su decisión.
 */
async function settleTaskStatus(taskId: string, runStatus: string): Promise<void> {
  const nextStatus = runStatus === "succeeded" ? "review" : "todo";
  await db.task.updateMany({
    where: { id: taskId, status: "in_progress" },
    data: { status: nextStatus },
  });
}

function buildPrompt(opts: {
  systemPrompt: string;
  taskTitle: string;
  taskDescription: string;
  skillNames: string[];
}): string {
  return `${opts.systemPrompt}

---
# Tu tarea asignada

**${opts.taskTitle}**

${opts.taskDescription}

---
${
  opts.skillNames.length
    ? `Tienes disponibles estas skills: ${opts.skillNames.join(", ")}. Cárgalas desde .claude/skills/ cuando sean relevantes.\n`
    : ""
}
Trabaja sobre el workspace actual. Cuando termines, entrega un resumen breve del trabajo hecho.`;
}
