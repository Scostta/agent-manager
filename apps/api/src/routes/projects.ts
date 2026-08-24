import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { detectWorkspaceStrategy } from "../runner/workspace.js";

const ProjectInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  repoPath: z.string().min(1),
  workspaceStrategy: z.enum(["worktree", "copy"]).optional(),
  // Sin esto el scope 'project' de ClaudeMd era inalcanzable: la FK vive en
  // Project y ninguna ruta la escribía.
  claudeMdId: z.string().nullable().optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", async () => {
    return db.project.findMany({
      include: { _count: { select: { tasks: true } } },
      orderBy: { updatedAt: "desc" },
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

  app.post("/projects", async (req) => {
    const body = ProjectInput.parse(req.body);
    const strategy = body.workspaceStrategy
      ?? (await detectWorkspaceStrategy(body.repoPath));
    return db.project.create({
      data: { ...body, workspaceStrategy: strategy },
    });
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
