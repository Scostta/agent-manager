import type { FastifyInstance } from "fastify";
import type { Task } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";
import { bus } from "../bus.js";
import { enqueueTaskRun } from "../runner/queue.js";
import { cleanupIfIntegrated } from "../runner/integrate.js";
import {
  DependencyError,
  blockingDependencies,
  dependencyView,
  forgetDependency,
  parseIdList,
  syncDependents,
  syncTaskBlocking,
  validateDependencies,
} from "../tasks/sync.js";

const TaskInput = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  description: z.string().default(""),
  assignedAgentId: z.string().nullable().optional(),
  requiredSkillIds: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
});

const BulkTasksInput = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().default(""),
        assignedAgentId: z.string().nullable().optional(),
        /** Índices dentro de este array, no ids: las tasks aún no existen. */
        dependsOn: z.array(z.number().int()).default([]),
      }),
    )
    .min(1),
});

const MoveInput = z.object({
  status: z.enum(["todo", "in_progress", "review", "done", "blocked"]),
  position: z.number().int().min(0),
});

export async function taskRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/tasks", async (req) => {
    const { projectId } = req.params as { projectId: string };
    const [tasks, totals] = await Promise.all([
      db.task.findMany({
        where: { projectId },
        include: {
          assignedAgent: true,
          runs: { orderBy: { startedAt: "desc" }, take: 1 },
        },
        orderBy: [{ status: "asc" }, { position: "asc" }],
      }),
      // `runs` solo trae la última ejecución, así que el gasto real de una task
      // con reintentos hay que sumarlo aparte.
      db.taskRun.groupBy({
        by: ["taskId"],
        where: { task: { projectId } },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
          costUsd: true,
        },
        _count: { _all: true },
      }),
    ]);

    const byTask = new Map(totals.map((row) => [row.taskId, row]));

    // SQLite guarda estos campos como JSON string; el cliente espera arrays,
    // igual que hace /skills con tags.
    return tasks.map((task) => {
      const sums = byTask.get(task.id);
      const inputTokens = sums?._sum.inputTokens ?? 0;
      const outputTokens = sums?._sum.outputTokens ?? 0;
      const cacheReadTokens = sums?._sum.cacheReadTokens ?? 0;
      const cacheWriteTokens = sums?._sum.cacheWriteTokens ?? 0;

      return {
        ...task,
        requiredSkillIds: parseIdList(task.requiredSkillIds),
        dependsOn: parseIdList(task.dependsOn),
        totals: {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
          costUsd: sums?._sum.costUsd ?? 0,
          runs: sums?._count._all ?? 0,
        },
      };
    });
  });

  app.post("/tasks", async (req, reply) => {
    const body = TaskInput.parse(req.body);

    let dependsOn: string[];
    try {
      dependsOn = await validateDependencies(null, body.projectId, body.dependsOn ?? []);
    } catch (err) {
      if (err instanceof DependencyError) return reply.badRequest(err.message);
      throw err;
    }

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
        dependsOn: JSON.stringify(dependsOn),
        priority: body.priority ?? 0,
        position: (max._max.position ?? -1) + 1,
      },
    });

    // Nace bloqueada si depende de algo que aún no está hecho.
    await syncTaskBlocking(task.id);
    bus.emit("board", { type: "task_created", taskId: task.id });
    return db.task.findUnique({ where: { id: task.id } });
  });

  /**
   * Alta en bloque del backlog inicial de un proyecto. Las dependencias llegan
   * como índices dentro del propio array porque quien las propone (el
   * planificador) todavía no tiene ids que referenciar.
   */
  app.post("/projects/:projectId/tasks/bulk", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = BulkTasksInput.parse(req.body);

    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return reply.notFound();

    const max = await db.task.aggregate({
      where: { projectId, status: "todo" },
      _max: { position: true },
    });
    let position = (max._max.position ?? -1) + 1;

    // Dos pasadas: una fila no tiene id hasta que existe, así que las
    // dependencias se escriben cuando ya están todas creadas.
    const created: Task[] = [];
    for (const item of body.tasks) {
      created.push(
        await db.task.create({
          data: {
            projectId,
            title: item.title,
            description: item.description,
            assignedAgentId: item.assignedAgentId ?? null,
            requiredSkillIds: "[]",
            dependsOn: "[]",
            priority: 0,
            position: position++,
          },
        }),
      );
    }

    for (const [index, item] of body.tasks.entries()) {
      // Solo hacia atrás: así el grafo es acíclico por construcción y no hay
      // que validar ciclos sobre filas que acabamos de crear.
      const deps = [...new Set(item.dependsOn)]
        .filter((dep) => dep >= 0 && dep < index)
        .map((dep) => created[dep].id);
      if (!deps.length) continue;
      await db.task.update({
        where: { id: created[index].id },
        data: { dependsOn: JSON.stringify(deps) },
      });
    }

    for (const task of created) {
      await syncTaskBlocking(task.id);
      bus.emit("board", { type: "task_created", taskId: task.id });
    }

    return db.task.findMany({
      where: { id: { in: created.map((task) => task.id) } },
      orderBy: { position: "asc" },
    });
  });

  app.patch("/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = TaskInput.partial().parse(req.body);

    const current = await db.task.findUnique({ where: { id } });
    if (!current) return reply.notFound();

    let dependsOn: string[] | undefined;
    if (body.dependsOn) {
      try {
        dependsOn = await validateDependencies(id, current.projectId, body.dependsOn);
      } catch (err) {
        if (err instanceof DependencyError) return reply.badRequest(err.message);
        throw err;
      }
    }

    await db.task.update({
      where: { id },
      data: {
        ...body,
        requiredSkillIds: body.requiredSkillIds
          ? JSON.stringify(body.requiredSkillIds)
          : undefined,
        dependsOn: dependsOn ? JSON.stringify(dependsOn) : undefined,
      },
    });

    if (dependsOn) await syncTaskBlocking(id);
    bus.emit("board", { type: "task_updated", taskId: id });
    return db.task.findUnique({ where: { id } });
  });

  app.post("/tasks/:id/move", async (req) => {
    const { id } = req.params as { id: string };
    const { status, position } = MoveInput.parse(req.body);

    const previous = await db.task.findUnique({ where: { id } });
    const task = await db.task.update({
      where: { id },
      data: { status, position },
    });

    // Al pasar a 'done' limpiamos worktrees, pero solo los que ya están
    // integrados: borrar la rama de una run sin mergear tiraba a la basura el
    // único sitio donde vivía su trabajo.
    if (status === "done" && previous?.status !== "done") {
      const runsToClean = await db.taskRun.findMany({
        where: { taskId: id, status: "succeeded" },
        include: { task: { include: { project: true } } },
      });
      for (const run of runsToClean) {
        await cleanupIfIntegrated(run, run.task.project).catch((err) =>
          console.warn(`[task done] cleanup falló:`, err),
        );
      }
    }

    // Marcar algo como hecho es lo que libera a quienes esperaban por ello.
    if (status !== previous?.status) await syncDependents(id);

    bus.emit("board", { type: "task_updated", taskId: id });
    return task;
  });

  app.delete("/tasks/:id", async (req) => {
    const { id } = req.params as { id: string };
    // Sin esto, sus dependientes quedarían esperando por una tarea que ya no
    // existe y no habría forma de desbloquearlas desde la UI.
    await forgetDependency(id);
    await db.task.delete({ where: { id } });
    bus.emit("board", { type: "task_deleted", taskId: id });
    return { ok: true };
  });

  app.post("/tasks/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { agentId } = z
      .object({ agentId: z.string().optional() })
      .parse(req.body ?? {});

    const task = await db.task.findUnique({ where: { id } });
    if (!task) return reply.notFound();

    const useAgentId = agentId ?? task.assignedAgentId;
    if (!useAgentId) return reply.badRequest("La task no tiene agente asignado");

    // El guard de verdad está aquí: da igual en qué columna la haya puesto el
    // usuario, no se lanza nada mientras falten dependencias.
    const blocking = await blockingDependencies(id);
    if (blocking.length > 0) {
      const pending = await dependencyView(blocking);
      const names = pending.map((dep) => dep.title ?? dep.id).join(", ");
      return reply.badRequest(`Esta tarea depende de: ${names}. Termínalas antes de lanzarla.`);
    }

    const runId = await enqueueTaskRun(id, useAgentId);
    return { runId };
  });

  /** Estado de las dependencias de una tarea, para explicar el bloqueo. */
  app.get("/tasks/:id/dependencies", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await db.task.findUnique({ where: { id }, select: { dependsOn: true } });
    if (!task) return reply.notFound();
    return { dependencies: await dependencyView(parseIdList(task.dependsOn)) };
  });

}
