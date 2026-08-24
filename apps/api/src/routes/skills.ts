import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import { db } from "../db.js";
import { scanSkills } from "../skills/scanner.js";

export async function skillRoutes(app: FastifyInstance) {
  app.get("/skills", async () => {
    const skills = await db.skill.findMany({ orderBy: { name: "asc" } });
    // Tipo explícito necesario hasta que `prisma generate` esté disponible en este entorno
    type SkillRow = { id: string; name: string; description: string; filePath: string; contentHash: string; scope: string; tags: string; updatedAt: Date };
    return (skills as SkillRow[]).map((s) => ({ ...s, tags: JSON.parse(s.tags) as string[] }));
  });

  app.get("/skills/:id/content", async (req, reply) => {
    const { id } = req.params as { id: string };
    const skill = await db.skill.findUnique({ where: { id } });
    if (!skill) return reply.notFound();
    try {
      const content = await fs.readFile(skill.filePath, "utf8");
      return { content, filePath: skill.filePath };
    } catch {
      return reply.notFound("Fichero SKILL.md no encontrado en disco");
    }
  });

  app.post("/skills/rescan", async () => {
    const count = await scanSkills();
    return { ok: true, indexed: count };
  });
}
