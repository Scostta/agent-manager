import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";

import { config } from "./config.js";
import { db } from "./db.js";
import { scanSkills, watchSkills } from "./skills/scanner.js";
import { queueStats } from "./runner/queue.js";

import { projectRoutes } from "./routes/projects.js";
import { agentRoutes } from "./routes/agents.js";
import { skillRoutes } from "./routes/skills.js";
import { taskRoutes } from "./routes/tasks.js";
import { claudeMdRoutes } from "./routes/claudeMd.js";
import { sseRoutes } from "./routes/sse.js";

const app = Fastify({ logger: { level: "info" } });

await app.register(cors, { origin: true });
await app.register(sensible);

await app.register(projectRoutes);
await app.register(agentRoutes);
await app.register(skillRoutes);
await app.register(taskRoutes);
await app.register(claudeMdRoutes);
await app.register(sseRoutes);

app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));
app.get("/queue/stats", async () => queueStats());

// Limpiar runs que quedaron en estado intermedio si la API cayó
const orphaned = await db.taskRun.updateMany({
  where: { status: { in: ["queued", "running"] } },
  data: { status: "failed", endedAt: new Date(), resultSummary: "API reiniciada — run interrumpida" },
});
if (orphaned.count > 0) {
  app.log.warn(`[startup] ${orphaned.count} runs huérfanas marcadas como failed`);
}

// Al arrancar, indexa skills y queda vigilando cambios
const indexed = await scanSkills();
app.log.info(`[skills] ${indexed} SKILL.md indexados`);
watchSkills();

await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(`API escuchando en http://localhost:${config.port}`);
