import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  pauseQueue,
  queueStats,
  resumeQueue,
  setConcurrency,
  stopEverything,
} from "../runner/queue.js";

const ConcurrencyInput = z.object({
  // Más allá de un puñado de agentes a la vez la máquina sufre más de lo que
  // gana; el tope es deliberadamente bajo.
  concurrency: z.coerce.number().int().min(1).max(8),
});

export async function queueRoutes(app: FastifyInstance) {
  app.get("/queue/stats", async () => queueStats());

  app.post("/queue/pause", async () => {
    pauseQueue();
    return queueStats();
  });

  app.post("/queue/resume", async () => {
    resumeQueue();
    return queueStats();
  });

  app.patch("/queue/concurrency", async (req) => {
    const { concurrency } = ConcurrencyInput.parse(req.body ?? {});
    setConcurrency(concurrency);
    return queueStats();
  });

  /** Kill switch: mata lo que corre, descarta lo que espera y deja en pausa. */
  app.post("/queue/stop", async () => {
    const result = await stopEverything();
    return { ...result, queue: queueStats() };
  });
}
