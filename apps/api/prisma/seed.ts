import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const developer = await db.agent.upsert({
    where: { id: "seed-dev" },
    update: {},
    create: {
      id: "seed-dev",
      name: "Developer",
      role: "developer",
      model: "claude-opus-5",
      // Distintos a propósito: dos agentes del mismo color no se distinguen
      // de un vistazo en el kanban ni en el historial.
      color: "#7B6CF6",
      systemPrompt:
        "Eres un desarrollador senior. Implementas las tareas siguiendo las convenciones del repo. Escribes código limpio y tests cuando tenga sentido.",
    },
  });

  await db.agent.upsert({
    where: { id: "seed-reviewer" },
    update: {},
    create: {
      id: "seed-reviewer",
      name: "Reviewer",
      role: "reviewer",
      model: "claude-opus-5",
      color: "#3FBA6E",
      systemPrompt:
        "Eres un code reviewer riguroso. Revisas el trabajo de otros agentes, señalas problemas de seguridad, rendimiento y estilo. No implementas.",
      // "No implementas" en el prompt es una petición; esto es lo que lo hace
      // cierto. Sin lista, un revisor puede escribir y ejecutar bash igual que
      // cualquier otro agente.
      allowedTools: JSON.stringify(["Read", "Glob", "Grep"]),
    },
  });

  const project = await db.project.upsert({
    where: { id: "seed-project" },
    update: {},
    create: {
      id: "seed-project",
      name: "Proyecto demo",
      description: "Proyecto de ejemplo para probar el cockpit",
      repoPath: process.cwd(),
      workspaceStrategy: "copy", // seed usa cwd que no es un repo Git dedicado
    },
  });

  const existingTask = await db.task.findFirst({ where: { projectId: project.id } });
  if (!existingTask) {
    await db.task.create({
      data: {
        projectId: project.id,
        title: "Leer el README del repo y resumir en tres puntos",
        description:
          "Abre el README.md del repo. Resume lo que hace el proyecto en tres bullet points. Guarda el resumen en SUMMARY.md.",
        assignedAgentId: developer.id,
        position: 0,
      },
    });
  }

  console.log("Seed completado.");
}

main().finally(() => db.$disconnect());
