import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { parseToolList } from "../runner/tools.js";

import type { Agent } from "@prisma/client";

/**
 * Lista de herramientas del CLI. Vacía es lo mismo que no poner nada: pasar
 * `--allowedTools` sin nada no es "todas", es "ninguna", y eso deja al agente
 * sin poder hacer su trabajo. Se guarda como JSON string, igual que el resto de
 * arrays en SQLite.
 */
const ToolList = z
  .array(z.string().trim().min(1))
  .nullable()
  .transform((tools) => (tools?.length ? JSON.stringify([...new Set(tools)]) : null));

/**
 * Color del avatar. Quien lo elige es la UI, que es la única que conoce la
 * paleta y qué colores están cogidos; aquí solo se comprueba que sea un hex y
 * no texto libre, porque acaba metido en un style del frontend.
 * null es válido y significa "derívalo del nombre".
 */
const AgentColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser un hex tipo "#7B6CF6"')
  .nullable();

const AgentInput = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  maxBudgetUsd: z.number().positive().optional(),
  color: AgentColor.optional(),
  skillIds: z.array(z.string()).optional(),
  allowedTools: ToolList.optional(),
  disallowedTools: ToolList.optional(),
});

/** El cliente espera arrays; en BD son JSON string. Igual que /skills con tags. */
function withToolLists<T extends Agent>(agent: T) {
  return {
    ...agent,
    allowedTools: parseToolList(agent.allowedTools),
    disallowedTools: parseToolList(agent.disallowedTools),
  };
}

export async function agentRoutes(app: FastifyInstance) {
  app.get("/agents", async () => {
    const agents = await db.agent.findMany({
      include: { skills: { include: { skill: true } }, _count: { select: { runs: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return agents.map(withToolLists);
  });

  app.get("/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await db.agent.findUnique({
      where: { id },
      include: { skills: { include: { skill: true } } },
    });
    if (!agent) return reply.notFound();
    return withToolLists(agent);
  });

  app.post("/agents", async (req) => {
    const { skillIds, ...data } = AgentInput.parse(req.body);
    const agent = await db.agent.create({
      data: {
        ...data,
        skills: skillIds
          ? { create: skillIds.map((skillId) => ({ skillId })) }
          : undefined,
      },
      include: { skills: { include: { skill: true } } },
    });
    return withToolLists(agent);
  });

  app.patch("/agents/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { skillIds, ...data } = AgentInput.partial().parse(req.body);

    if (skillIds !== undefined) {
      await db.agentSkill.deleteMany({ where: { agentId: id } });
      await db.agentSkill.createMany({
        data: skillIds.map((skillId) => ({ agentId: id, skillId })),
      });
    }

    const agent = await db.agent.update({
      where: { id },
      data,
      include: { skills: { include: { skill: true } } },
    });
    return withToolLists(agent);
  });

  app.delete("/agents/:id", async (req) => {
    const { id } = req.params as { id: string };
    await db.agent.delete({ where: { id } });
    return { ok: true };
  });
}
