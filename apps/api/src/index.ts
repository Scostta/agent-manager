import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";

import { config } from "./config.js";
import { scanSkills, watchSkills } from "./skills/scanner.js";
import { reapOrphanRuns } from "./runner/reaper.js";

import { projectRoutes } from "./routes/projects.js";
import { agentRoutes } from "./routes/agents.js";
import { skillRoutes } from "./routes/skills.js";
import { taskRoutes } from "./routes/tasks.js";
import { claudeMdRoutes } from "./routes/claudeMd.js";
import { sseRoutes } from "./routes/sse.js";
import { queueRoutes } from "./routes/queue.js";

const app = Fastify({ logger: { level: "info" } });

await app.register(cors, { origin: true });
await app.register(sensible);

await app.register(projectRoutes);
await app.register(agentRoutes);
await app.register(skillRoutes);
await app.register(taskRoutes);
await app.register(claudeMdRoutes);
await app.register(sseRoutes);
await app.register(queueRoutes);

app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

const reaped = await reapOrphanRuns();
if (reaped > 0) {
  app.log.info(`[reaper] ${reaped} run(s) huérfana(s) marcadas como failed`);
}

const indexed = await scanSkills();
app.log.info(`[skills] ${indexed} SKILL.md indexados`);
watchSkills();

await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(`API escuchando en http://localhost:${config.port}`);
