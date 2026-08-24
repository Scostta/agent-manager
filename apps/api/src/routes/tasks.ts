import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { bus } from "../bus.js";
import { enqueueTaskRun } from "../runner/queue.js";
import { cancelRun } from "../runner/executor.js";

const TaskInput = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  description: z.string().default(""),
  assignedAgentId: z.string().nullable().optional(),
  requiredSkillIds: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
});

const MoveInput = z.object({
  status: z.enum(["todo", "in_progress", "review", "done", "blocked"]),
  position: z.number().int().min(0),
});

export async function taskRoutes(app: FastifyInstance) {
  // Listado del kanban por proyecto
  app.get("/projects/:projectId/tasks", async (req) => {
    const { projectId } = req.params as { projectId: string };
    return db.task.findMany({
      where: { projectId },
      include: {
        assignedAgent: true,
        runs: { orderBy: { startedAt: "desc" }, take: 1 },
      },
      orderBy: [{ status: "asc" }, { position: "asc" }],
    });
  });

  app.post("/tasks", async (req) => {
    const body = TaskInput.parse(req.body);
    const max = await db.task.aggregate({
      where: { projectId: body.projectId, status: "todo" },
      _max: { position: true },
    });
    const task = await db.task.create({
      data: {
        projectId: body.projectId,
        title: body.title,
        description: body.description,
        assignedAgentId: body.assignedAgentId ?? null,
        requiredSkillIds: JSON.stringify(body.requiredSkillIds ?? []),
        dependsOn: JSON.stringify(body.dependsOn ?? []),
        priority: body.priority ?? 0,
        position: (max._max.position ?? -1) + 1,
      },
    });
    bus.emit("board", { type: "task_created", taskId: task.id });
    return task;
  });

  app.patch("/tasks/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = TaskInput.partial().parse(req.body);
    const task = await db.task.update({
      where: { id },
      data: {
        ...body,
        requiredSkillIds: body.requiredSkillIds
          ? JSON.stringify(body.requiredSkillIds)
          : undefined,
        dependsOn: body.dependsOn ? JSON.stringify(body.dependsOn) : undefined,
      },
    });
    bus.emit("board", { type: "task_updated", taskId: id });
    return task;
  });

  // Mover en el kanban (drag & drop)
  app.post("/tasks/:id/move", async (req) => {
    const { id } = req.params as { id: string };
    const { status, position } = MoveInput.parse(req.body);
    const task = await db.task.update({
      where: { id },
      data: { status, position },
    });
    bus.emit("board", { type: "task_updated", taskId: id });
    return task;
  });

  app.delete("/tasks/:id", async (req) => {
    const { id } = req.params as { id: string };
    await db.task.delete({ where: { id } });
    bus.emit("board", { type: "task_deleted", taskId: id });
    return { ok: true };
  });

  // Lanzar la task con el agente asignado (o uno override)
  app.post("/tasks/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { agentId } = z
      .object({ agentId: z.string().optional() })
      .parse(req.body ?? {});

    const task = await db.task.findUnique({ where: { id } });
    if (!task) return reply.notFound();

    const useAgentId = agentId ?? task.assignedAgentId;
    if (!useAgentId)
      return reply.badRequest("La task no tiene agente asignado");

    const runId = await enqueueTaskRun(id, useAgentId);
    return { runId };
  });

  // Cancelar una run en curso
  app.post("/runs/:runId/cancel", async (req) => {
    const { runId } = req.params as { runId: string };
    const ok = cancelRun(runId);
    return { ok };
  });

  // Detalle de una run
  app.get("/runs/:runId", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await db.taskRun.findUnique({
      where: { id: runId },
      include: { task: true, agent: true },
    });
    if (!run) return reply.notFound();
    return run;
  });
}
