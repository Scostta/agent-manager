"use client";

import { useState, type ReactElement } from "react";
import useSWR from "swr";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { TaskStatus, TaskWithLatestRun } from "@agent-manager/types";
import type { AgentWithStats, SkillWithParsedTags } from "~/lib/api";
import { tasks as tasksApi } from "~/lib/api";
import { useBoardStream } from "~/hooks/use-board-stream";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/cn";
import { TaskCard } from "./task-card.client";
import { AddTaskForm } from "./add-task-form.client";
import { TaskDrawer } from "./task-drawer.client";

type Props = {
  projectId: string;
  agents: AgentWithStats[];
  allSkills: SkillWithParsedTags[];
};

const COLUMNS: { status: TaskStatus; label: string; colorClass: string }[] = [
  { status: "todo", label: "Por hacer", colorClass: "text-text-2" },
  { status: "in_progress", label: "En progreso", colorClass: "text-blue" },
  { status: "review", label: "Revisión", colorClass: "text-yellow" },
  { status: "done", label: "Hecho", colorClass: "text-green" },
  { status: "blocked", label: "Bloqueado", colorClass: "text-red" },
];

function KanbanColumn({
  status,
  label,
  colorClass,
  tasks,
  projectId,
  agents,
  allSkills,
  onTaskClick,
  onTaskCreated,
}: {
  status: TaskStatus;
  label: string;
  colorClass: string;
  tasks: TaskWithLatestRun[];
  projectId: string;
  agents: AgentWithStats[];
  allSkills: SkillWithParsedTags[];
  onTaskClick: (task: TaskWithLatestRun) => void;
  onTaskCreated: () => void;
}): ReactElement {
  const taskIds = tasks.map((t) => t.id);

  return (
    <div className="flex w-[260px] shrink-0 flex-col rounded-lg border border-border-1 bg-bg-2">
      {/* Column header */}
      <div className="flex items-center justify-between border-b border-border-1 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-semibold uppercase tracking-wide", colorClass)}>
            {label}
          </span>
          <span className="rounded bg-bg-4 px-1.5 py-0.5 text-xs text-text-3">
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Task list */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              allSkills={allSkills}
              onClick={() => onTaskClick(task)}
            />
          ))}
        </div>
      </SortableContext>

      {/* Add task */}
      <div className="border-t border-border-1 p-2">
        <AddTaskForm
          projectId={projectId}
          status={status}
          agents={agents}
          onCreated={onTaskCreated}
        />
      </div>
    </div>
  );
}

export function KanbanBoard(props: Props): ReactElement {
  const { projectId, agents, allSkills } = props;

  const { data, error, isLoading, mutate } = useSWR(
    `/projects/${projectId}/tasks`,
    () => tasksApi.list(projectId),
    { refreshInterval: 0 },
  );

  useBoardStream(mutate);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskWithLatestRun | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(event.active.id as string);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Determine which column the task was dropped into
    const taskList = data ?? [];
    const draggedTask = taskList.find((t) => t.id === active.id);
    const overTask = taskList.find((t) => t.id === over.id);
    if (!draggedTask) return;

    // If over another task in a different status column, move to that status
    if (overTask && overTask.status !== draggedTask.status) {
      await tasksApi.move(draggedTask.id, overTask.status, overTask.position);
      await mutate();
    }
  }

  const allTasks = data ?? [];
  const draggingTask = draggingId
    ? allTasks.find((t) => t.id === draggingId) ?? null
    : null;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-text-3" size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-red">Error al cargar las tareas</p>
        <button
          onClick={() => void mutate()}
          className="text-xs text-text-3 underline hover:text-text-2"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={(e) => void handleDragEnd(e)}
      >
        <div className="flex h-full gap-4 overflow-x-auto p-4">
          {COLUMNS.map((col) => {
            const colTasks = allTasks
              .filter((t) => t.status === col.status)
              .sort((a, b) => a.position - b.position);

            return (
              <KanbanColumn
                key={col.status}
                status={col.status}
                label={col.label}
                colorClass={col.colorClass}
                tasks={colTasks}
                projectId={projectId}
                agents={agents}
                allSkills={allSkills}
                onTaskClick={(task) => setSelectedTask(task)}
                onTaskCreated={() => void mutate()}
              />
            );
          })}
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {draggingTask ? (
            <div className="w-[244px] rotate-2 cursor-grabbing rounded-lg border border-accent/50 bg-bg-3 p-3 opacity-90 shadow-lg">
              <p className="text-sm font-medium text-text-1">
                {draggingTask.title}
              </p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Task drawer */}
      {selectedTask ? (
        <TaskDrawer
          task={selectedTask}
          agents={agents}
          allSkills={allSkills}
          onClose={() => setSelectedTask(null)}
          onUpdated={() => {
            void mutate();
            setSelectedTask(null);
          }}
        />
      ) : null}
    </>
  );
}
