import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { db } from "../db.js";
import { config } from "../config.js";
import { scanSkills, upsertSkillFromFile } from "../skills/scanner.js";
import {
  SkillEditError,
  assertKeepsName,
  assertParseable,
  assertValidSkillName,
  isInsideSkillsPaths,
  skillTemplate,
} from "../skills/edit.js";

const ContentInput = z.object({ content: z.string() });

const CreateInput = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

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

  /**
   * Crea la skill en la carpeta del cockpit (`SKILLS_ROOT`), no en cualquier
   * ruta que se pida: el destino no es un parámetro del endpoint precisamente
   * para que crear desde la UI no pueda escribir donde le apetezca.
   *
   * Se devuelve ya indexada, igual que al guardar: el watcher la vería, pero la
   * UI necesita el id para abrirla en el editor justo después.
   */
  app.post("/skills", async (req, reply) => {
    const { name, description } = CreateInput.parse(req.body);

    try {
      assertValidSkillName(name);
    } catch (err) {
      if (err instanceof SkillEditError) return reply.badRequest(err.message);
      throw err;
    }

    // El nombre es @unique en BD, pero comprobarlo aquí da un mensaje que se
    // entiende en vez de un choque de constraint de Prisma.
    const clash = await db.skill.findUnique({ where: { name } });
    if (clash) {
      return reply.badRequest(
        `Ya hay una skill llamada "${name}" en ${clash.filePath}.`,
      );
    }

    const dir = path.join(config.skillsRoot, name);
    const filePath = path.join(dir, "SKILL.md");

    // Una carpeta suelta sin indexar (creada a mano, o de una skill borrada de
    // la BD pero no del disco) se machacaría en silencio si no se mira.
    try {
      await fs.access(filePath);
      return reply.badRequest(`${filePath} ya existe en disco.`);
    } catch {
      // no existe, que es lo que queremos
    }

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, skillTemplate(name, description), "utf8");
    } catch (err: any) {
      return reply.internalServerError(
        `No se pudo crear ${filePath}: ${err.code ?? err.message}`,
      );
    }

    await upsertSkillFromFile(filePath);

    const created = await db.skill.findUniqueOrThrow({ where: { name } });
    return reply.code(201).send({ ...created, tags: JSON.parse(created.tags) as string[] });
  });

  app.post("/skills/rescan", async () => {
    const count = await scanSkills();
    return { ok: true, indexed: count };
  });
}
