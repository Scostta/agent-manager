import type { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs/promises";
import { db } from "../db.js";

const ClaudeMdInput = z.object({
  scope: z.enum(["global", "project", "agent"]),
  content: z.string(),
  filePath: z.string().optional(),
});

export async function claudeMdRoutes(app: FastifyInstance) {
  app.get("/claude-md", async () => {
    return db.claudeMd.findMany({ include: { project: true } });
  });

  app.get("/claude-md/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const md = await db.claudeMd.findUnique({ where: { id } });
    if (!md) return reply.notFound();
    return md;
  });

  app.post("/claude-md", async (req) => {
    const body = ClaudeMdInput.parse(req.body);
    return db.claudeMd.create({ data: body });
  });

  app.patch("/claude-md/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = ClaudeMdInput.partial().parse(req.body);
    const md = await db.claudeMd.update({ where: { id }, data: body });

    if (md.filePath && body.content !== undefined) {
      await fs.writeFile(md.filePath, body.content).catch(() => {});
    }

    return md;
  });

  app.delete("/claude-md/:id", async (req) => {
    const { id } = req.params as { id: string };
    await db.claudeMd.delete({ where: { id } });
    return { ok: true };
  });
}
