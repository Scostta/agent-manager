"use client";

import { useState, type ReactElement } from "react";
import useSWR from "swr";
import Link from "next/link";
import { FolderOpen, Plus, MoreHorizontal, Folder } from "lucide-react";
import { projects, type ProjectWithCount } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/cn";
import { NewProjectModal } from "./new-project-modal.client";

function ProjectCard({
  project,
}: {
  project: ProjectWithCount;
}): ReactElement {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-2 p-4 transition-colors hover:border-border-3 hover:bg-bg-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Folder size={16} className="shrink-0 text-accent" />
          <span className="text-sm font-medium text-text-1 group-hover:text-white">
            {project.name}
          </span>
        </div>
        <MoreHorizontal
          size={14}
          className="shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>

      {project.description ? (
        <p className="line-clamp-2 text-xs text-text-2">{project.description}</p>
      ) : (
        <p className="text-xs italic text-text-3">Sin descripción</p>
      )}

      <p className="truncate font-mono text-xs text-text-3">{project.repoPath}</p>

      <div className="flex items-center gap-2">
        <Badge variant="default">
          {project._count.tasks} tarea{project._count.tasks !== 1 ? "s" : ""}
        </Badge>
      </div>
    </Link>
  );
}

function ProjectsGrid({
  data,
  onNew,
}: {
  data: ProjectWithCount[];
  onNew: () => void;
}): ReactElement {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <FolderOpen size={40} className="text-text-3" />
        <div>
          <p className="text-sm font-medium text-text-1">Sin proyectos</p>
          <p className="mt-1 text-xs text-text-3">
            Crea tu primer proyecto para comenzar
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={onNew}>
          <Plus size={13} />
          Nuevo proyecto
        </Button>
      </div>
    );
  }

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
    >
      {data.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}

export function ProjectsList(): ReactElement {
  const [showModal, setShowModal] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(
    "/projects",
    () => projects.list(),
    { refreshInterval: 0 },
  );

  return (
    <>
      <div className="flex items-center justify-between px-6 pb-4 pt-6">
        <h1 className="text-base font-semibold text-text-1">Proyectos</h1>
        <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
          <Plus size={13} />
          Nuevo proyecto
        </Button>
      </div>

      <div className="px-6 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner className="text-text-3" size={20} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <p className="text-sm text-red">No se pudo conectar con la API</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void mutate()}
            >
              Reintentar
            </Button>
          </div>
        ) : (
          <ProjectsGrid data={data ?? []} onNew={() => setShowModal(true)} />
        )}
      </div>

      {showModal ? (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            void mutate();
          }}
        />
      ) : null}
    </>
  );
}
