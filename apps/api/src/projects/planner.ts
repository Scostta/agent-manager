import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { z } from "zod";

import { bus } from "../bus.js";
import { config } from "../config.js";
import { childEnv } from "../runner/executor.js";
import { estimateCost, type TokenCounts } from "../runner/pricing.js";
import { killProcessTree, spawnOptions } from "../lib/process.js";

/**
 * Genera el backlog inicial de un proyecto spawneando el CLI en modo one-shot.
 *
 * A diferencia de una run normal esto no tiene TaskRun ni pasa por la cola: no
 * hay ninguna Task todavía, y encolarlo detrás de los agentes en marcha dejaría
 * el formulario de creación esperando por trabajo que no tiene nada que ver.
 * El precio de esa simplicidad es que su consumo no entra en el dashboard; el
 * NDJSON queda en LOGS_ROOT por si hay que auditarlo.
 */

export type PlannedTask = {
  title: string;
  description: string;
  /** Índices dentro de este mismo array. Aún no hay ids que referenciar. */
  dependsOn: number[];
};

export type PlanResult = {
  tasks: PlannedTask[];
  model: string;
  tokens: TokenCounts;
  costUsd: number;
  logPath: string;
};

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

const PlanSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().default(""),
        dependsOn: z.array(z.number().int()).default([]),
      }),
    )
    .min(1),
});

const MAX_TASKS = 12;

/** Una por proyecto: el wizard solo puede tener un plan en marcha. */
const activePlans = new Map<string, ChildProcessWithoutNullStreams>();
const cancelledPlans = new Set<string>();

export function cancelPlan(projectId: string): boolean {
  const child = activePlans.get(projectId);
  if (!child?.pid) return false;
  cancelledPlans.add(projectId);
  void killProcessTree(child.pid);
  return true;
}

export type PlanInput = {
  projectId: string;
  name: string;
  description: string;
  repoPath: string;
  claudeMdContent: string | null;
  model?: string;
};

export async function planInitialTasks(input: PlanInput): Promise<PlanResult> {
  if (activePlans.has(input.projectId)) {
    throw new PlanError("Ya hay una planificación en marcha para este proyecto");
  }

  const model = input.model ?? config.plannerModel;
  const prompt = buildPlanPrompt(input);

  await fs.mkdir(config.logsRoot, { recursive: true });
  const logPath = path.join(config.logsRoot, `plan-${input.projectId}.ndjson`);
  const logStream = createWriteStream(logPath, { flags: "a" });

  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--model", model,
    // El planificador solo mira; que no toque el proyecto del usuario.
    "--allowedTools", "Read,Glob,Grep",
  ];

  const child = spawn(config.claudeCli, args, {
    cwd: input.repoPath,
    env: childEnv(config.authMode),
    ...spawnOptions(),
  });

  // Mismo motivo que en executor.ts: el 'error' del spawn llega en el tick
  // siguiente y sin listener tumbaría el proceso entero de la API.
  let earlySpawnError: Error | null = null;
  let onSpawnError = (err: Error): void => {
    earlySpawnError = err;
  };
  child.on("error", (err) => onSpawnError(err));

  activePlans.set(input.projectId, child);

  const channel = `plan:${input.projectId}`;
  const usageByMessage = new Map<string, TokenCounts>();
  let resultText: string | null = null;
  let resultCostUsd: number | null = null;
  let resultIsError = false;
  let stderrBuffer = "";

  const timer =
    config.planTimeoutMs > 0
      ? setTimeout(() => {
          if (activePlans.has(input.projectId)) cancelPlan(input.projectId);
        }, config.planTimeoutMs)
      : null;

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

  rl.on("line", (line) => {
    if (!line.trim()) return;
    logStream.write(line + "\n");

    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      // stream-json que no es JSON: el executor lo tolera y aquí también.
      bus.emit(channel, { type: "log", line });
      return;
    }

    bus.emit(channel, { type: "stream", data: event });

    if (event.type === "result") {
      if (typeof event.result === "string") resultText = event.result;
      if (typeof event.total_cost_usd === "number") resultCostUsd = event.total_cost_usd;
      resultIsError = event.is_error === true || event.subtype !== "success";
    } else if (event.type === "assistant" && event.message?.usage) {
      const id = event.message.id;
      if (typeof id !== "string") return;
      const usage = event.message.usage;
      usageByMessage.set(id, {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
      });
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer = (stderrBuffer + chunk.toString()).slice(-4000);
  });

  const exit = await new Promise<{ code: number | null }>((resolve, reject) => {
    onSpawnError = reject;
    if (earlySpawnError) return reject(earlySpawnError);
    child.on("exit", (code) => resolve({ code }));
  })
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        throw new PlanError(
          `No se encontró el binario "${config.claudeCli}". ¿Está Claude Code en el PATH?`,
        );
      }
      throw new PlanError(`No se pudo lanzar el planificador: ${err.message}`);
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
      rl.close();
      logStream.end();
      activePlans.delete(input.projectId);
    });

  const cancelled = cancelledPlans.delete(input.projectId);
  const tokens = sumTokens(usageByMessage);
  const costUsd = resultCostUsd ?? estimateCost(model, tokens);

  bus.emit(channel, { type: "done", cancelled });

  if (cancelled) throw new PlanError("Planificación cancelada");
  if (exit.code !== 0 || resultIsError || !resultText) {
    const tail = stderrBuffer.trim().slice(-300);
    throw new PlanError(
      `El planificador terminó sin propuesta${tail ? `: ${tail}` : ""}`,
    );
  }

  return { tasks: parsePlan(resultText), model, tokens, costUsd, logPath };
}

