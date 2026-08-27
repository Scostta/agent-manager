import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";

import { config } from "./config.js";

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
import { fsRoutes } from "./routes/fs.js";
import { backupRoutes } from "./routes/backup.js";

import type { FastifyInstance } from "fastify";

/**
 * Solo monta plugins y rutas. Todo lo que tiene que ver con arrancar la API de
 * verdad — reaper, scanner de skills, GC, señales, listen — vive en index.ts:
 * así los tests pueden levantar la app con `app.inject()` sin abrir un puerto
 * ni dejar temporizadores corriendo.
 */
export async function buildApp(
  opts: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: "info" },
  });

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
  await app.register(backupRoutes);
  await app.register(workspaceRoutes);
  await app.register(fsRoutes);

  app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

  return app;
}
