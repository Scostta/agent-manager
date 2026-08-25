import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";

import { config } from "./config.js";
import { scanSkills, watchSkills } from "./skills/scanner.js";
import { reapOrphanRuns } from "./runner/reaper.js";
import { clearAllRetries, restorePendingRetries } from "./runner/scheduler.js";
import { startWorkspaceGc, stopWorkspaceGc } from "./runner/gc.js";
import { killActiveRuns } from "./runner/executor.js";

import { projectRoutes } from "./routes/projects.js";
import { agentRoutes } from "./routes/agents.js";
import { skillRoutes } from "./routes/skills.js";
import { taskRoutes } from "./routes/tasks.js";
import { claudeMdRoutes } from "./routes/claudeMd.js";
import { sseRoutes } from "./routes/sse.js";
import { queueRoutes } from "./routes/queue.js";
import { runRoutes } from "./routes/runs.js";
import { statsRoutes } from "./routes/stats.js";
import { workspaceRoutes } from "./routes/workspaces.js";

const app = Fastify({ logger: { level: "info" } });

// Un body inválido es culpa del cliente: sin esto, cualquier .parse() de Zod
// sale por el handler por defecto como un 500 opaco.
app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    const detail = error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    request.log.info({ issues: error.issues }, "payload inválido");
    return reply.badRequest(detail);
  }
  request.log.error(error);
  return reply.send(error);
});

await app.register(cors, { origin: config.corsOrigins });
await app.register(sensible);

await app.register(projectRoutes);
await app.register(agentRoutes);
await app.register(skillRoutes);
await app.register(taskRoutes);
await app.register(claudeMdRoutes);
await app.register(sseRoutes);
await app.register(queueRoutes);
await app.register(runRoutes);
await app.register(statsRoutes);
await app.register(workspaceRoutes);

app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

// Sin esto, parar la API deja vivos los `claude` que estuviera ejecutando: el
// reaper marcaría las filas como failed al rearrancar, pero los procesos
// seguirían gastando tokens sin nadie escuchándolos.
app.addHook("onClose", async () => {
  clearAllRetries();
  stopWorkspaceGc();
  const killed = await killActiveRuns();
  if (killed > 0) app.log.info(`[shutdown] ${killed} run(s) activa(s) abortada(s)`);
});

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    app.log.info(`[shutdown] ${signal} recibida, cerrando…`);
    void app.close().then(() => process.exit(0));
  });
}

const reaped = await reapOrphanRuns();
if (reaped > 0) {
  app.log.info(`[reaper] ${reaped} run(s) huérfana(s) marcadas como failed`);
}

const pendingRetries = await restorePendingRetries();
if (pendingRetries > 0) {
  app.log.info(`[scheduler] ${pendingRetries} run(s) esperando a que se reponga la cuota`);
}

const indexed = await scanSkills();
app.log.info(`[skills] ${indexed} SKILL.md indexados`);
watchSkills();

// Barre los workspaces que ya no hacen falta: al arrancar y cada pocas horas.
startWorkspaceGc();

await app.listen({ port: config.port, host: config.host });
app.log.info(`API escuchando en http://${config.host}:${config.port}`);
