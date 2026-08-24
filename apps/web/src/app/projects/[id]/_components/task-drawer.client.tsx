"use client";

import { useState, useEffect, type ReactElement, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X, Play, Square, ChevronRight, Clock } from "lucide-react";
import type { TaskWithLatestRun, TaskStatus, TaskRun } from "@agent-manager/types";
import type { AgentWithStats, SkillWithParsedTags } from "~/lib/api";
import { tasks, runs } from "~/lib/api";
import { AgentAvatar } from "~/components/ui/agent-avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import { formatRelative, formatCost, formatTokens } from "~/lib/format";
import { isActiveRun } from "~/lib/api";

type Props = {
  task: TaskWithLatestRun;
  agents: AgentWithStats[];
  allSkills: SkillWithParsedTags[];
  onClose: () => void;
  onUpdated: () => void;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "Por hacer",
  in_progress: "En progreso",
  review: "En revisión",
  done: "Hecho",
  blocked: "Bloqueado",
};

const STATUS_BADGE_VARIANT = {
  todo: "default",
  in_progress: "blue",
  review: "yellow",
  done: "green",
  blocked: "red",
} as const;

function parseIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function RunItem({ run }: { run: TaskRun }): ReactElement {
  return (
    <div className="flex items-center gap-2 rounded border border-border-1 bg-bg-4 px-3 py-2">
      <StatusDot status={run.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-text-1 capitalize">
            {run.status}
          </span>
          <span className="text-xs text-text-3">{formatRelative(run.startedAt)}</span>
        </div>
        <div className="mt-0.5 flex gap-3 text-xs text-text-3">
          <span>{formatTokens(run.inputTokens + run.outputTokens)} tokens</span>
          <span>{formatCost(run.costUsd)}</span>
        </div>
      </div>
    </div>
  );
}

export function TaskDrawer(props: Props): ReactElement {
  const { task, agents, allSkills, onClose, onUpdated } = props;

  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(task.description);
  const [editAgentId, setEditAgentId] = useState(task.assignedAgentId ?? "");
  const [editSkillIds, setEditSkillIds] = useState<string[]>(
    parseIds(task.requiredSkillIds),
  );

  const latestRun = task.runs[0] ?? null;
  const runIsActive = latestRun ? isActiveRun(latestRun.status) : false;

  // Sync state when task changes (e.g., after SSE update)
  useEffect(() => {
    if (!isEditing) {
      setEditTitle(task.title);
      setEditDescription(task.description);
      setEditAgentId(task.assignedAgentId ?? "");
      setEditSkillIds(parseIds(task.requiredSkillIds));
    }
  }, [task, isEditing]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await tasks.update(task.id, {
        title: editTitle,
        description: editDescription,
        assignedAgentId: editAgentId || null,
        requiredSkillIds: editSkillIds,
      });
      setIsEditing(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    }
  }

  async function handleRun() {
    setIsRunning(true);
    setError(null);
    try {
      const { runId } = await tasks.run(task.id);
      onUpdated();
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al lanzar la run");
      setIsRunning(false);
    }
  }

  async function handleCancel() {
    if (!latestRun) return;
    setIsCancelling(true);
    try {
      await runs.cancel(latestRun.id);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cancelar");
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleMove(newStatus: TaskStatus) {
    setIsMoving(true);
    try {
      await tasks.move(task.id, newStatus, 0);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al mover la tarea");
    } finally {
      setIsMoving(false);
    }
  }

  function toggleSkill(skillId: string) {
    setEditSkillIds((prev) =>
      prev.includes(skillId)
        ? prev.filter((id) => id !== skillId)
        : [...prev, skillId],
    );
  }

  const nextStatuses: TaskStatus[] = (
    ["todo", "in_progress", "review", "done", "blocked"] as TaskStatus[]
  ).filter((s) => s !== task.status);

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-border-2 bg-bg-2 shadow-lg">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-1 px-4 py-3">
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_BADGE_VARIANT[task.status]}>
              {STATUS_LABELS[task.status]}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {!isEditing ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setIsEditing(true)}
              >
                Editar
              </Button>
            ) : null}
            <button
              onClick={onClose}
              className="rounded p-1 text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {isEditing ? (
            <form
              onSubmit={(e) => void handleSave(e)}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-2">Título</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  className={cn(
                    "w-full rounded border border-border-2 bg-bg-3 px-3 py-2 text-sm text-text-1",
                    "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
                  )}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-2">Descripción</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  className={cn(
                    "w-full resize-none rounded border border-border-2 bg-bg-3 px-3 py-2 text-sm text-text-1",
                    "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
                  )}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-2">
                  Agente asignado
                </label>
                <select
                  value={editAgentId}
                  onChange={(e) => setEditAgentId(e.target.value)}
                  className={cn(
                    "w-full rounded border border-border-2 bg-bg-3 px-3 py-2 text-sm text-text-1",
                    "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
                  )}
                >
                  <option value="">Sin agente</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              {allSkills.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-text-2">
                    Skills requeridas
                  </label>
                  <div className="flex flex-col gap-1">
                    {allSkills.map((skill) => (
                      <label
                        key={skill.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-text-1 transition-colors hover:bg-bg-hover"
                      >
                        <input
                          type="checkbox"
                          checked={editSkillIds.includes(skill.id)}
                          onChange={() => toggleSkill(skill.id)}
                          className="accent-accent"
                        />
                        {skill.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {error ? (
                <p className="text-xs text-red" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-2">
                <Button variant="primary" size="sm" type="submit">
                  Guardar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setError(null);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-5">
              {/* Título y descripción */}
              <div>
                <h2 className="text-sm font-semibold text-text-1">{task.title}</h2>
                {task.description ? (
                  <p className="mt-2 text-xs leading-relaxed text-text-2">
                    {task.description}
                  </p>
                ) : (
                  <p className="mt-2 text-xs italic text-text-3">
                    Sin descripción
                  </p>
                )}
              </div>

              {/* Agente */}
              {task.assignedAgent ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-text-3">Agente</p>
                  <div className="flex items-center gap-2">
                    <AgentAvatar
                      agentId={task.assignedAgent.id}
                      name={task.assignedAgent.name}
                      size="sm"
                    />
                    <span className="text-sm text-text-1">
                      {task.assignedAgent.name}
                    </span>
                    <Badge variant="default">{task.assignedAgent.role}</Badge>
                  </div>
                </div>
              ) : null}

              {/* Skills */}
              {parseIds(task.requiredSkillIds).length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-text-3">Skills requeridas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {parseIds(task.requiredSkillIds).map((sid) => {
                      const skill = allSkills.find((s) => s.id === sid);
                      return (
                        <Badge key={sid} variant="accent">
                          {skill?.name ?? sid.slice(0, 8)}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Cambiar estado */}
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-text-3">Mover a</p>
                <div className="flex flex-wrap gap-1.5">
                  {nextStatuses.map((s) => (
                    <Button
                      key={s}
                      variant="subtle"
                      size="xs"
                      isLoading={isMoving}
                      onClick={() => void handleMove(s)}
                    >
                      <ChevronRight size={11} />
                      {STATUS_LABELS[s]}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Últimas runs */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-text-3">Ejecuciones</p>
                {task.runs.length === 0 ? (
                  <p className="text-xs text-text-3">
                    Sin ejecuciones todavía
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {task.runs.slice(0, 5).map((run) => (
                      <RunItem key={run.id} run={run} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer — acciones */}
        {!isEditing ? (
          <div className="shrink-0 border-t border-border-1 px-4 py-3">
            {error ? (
              <p className="mb-2 text-xs text-red" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              {runIsActive ? (
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={isCancelling}
                  onClick={() => void handleCancel()}
                  className="flex-1"
                >
                  <Square size={12} />
                  Cancelar ejecución
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={isRunning}
                  onClick={() => void handleRun()}
                  disabled={!task.assignedAgentId}
                  className="flex-1"
                >
                  <Play size={12} />
                  Ejecutar ahora
                </Button>
              )}
            </div>
            {!task.assignedAgentId && !runIsActive ? (
              <p className="mt-1.5 text-center text-xs text-text-3">
                Asigna un agente para ejecutar
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