function sumTokens(byMessage: Map<string, TokenCounts>): TokenCounts {
  const totals: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const usage of byMessage.values()) {
    totals.input += usage.input;
    totals.output += usage.output;
    totals.cacheRead += usage.cacheRead;
    totals.cacheWrite += usage.cacheWrite;
  }
  return totals;
}

/**
 * El modelo devuelve JSON, pero a veces envuelto en prosa o en un bloque de
 * código. Recortamos al primer objeto de nivel superior antes de parsear.
 */
export function parsePlan(raw: string): PlannedTask[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new PlanError("La respuesta del planificador no traía ningún JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new PlanError("La respuesta del planificador no era JSON válido");
  }

  const result = PlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new PlanError("El JSON del planificador no tenía la forma esperada");
  }

  return result.data.tasks.slice(0, MAX_TASKS).map((task, index) => ({
    title: task.title.trim(),
    description: task.description.trim(),
    // Una dependencia hacia adelante o hacia sí misma es un ciclo garantizado y
    // el kanban la rechazaría al guardar; se descarta aquí, no en el formulario.
    dependsOn: [...new Set(task.dependsOn)]
      .filter((dep) => dep >= 0 && dep < index)
      .sort((a, b) => a - b),
  }));
}

function buildPlanPrompt(input: PlanInput): string {
  const sections = [
    "Eres el planificador de un tablero kanban. Tu trabajo es proponer las tareas",
    "iniciales para arrancar un proyecto. Cada tarea la ejecutará después un agente",
    "Claude Code autónomo en un workspace aislado, así que debe ser concreta,",
    "acotada y verificable por sí sola.",
    "",
    `Proyecto: ${input.name}`,
    `Carpeta: ${input.repoPath}`,
    "",
    "Descripción del usuario:",
    input.description || "(sin descripción)",
  ];

  if (input.claudeMdContent) {
    sections.push("", "CLAUDE.md del proyecto:", "---", input.claudeMdContent, "---");
  }

  sections.push(
    "",
    "Si la carpeta ya tiene código, léelo antes de proponer nada y ajusta las",
    "tareas a lo que falta de verdad. Si está vacía, empieza por el andamiaje.",
    "",
    `Devuelve entre 3 y ${MAX_TASKS} tareas ordenadas: las que no dependen de nada primero.`,
    "",
    "Responde SOLO con este JSON, sin texto alrededor ni bloques de código:",
    '{"tasks":[{"title":"...","description":"...","dependsOn":[]}]}',
    "",
    "- title: imperativo y corto (máx. 60 caracteres).",
    "- description: qué hay que hacer y cómo se sabe que está hecho.",
    "- dependsOn: índices (base 0) de tareas ANTERIORES de este mismo array que",
    "  deben estar terminadas antes de empezar. Vacío si no depende de ninguna.",
    "  Úsalo solo cuando la tarea sea imposible de empezar sin la otra: en el",
    "  cockpit una dependencia sin cumplir deja la tarea bloqueada, y encadenarlas",
    "  todas en fila deja el tablero entero en 'blocked'.",
  );

  return sections.join("\n");
}
