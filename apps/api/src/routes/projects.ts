import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { ScaffoldError, scaffoldProject } from "../projects/scaffold.js";
import { PlanError, cancelPlan, planInitialTasks } from "../projects/planner.js";

const ProjectInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  repoPath: z.string().min(1),
  workspaceStrategy: z.enum(["worktree", "copy"]).optional(),
  // Sin esto el scope 'project' de ClaudeMd era inalcanzable: la FK vive en
  // Project y ninguna ruta la escribía.
  claudeMdId: z.string().nullable().optional(),
});

const CreateProjectInput = ProjectInput.extend({
  /** Inicializar la carpeta como repo Git para poder usar worktrees. */
  initGit: z.boolean().optional(),
  /** CLAUDE.md del proyecto: se guarda en BD y se escribe en la carpeta. */
  claudeMdContent: z.string().nullable().optional(),
});

const PlanInput = z.object({ model: z.string().min(1).optional() });

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", async () => {
    const [projects, grouped] = await Promise.all([
      db.project.findMany({
        include: { _count: { select: { tasks: true } } },
        orderBy: { updatedAt: "desc" },
      }),
      // La grid de proyectos pinta el desglose por columna del kanban. Sin esto
      // el frontend tendría que pedir las tasks de cada proyecto por separado.
      db.task.groupBy({ by: ["projectId", "status"], _count: { _all: true } }),
    ]);

    return projects.map((project) => {
      const taskCounts: Record<string, number> = {};
      for (const row of grouped) {
        if (row.projectId === project.id) taskCounts[row.status] = row._count._all;
      }
      return { ...project, taskCounts };
    });
  });

  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await db.project.findUnique({
      where: { id },
      include: { claudeMd: true, tasks: true },
    });
    if (!project) return reply.notFound();
    return project;
  });

  app.post("/projects", async (req, reply) => {
    const body = CreateProjectInput.parse(req.body);
    try {
      return await scaffoldProject(body);
    } catch (err) {
      if (err instanceof ScaffoldError) return reply.badRequest(err.message);
      throw err;
    }
  });

  /**
   * Propone las tareas iniciales del proyecto. No las guarda: el usuario las
   * revisa en el formulario y las confirma con POST /projects/:id/tasks/bulk.
   */
  app.post("/projects/:id/plan", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { model } = PlanInput.parse(req.body ?? {});

    const project = await db.project.findUnique({
      where: { id },
      include: { claudeMd: true },
    });
    if (!project) return reply.notFound();

    try {
      return await planInitialTasks({
        projectId: project.id,
        name: project.name,
        description: project.description ?? "",
        repoPath: project.repoPath,
        claudeMdContent: project.claudeMd?.content ?? null,
        model,
      });
    } catch (err) {
      if (err instanceof PlanError) return reply.badRequest(err.message);
      throw err;
    }
  });

  app.delete("/projects/:id/plan", async (req) => {
    const { id } = req.params as { id: string };
    return { cancelled: cancelPlan(id) };
  });

  app.patch("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = ProjectInput.partial().parse(req.body);
    return db.project.update({ where: { id }, data: body });
  });

  app.delete("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    await db.project.delete({ where: { id } });
    return { ok: true };
  });
}
