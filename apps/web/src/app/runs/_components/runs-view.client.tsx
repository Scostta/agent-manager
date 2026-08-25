"use client";

import { useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import {
  AgentAvatar,
  Button,
  Chip,
  EmptyState,
  Select,
  Spinner,
  StatusDot,
  cn,
} from "@/components/ui/primitives.client";
import { formatCost, formatDuration, formatRelative, formatTokens } from "@/lib/format";
import { useProjects, useRuns } from "@/lib/hooks";
import { RUN_STATUSES, RUN_STATUS_LABEL, isActiveRun } from "@/lib/types";

import type { ReactElement } from "react";
import type { RunListItem, RunStatus } from "@/lib/types";

const PAGE_SIZE = 50;

const STATUS_DOT = {
  queued: "idle",
  running: "running",
  succeeded: "done",
  failed: "error",
  cancelled: "idle",
} as const;

const STATUS_TEXT: Record<RunStatus, string> = {
  queued: "text-txt-3",
  running: "text-info",
  succeeded: "text-ok",
  failed: "text-danger",
  cancelled: "text-txt-3",
};

function duration(run: RunListItem): string {
  const end = run.endedAt ? Date.parse(run.endedAt) : Date.now();
  return formatDuration(end - Date.parse(run.startedAt));
}

function RunRow({ run }: { run: RunListItem }): ReactElement {
  const status = run.status;
  const tokens =
    run.inputTokens + run.outputTokens + run.cacheReadTokens + run.cacheWriteTokens;

  return (
    <Link
      href={`/runs/${run.id}`}
      className="grid grid-cols-[130px_minmax(0,1fr)_180px_90px_80px_70px_90px] items-center gap-3 border-b border-border-1 px-5 py-2.5 text-sm transition-colors hover:bg-bg-hover"
    >
      <span className={cn("flex items-center gap-1.5", STATUS_TEXT[status])}>
        <StatusDot status={STATUS_DOT[status]} pulse={isActiveRun(run)} />
        {RUN_STATUS_LABEL[status]}
      </span>

      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate-1 text-txt-1">{run.task.title}</span>
        {run.branchName && (
          <span className="flex items-center gap-1 font-mono text-2xs text-txt-3">
            <Icon name="gitBranch" size={9} />
            <span className="truncate-1">{run.branchName}</span>
          </span>
        )}
      </span>

      <span className="flex min-w-0 items-center gap-2">
        <AgentAvatar name={run.agent.name} size={20} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate-1 text-txt-2">{run.agent.name}</span>
          <span className="truncate-1 text-2xs text-txt-3">{run.agent.model}</span>
        </span>
      </span>

      <span className="text-right tabular-nums text-txt-2">{formatTokens(tokens)} tok</span>
      <span className="text-right tabular-nums font-medium text-accent">
        {formatCost(run.costUsd)}
      </span>
      <span className="text-right tabular-nums text-txt-3">{duration(run)}</span>
      <span className="text-right text-txt-3">
        {formatRelative(run.endedAt ?? run.startedAt)}
      </span>
    </Link>
  );
}

export function RunsView(): ReactElement {
  const [status, setStatus] = useState<RunStatus | "">("");
  const [projectId, setProjectId] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data: projects } = useProjects();
  const { data, isLoading } = useRuns({
    limit,
    ...(status ? { status } : {}),
    ...(projectId ? { projectId } : {}),
  });

  // Cambiar de filtro con una página grande cargada pediría de golpe todo otra
  // vez; volvemos al tamaño inicial.
  const changeFilter = (next: () => void): void => {
    setLimit(PAGE_SIZE);
    next();
  };

  const runs = data?.runs ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 px-5 py-3">
        <Chip active={status === ""} onClick={() => changeFilter(() => setStatus(""))}>
          Todas
        </Chip>
        {RUN_STATUSES.map((value) => (
          <Chip
            key={value}
            active={status === value}
            onClick={() => changeFilter(() => setStatus(value))}
          >
            {RUN_STATUS_LABEL[value]}
          </Chip>
        ))}

        <div className="ml-auto w-[220px]">
          <Select
            value={projectId}
            inputSize="sm"
            onChange={(e) => {
              const next = e.target.value;
              changeFilter(() => setProjectId(next));
            }}
          >
            <option value="">Todos los proyectos</option>
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={18} />
        </div>
      ) : runs.length === 0 ? (
        <EmptyState
          icon="terminal"
          title="No hay runs que mostrar"
          hint={
            status || projectId
              ? "Prueba a quitar los filtros."
              : "Lanza una tarea desde el kanban de un proyecto y aparecerá aquí."
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[130px_minmax(0,1fr)_180px_90px_80px_70px_90px] items-center gap-3 border-b border-border-1 bg-bg-2 px-5 py-2 text-2xs uppercase tracking-[.06em] text-txt-3">
            <span>Estado</span>
            <span>Tarea</span>
            <span>Agente</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Coste</span>
            <span className="text-right">Duración</span>
            <span className="text-right">Cuándo</span>
          </div>

          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}

          <div className="flex items-center justify-center gap-3 px-5 py-4 text-xs text-txt-3">
            <span>
              {runs.length} de {total} {total === 1 ? "run" : "runs"}
            </span>
            {runs.length < total && (
              <Button
                variant="subtle"
                size="xs"
                icon="chevronDown"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
              >
                Cargar más
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
