import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { bus } from "../bus.js";

/**
 * Reenvía un canal del bus como SSE. Una run puede pasar minutos sin emitir
 * nada; sin el ping el navegador o cualquier proxy intermedio da la conexión
 * por muerta.
 */
function pipeChannel(req: FastifyRequest, reply: FastifyReply, channel: string): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const handler = (event: unknown) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  bus.on(channel, handler);

  const interval = setInterval(() => {
    reply.raw.write(`: ping\n\n`);
  }, 30_000);

  req.raw.on("close", () => {
    bus.off(channel, handler);
    clearInterval(interval);
  });
}

export async function sseRoutes(app: FastifyInstance) {
  app.get("/runs/:runId/stream", (req, reply) => {
    const { runId } = req.params as { runId: string };
    pipeChannel(req, reply, `run:${runId}`);
  });

  app.get("/board/stream", (req, reply) => {
    pipeChannel(req, reply, "board");
  });

  /** Progreso de la planificación de tareas iniciales de un proyecto. */
  app.get("/projects/:projectId/plan/stream", (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    pipeChannel(req, reply, `plan:${projectId}`);
  });
}
