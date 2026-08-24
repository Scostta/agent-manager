"use client";

import { useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { Icon } from "@/components/ui/icon";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  StatusDot,
  Textarea,
} from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { createProject } from "@/lib/api";
import { keys, useProjects } from "@/lib/hooks";
import { formatRelative } from "@/lib/format";
import type { Project, TaskStatus } from "@/lib/types";

const COUNT_BADGES: { status: TaskStatus; label: string; variant: "default" | "blue" | "yellow" | "green" | "red"; dot?: boolean }[] = [
  { status: "todo", label: "todo", variant: "default" },
  { status: "in_progress", label: "en curso", variant: "blue", dot: true },
  { status: "review", label: "revisión", variant: "yellow", dot: true },
  { status: "done", label: "hechas", variant: "green" },
  { status: "blocked", label: "bloqueadas", variant: "red", dot: true },
];

function ProjectCard({ project }: { project: Project }) {
  const counts = project.taskCounts ?? {};
  const running = counts.in_progress ?? 0;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="relative flex flex-col overflow-hidden rounded-lg border border-border-1 bg-bg-3 p-4 transition-colors hover:border-border-3 hover:bg-bg-4"
    >
      {running > 0 && (
        <span className="absolute right-3 top-3 flex items-center gap-1.5">
          <StatusDot status="running" pulse />
          <span className="text-xs font-medium text-ok">{running} en curso</span>
        </span>
      )}

      <div className="mb-2.5 flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-2 bg-bg-5 text-txt-2">
          <Icon name="folder" size={15} />
        </span>
        <div className="min-w-0">
          <div className="text-md font-semibold text-txt-1">{project.name}</div>
          <div className="text-sm text-txt-2">
            {project.description || <span className="text-txt-3">Sin descripción</span>}
          </div>
        </div>
      </div>

      <div
        className="mb-3 flex items-center gap-1.5 font-mono text-xs text-txt-3"
        title={project.repoPath}
      >
        <Icon name="folder" size={11} />
        <span className="truncate-1">{project.repoPath}</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {COUNT_BADGES.map(({ status, label, variant, dot }) => {
          const value = counts[status] ?? 0;
          if (!value) return null;
          return (
            <Badge key={status} variant={variant} size="xs" dot={dot}>
              {value} {label}
            </Badge>
          );
        })}
        {!project._count?.tasks && (
          <span className="text-xs text-txt-3">Sin tareas todavía</span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between">
        <Badge variant={project.workspaceStrategy === "worktree" ? "accent" : "ghost"} size="xs">
          <Icon name="gitBranch" size={9} />
          {project.workspaceStrategy}
        </Badge>
        <span className="flex items-center gap-1 text-xs text-txt-3">
          <Icon name="clock" size={10} />
          {formatRelative(project.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setRepoPath("");
    setDescription("");
  };

  const submit = async () => {
    if (!name.trim() || !repoPath.trim()) return;
    setSaving(true);
    try {
      const created = await createProject({
        name: name.trim(),
        repoPath: repoPath.trim(),
        description: description.trim() || undefined,
      });
      await mutate(keys.projects);
      toast(
        `Proyecto creado · estrategia ${created.workspaceStrategy} detectada`,
        "success",
      );
      reset();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo crear el proyecto", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo proyecto"
      footer={
        <>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            loading={saving}
            disabled={!name.trim() || !repoPath.trim()}
          >
            Crear proyecto
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-txt-2">Nombre</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="mi-proyecto"
          inputSize="md"
          autoFocus
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-txt-2">Ruta del repo</span>
        <Input
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="C:\\Users\\tu-usuario\\Proyectos\\mi-repo"
          inputSize="md"
          mono
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <span className="text-xs text-txt-3">
          Ruta absoluta. Si contiene un <span className="font-mono">.git</span>, se usará la
          estrategia <span className="font-mono">worktree</span>; si no,{" "}
          <span className="font-mono">copy</span>.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-txt-2">Descripción (opcional)</span>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Para qué sirve este proyecto"
          rows={2}
        />
      </label>
    </Modal>
  );
}

export function ProjectsView() {
  const { data: projects, error, isLoading } = useProjects();
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-txt-1">Proyectos</h1>
          <p className="text-sm text-txt-3">
            {isLoading
              ? "Cargando…"
              : `${projects?.length ?? 0} ${projects?.length === 1 ? "repositorio" : "repositorios"}`}
          </p>
        </div>
        <Button variant="primary" size="sm" icon="plus" onClick={() => setShowNew(true)}>
          Nuevo proyecto
        </Button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">
          <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
          <span>
            No se pudo contactar con la API en{" "}
            <span className="font-mono">localhost:3001</span>. ¿Está corriendo{" "}
            <span className="font-mono">pnpm dev:api</span>?
          </span>
        </div>
      )}

      {!isLoading && !error && !projects?.length && (
        <EmptyState
          icon="folder"
          title="Todavía no hay proyectos"
          hint="Un proyecto apunta a una carpeta local. Cada uno tiene su propio kanban y sus runs."
          action={
            <Button variant="primary" size="sm" icon="plus" onClick={() => setShowNew(true)}>
              Crear el primero
            </Button>
          }
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
        {projects?.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>

      <NewProjectModal open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
