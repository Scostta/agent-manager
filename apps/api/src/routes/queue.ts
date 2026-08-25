import type { FastifyInstance } from "fastify";
import { queueStats } from "../runner/queue.js";

export async function queueRoutes(app: FastifyInstance) {
  app.get("/queue/stats", async () => queueStats());
}
