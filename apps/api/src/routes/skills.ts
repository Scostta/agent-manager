import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import { z } from "zod";

import { db } from "../db.js";
import { scanSkills, upsertSkillFromFile } from "../skills/scanner.js";
import {
  SkillEditError,
  assertKeepsName,
  assertParseable,
  isInsideSkillsPaths,
} from "../skills/edit.js";

const ContentInput = z.object({ content: z.string() });

export async function skillRoutes(app: FastifyInstance) {
  app.get("/skills", async () => {
    const skills = await db.skill.findMany({ orderBy: { name: "asc" } });
    return skills.map((s) => ({ ...s, tags: JSON.parse(s.tags) as string[] }));
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

  /**
   * Escribe el SKILL.md en disco. El watcher lo vería igual, pero reindexamos
   * aquí mismo: si no, la respuesta llevaría el hash y los tags viejos y la UI
   * pintaría lo de antes durante el instante que tarde chokidar.
   */
  app.patch("/skills/:id/content", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { content } = ContentInput.parse(req.body);

    const skill = await db.skill.findUnique({ where: { id } });
    if (!skill) return reply.notFound();

    if (!isInsideSkillsPaths(skill.filePath)) {
      return reply.badRequest(
        `${skill.filePath} está fuera de SKILLS_PATHS. No se escribe ahí.`,
      );
    }

    try {
      assertParseable(content);
      assertKeepsName(content, skill.name);
    } catch (err) {
      if (err instanceof SkillEditError) return reply.badRequest(err.message);
      throw err;
    }

    try {
      await fs.writeFile(skill.filePath, content, "utf8");
    } catch (err: any) {
      return reply.internalServerError(
        `No se pudo escribir ${skill.filePath}: ${err.code ?? err.message}`,
      );
    }

    await upsertSkillFromFile(skill.filePath);

    const updated = await db.skill.findUniqueOrThrow({ where: { id } });
    return { ...updated, tags: JSON.parse(updated.tags) as string[] };
  });

  app.post("/skills/rescan", async () => {
    const count = await scanSkills();
    return { ok: true, indexed: count };
  });
}
