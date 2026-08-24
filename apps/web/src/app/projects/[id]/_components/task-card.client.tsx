"use client";

import { type ReactElement } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle, XCircle } from "lucide-react";
import type { TaskWithLatestRun } from "@agent-manager/types";
import type { SkillWithParsedTags } from "~/lib/api";
import { AgentAvatar } from "~/components/ui/agent-avatar";
import { Badge } from "~/components/ui/badge";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import { formatRelative } from "~/lib/format";
import { isActiveRun } from "~/lib/api";

type Props = {
  task: TaskWithLatestRun;
  allSkills: SkillWithParsedTags[];
  onClick: () => void;
};

function parseSkillIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function TaskCard(props: Props): ReactElement {
  const { task, allSkills, onClick } = props;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const latestRun = task.runs[0] ?? null;
  const runIsActive = latestRun ? isActiveRun(latestRun.status) : false;
  const skillIds = parseSkillIds(task.requiredSkillIds);
  const visibleSkills = skillIds.slice(0, 2);
  const hiddenCount = skillIds.length - visibleSkills.length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "group cursor-grab rounded-lg border border-border-2 bg-bg-3 p-3 transition-colors",
        "hover:border-border-3 hover:bg-bg-4",
        "active:cursor-grabbing",
        isDragging && "opacity-50 ring-1 ring-accent",
      )}
    >
      {/* Título */}
      <p className="text-sm font-medium text-text-1 leading-snug">{task.title}</p>

      {/* Agente asignado */}
      {task.assignedAgent ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          <AgentAvatar
            agentId={task.assignedAgent.id}
            name={task.assignedAgent.name}
            size="xs"
          />
          <span className="text-xs text-text-2">{task.assignedAgent.name}</span>
        </div>
      ) : null}

      {/* Estado de la run */}
      {latestRun ? (
        <div className="mt-2 flex items-center gap-1.5">
          {runIsActive ? (
            <>
              <StatusDot status={latestRun.status} />
              <span className="text-xs text-blue">ejecutando</span>
            </>
          ) : latestRun.status === "succeeded" ? (
            <>
              <CheckCircle size={12} className="text-green" />
              <span className="text-xs text-text-3">
                {formatRelative(latestRun.endedAt)}
              </span>
            </>
          ) : latestRun.status === "failed" || latestRun.status === "cancelled" ? (
            <>
              <XCircle size={12} className="text-red" />
              <span className="text-xs text-text-3">
                {formatRelative(latestRun.endedAt)}
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Skills */}
      {visibleSkills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {visibleSkills.map((sid) => {
            const skill = allSkills.find((s) => s.id === sid);
            return (
              <Badge key={sid} variant="ghost">
                {skill?.name ?? sid.slice(0, 8)}
              </Badge>
            );
          })}
          {hiddenCount > 0 ? (
            <Badge variant="ghost">+{hiddenCount}</Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
