import type { FastifyInstance } from "fastify";
import { bus } from "../bus.js";

export async function sseRoutes(app: FastifyInstance) {
  // Stream de una run en tiempo real
  app.get("/runs/:runId/stream", (req, reply) => {
    const { runId } = req.params as { runId: string };
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const handler = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    bus.on(`run:${runId}`, handler);

    req.raw.on("close", () => {
      bus.off(`run:${runId}`, handler);
    });
  });

  // Stream global del kanban (todos los cambios de tasks)
  app.get("/board/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const handler = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    bus.on("board", handler);

    // Ping cada 30s para mantener la conexión viva
    const interval = setInterval(() => {
      reply.raw.write(`: ping\n\n`);
    }, 30_000);

    req.raw.on("close", () => {
      bus.off("board", handler);
      clearInterval(interval);
    });
  });
}
