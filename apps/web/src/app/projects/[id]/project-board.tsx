"use client";

import useSWR from "swr";
import { AppShell } from "@/components/shell/app-shell";
import { KanbanView } from "@/components/kanban/kanban-view";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/primitives";
import { getProject } from "@/lib/api";

export function ProjectBoard({ projectId }: { projectId: string }) {
  const { data: project, error, isLoading } = useSWR(`/projects/${projectId}`, () =>
    getProject(projectId),
  );

  const crumbs = [
    { label: "Proyectos", href: "/projects" },
    { label: project?.name ?? "…" },
  ];

  return (
    <AppShell crumbs={crumbs}>
      {isLoading && <div className="p-7 text-sm text-txt-3">Cargando proyecto…</div>}

      {error && (
        <div className="p-7">
          <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">
            <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
            <span>No se pudo cargar el proyecto: {String(error.message ?? error)}</span>
          </div>
        </div>
      )}

      {!isLoading && !error && !project && (
        <EmptyState
          icon="folder"
          title="Proyecto no encontrado"
          hint="Puede que se haya eliminado desde otra pestaña."
        />
      )}

      {project && <KanbanView project={project} />}
    </AppShell>
  );
}
