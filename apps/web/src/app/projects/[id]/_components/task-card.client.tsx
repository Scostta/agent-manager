"use client";

import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";

import { PRIORITY_DOT } from "./columns";
import { Icon } from "@/components/ui/icon";
import { AgentAvatar, Chip, StatusDot, cn } from "@/components/ui/primitives.client";
import { formatCost, formatDuration, formatRelative, formatTokens } from "@/lib/format";
import { isActiveRun, latestRun } from "@/lib/types";

import type { ReactElement } from "react";
import type { Skill, Task } from "@/lib/types";

export function TaskCardBody({
  task,
  skills,
  compact,
  dragging,
}: {
  task: Task;
  skills: Skill[];
  compact?: boolean;
  dragging?: boolean;
}): ReactElement {
  const run = latestRun(task);
  const active = isActiveRun(run);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active || !run) return;
    const startedAt = Date.parse(run.startedAt);
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [active, run]);

  const taskSkills = skills.filter((s) => task.requiredSkillIds.includes(s.id));
  const shown = compact ? [] : taskSkills.slice(0, 2);

  return (
    <div
      className={cn(
        "rounded-lg border bg-bg-3 transition-colors",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
        active ? "border-info/30" : "border-border-1",
        !dragging && "hover:border-border-3 hover:bg-bg-4",
      )}
    >
      <div className={cn("flex items-start gap-1.5", compact ? "mb-1" : "mb-2")}>
        <span
          className="mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: PRIORITY_DOT[task.priority] ?? PRIORITY_DOT[0] }}
        />
        <span className="flex-1 text-sm font-medium leading-snug text-txt-1">
          {task.title}
        </span>
      </div>

      {active && run && (
        <div className="mb-2 flex items-center gap-1.5 rounded-sm border border-info/20 bg-info-dim px-1.5 py-1">
          <StatusDot status="running" pulse />
          <span className="text-2xs font-medium text-info">
            {run.status === "queued" ? "en cola" : formatDuration(elapsed)}
          </span>
          <span className="font-mono text-2xs text-txt-3">
            {formatTokens(run.inputTokens + run.outputTokens)} tok
          </span>
          <span className="ml-auto font-mono text-2xs font-semibold text-info">
            {formatCost(run.costUsd)}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {task.assignedAgent && (
          <span className="flex items-center gap-1.5">
            <AgentAvatar name={task.assignedAgent.name} size={16} />
            <span className="text-xs text-txt-3">{task.assignedAgent.name}</span>
          </span>
        )}
        {shown.map((skill) => (
          <Chip key={skill.id}>{skill.name}</Chip>
        ))}
        {!compact && taskSkills.length > shown.length && (
          <span className="text-2xs text-txt-3">+{taskSkills.length - shown.length}</span>
        )}
        {run && !active && (
          <span
            className={cn(
              "ml-auto flex items-center gap-1 text-2xs",
              run.status === "succeeded" ? "text-ok" : "text-danger",
            )}
          >
            <Icon name={run.status === "succeeded" ? "check" : "x"} size={9} />
            {formatRelative(run.endedAt)}
          </span>
        )}
      </div>

      {/* Acumulado de TODAS las runs: con reintentos, el gasto real de la task
          no es el de la última ejecución. */}
      {!compact && !active && task.totals.runs > 0 && (
        <div className="mt-2 flex items-center gap-2 border-t border-border-1 pt-1.5">
          <span className="font-mono text-2xs text-txt-3">
            {formatTokens(task.totals.totalTokens)} tok
          </span>
          <span className="font-mono text-2xs font-semibold text-txt-2">
            {formatCost(task.totals.costUsd)}
          </span>
          {task.totals.runs > 1 && (
            <span className="ml-auto text-2xs text-txt-3">{task.totals.runs} runs</span>
          )}
        </div>
      )}
    </div>
  );
}

export function SortableTaskCard({
  task,
  skills,
  compact,
  onSelect,
}: {
  task: Task;
  skills: Skill[];
  compact?: boolean;
  onSelect: (task: Task) => void;
}): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { status: task.status } });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        transition,
      }}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(task)}
      className={cn("cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <TaskCardBody task={task} skills={skills} compact={compact} dragging={isDragging} />
    </div>
  );
}
