import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";

const AgentInput = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  maxBudgetUsd: z.number().positive().optional(),
  skillIds: z.array(z.string()).optional(),
});

export async function agentRoutes(app: FastifyInstance) {
  app.get("/agents", async () => {
    return db.agent.findMany({
      include: { skills: { include: { skill: true } }, _count: { select: { runs: true } } },
      orderBy: { updatedAt: "desc" },
    });
  });

  app.get("/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await db.agent.findUnique({
      where: { id },
      include: { skills: { include: { skill: true } } },
    });
    if (!agent) return reply.notFound();
    return agent;
  });

  app.post("/agents", async (req) => {
    const { skillIds, ...data } = AgentInput.parse(req.body);
    return db.agent.create({
      data: {
        ...data,
        skills: skillIds
          ? { create: skillIds.map((skillId) => ({ skillId })) }
          : undefined,
      },
      include: { skills: { include: { skill: true } } },
    });
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

    return db.agent.update({
      where: { id },
      data,
      include: { skills: { include: { skill: true } } },
    });
  });

  app.delete("/agents/:id", async (req) => {
    const { id } = req.params as { id: string };
    await db.agent.delete({ where: { id } });
    return { ok: true };
  });
}
