import type { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs/promises";
import { db } from "../db.js";

/**
 * `global` se inyecta en el workspace de todas las runs; `project` solo en las
 * de su proyecto, y se enlaza escribiendo `claudeMdId` desde `PATCH /projects/:id`.
 *
 * Hubo un tercer scope, `agent`, que no consumía nadie: el `systemPrompt` del
 * agente ya es el sitio de las instrucciones propias de un agente, y dos sitios
 * para lo mismo solo sirven para que te preguntes cuál gana.
 */
const ClaudeMdInput = z.object({
  scope: z.enum(["global", "project"]),
  content: z.string(),
  filePath: z.string().optional(),
});

/**
 * Solo puede haber un global. Con varios y sin un orden visible, qué acaba
 * leyendo el agente sería un misterio — y "el CLAUDE.md global" es singular en
 * la cabeza de cualquiera, igual que el de tu `~/.claude`.
 */
async function otherGlobalExists(excludeId?: string): Promise<boolean> {
  const existing = await db.claudeMd.findFirst({
    where: { scope: "global", ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return !!existing;
}

const GLOBAL_TAKEN = "Ya hay un CLAUDE.md global. Edita ese en vez de crear otro.";

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

  app.post("/claude-md", async (req, reply) => {
    const body = ClaudeMdInput.parse(req.body);
    if (body.scope === "global" && (await otherGlobalExists())) {
      return reply.badRequest(GLOBAL_TAKEN);
    }
    return db.claudeMd.create({ data: body });
  });

  app.patch("/claude-md/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ClaudeMdInput.partial().parse(req.body);

    // Pasar un documento a global también puede dejar dos.
    if (body.scope === "global" && (await otherGlobalExists(id))) {
      return reply.badRequest(GLOBAL_TAKEN);
    }

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
