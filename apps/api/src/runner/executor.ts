import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { db } from "../db.js";
import { bus } from "../bus.js";
import { config } from "../config.js";
import { estimateCost } from "./pricing.js";

/**
 * Registro de procesos activos por runId. Permite cancelar una run.
 */
const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

export function cancelRun(runId: string): boolean {
  const proc = activeProcesses.get(runId);
  if (!proc) return false;
  // Negativo mata el process group entero, por si claude spawnea sub-procesos.
  try {
    process.kill(-proc.pid!, "SIGTERM");
  } catch {
    proc.kill("SIGTERM");
  }
  return true;
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

  // 1. Preparar workspace. Clonamos el repo del proyecto en un subdirectorio aislado.
  const workspace = path.join(config.workspacesRoot, task.id, run.id);
  await fs.mkdir(workspace, { recursive: true });

  // Copia el repo al workspace. En prod considera git worktree para ahorrar disco.
  await copyDir(project.repoPath, workspace);

  // 2. Instalar skills permitidos como symlinks en .claude/skills/<skill-name>/SKILL.md
  const skillsDir = path.join(workspace, ".claude", "skills");
  await fs.mkdir(skillsDir, { recursive: true });
  for (const { skill } of agent.skills) {
    const target = path.join(skillsDir, skill.name);
    try {
      await fs.symlink(path.dirname(skill.filePath), target, "dir");
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
    }
  }

  // 3. Inyectar CLAUDE.md del proyecto si existe
  if (project.claudeMd) {
    await fs.writeFile(path.join(workspace, "CLAUDE.md"), project.claudeMd.content);
  }

  // 4. Construir prompt
  // Tipo explícito necesario hasta que `prisma generate` esté disponible en este entorno
  type AgentSkillRow = { agentId: string; skillId: string; skill: { name: string; [key: string]: unknown } };
  const skillNames = (agent.skills as AgentSkillRow[]).map((s) => s.skill.name);
  const prompt = buildPrompt({
    systemPrompt: agent.systemPrompt,
    taskTitle: task.title,
    taskDescription: task.description,
    skillNames,
  });

  // 5. Preparar log NDJSON
  await fs.mkdir(config.logsRoot, { recursive: true });
  const logPath = path.join(config.logsRoot, `${run.id}.ndjson`);
  const logStream = createWriteStream(logPath, { flags: "a" });

  await db.taskRun.update({
    where: { id: run.id },
    data: { status: "running", workspacePath: workspace, logPath },
  });

  bus.emit(`run:${run.id}`, { type: "status", status: "running" });

  // 6. Spawn claude CLI
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose", // necesario con stream-json en algunas versiones
    "--model",
    agent.model,
    "--permission-mode",
    "acceptEdits",
  ];

  const child = spawn(config.claudeCli, args, {
    cwd: workspace,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
    },
    detached: true, // necesario para poder matar el process group con kill(-pid)
  });

  activeProcesses.set(run.id, child);
  await db.taskRun.update({ where: { id: run.id }, data: { pid: child.pid ?? null } });

  // 7. Parsear stream-json línea a línea
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    logStream.write(line + "\n");

    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      // No era JSON, lo emitimos como log plano
      bus.emit(`run:${run.id}`, { type: "log", line });
      return;
    }

    bus.emit(`run:${run.id}`, { type: "stream", data: event });

    // Acumular tokens cuando veamos un usage en el evento
    const usage = event.message?.usage ?? event.usage;
    if (usage) {
      totalInput += usage.input_tokens ?? 0;
      totalOutput += usage.output_tokens ?? 0;
      totalCacheRead += usage.cache_read_input_tokens ?? 0;

      const cost = estimateCost(agent.model, totalInput, totalOutput, totalCacheRead);

      await db.taskRun.update({
        where: { id: run.id },
        data: {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          cacheReadTokens: totalCacheRead,
          costUsd: cost,
        },
      });

      bus.emit(`run:${run.id}`, {
        type: "tokens",
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        costUsd: cost,
      });

      // Budget check
      if (agent.maxBudgetUsd && cost > agent.maxBudgetUsd) {
        console.warn(`[runner] Budget excedido para agent ${agent.name}, matando run ${run.id}`);
        cancelRun(run.id);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    logStream.write(`[stderr] ${text}\n`);
    bus.emit(`run:${run.id}`, { type: "log", line: text });
  });

  return new Promise<void>((resolve) => {
    child.on("exit", async (code, signal) => {
      activeProcesses.delete(run.id);
      logStream.end();

      const finalStatus =
        signal === "SIGTERM" ? "cancelled" : code === 0 ? "succeeded" : "failed";

      await db.taskRun.update({
        where: { id: run.id },
        data: { status: finalStatus, endedAt: new Date() },
      });

      // Si la run fue OK, movemos la task a "review" para que el humano valide
      if (finalStatus === "succeeded") {
        await db.task.update({
          where: { id: task.id },
          data: { status: "review" },
        });
      }

      bus.emit(`run:${run.id}`, { type: "status", status: finalStatus });
      bus.emit("board", { type: "task_updated", taskId: task.id });
      resolve();
    });
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

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
