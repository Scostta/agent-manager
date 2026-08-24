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

const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

/**
 * En Windows matamos con `taskkill`, que no deja señal: el proceso sale con
 * code != 0 y signal null, indistinguible de un fallo real. Marcamos la run
 * antes de matarla para poder clasificar el exit como 'cancelled'.
 */
const cancelledRuns = new Set<string>();

const MAX_SUMMARY_CHARS = 4000;

export async function cancelRun(runId: string): Promise<boolean> {
  const proc = activeProcesses.get(runId);
  if (!proc || !proc.pid) return false;
  cancelledRuns.add(runId);
  await killProcessTree(proc.pid);
  return true;
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

export async function executeTaskRun(runId: string): Promise<void> {
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

  const { workspacePath, branchName } = await setupWorkspace(
    project,
    run,
    config.workspacesRoot,
  );

  await injectWorkspaceResources({
    workspacePath,
    agentSkills: agent.skills,
    claudeMdContent: project.claudeMd?.content ?? null,
  });

  const skillNames = agent.skills.map((s) => s.skill.name);
  const prompt = buildPrompt({
    systemPrompt: agent.systemPrompt,
    taskTitle: task.title,
    taskDescription: task.description,
    skillNames,
  });

  await fs.mkdir(config.logsRoot, { recursive: true });
  const logPath = path.join(config.logsRoot, `${runId}.ndjson`);
  const logStream = createWriteStream(logPath, { flags: "a" });

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

  const child = spawn(config.claudeCli, args, {
    cwd: workspacePath,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
    },
    ...spawnOptions(),
  });

  activeProcesses.set(runId, child);
  await db.taskRun.update({ where: { id: runId }, data: { pid: child.pid ?? null } });

  // El CLI emite un evento `assistant` por cada bloque de contenido del mismo
  // mensaje, todos con el mismo usage. Deduplicamos por message.id para no
  // contar el mismo consumo varias veces.
  const usageByMessage = new Map<string, TokenCounts>();
  let resultTotals: TokenCounts | null = null;
  let resultCostUsd: number | null = null;
  let resultSummary: string | null = null;
  let resultIsError = false;

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

    if (event.type === "result") {
      resultTotals = totalsFromResult(event);
      if (typeof event.total_cost_usd === "number") resultCostUsd = event.total_cost_usd;
      resultIsError = event.is_error === true || event.subtype !== "success";
      if (typeof event.result === "string") {
        resultSummary = event.result.slice(0, MAX_SUMMARY_CHARS);
      }
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
    logStream.write(`[stderr] ${text}\n`);
    bus.emit(`run:${runId}`, { type: "log", line: text });
  });

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
      activeProcesses.delete(runId);
      const wasCancelled = cancelledRuns.delete(runId);
      logStream.end();

      await persistTokens();

      const { code, signal } = exitInfo;
      const finalStatus =
        wasCancelled || signal === "SIGTERM" || signal === "SIGKILL"
          ? "cancelled"
          : code === 0 && !resultIsError
            ? "succeeded"
            : "failed";

      const updated = await db.taskRun.update({
        where: { id: runId },
        data: {
          status: finalStatus,
          endedAt: new Date(),
          pid: null,
          resultSummary,
        },
      });

      await settleTaskStatus(task.id, finalStatus);

      await cleanupWorkspace(project, updated).catch((err) => {
        console.warn(`[runner] cleanup falló para run ${runId}:`, err);
      });

      bus.emit(`run:${runId}`, { type: "status", status: finalStatus });
      bus.emit("board", { type: "task_updated", taskId: task.id });
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

    child.on("error", async (err) => {
      if (finished) return;
      finished = true;

      clearInterval(flushTimer);
      activeProcesses.delete(runId);
      cancelledRuns.delete(runId);
      logStream.end();

      console.error(`[runner] error en spawn de claude CLI:`, err);
      await db.taskRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          endedAt: new Date(),
          resultSummary: `Error spawning claude CLI: ${err.message}`,
          pid: null,
        },
      });

      await settleTaskStatus(task.id, "failed");

      bus.emit(`run:${runId}`, { type: "status", status: "failed" });
      bus.emit("board", { type: "task_updated", taskId: task.id });
      resolve();
    });
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
