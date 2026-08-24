"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSWRConfig } from "swr";

import { COLUMNS, COLUMN_LABEL } from "./columns";
import { NewTaskModal } from "./new-task-modal.client";
import { SortableTaskCard, TaskCardBody } from "./task-card.client";
import { TaskDrawer } from "./task-drawer.client";
import { Icon } from "@/components/ui/icon";
import { Button, EmptyState, Kbd, StatusDot, cn } from "@/components/ui/primitives.client";
import { useToast } from "@/components/ui/toast.client";
import {
  cancelRun as apiCancelRun,
  deleteTask,
  moveTask,
  runTask,
  updateTask,
} from "@/lib/api";
import { keys, useAgents, useBoardStream, useSkills, useTasks } from "@/lib/hooks";

import type { ReactElement } from "react";
import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import type { Project, Task, TaskStatus } from "@/lib/types";

/**
 * closestCorners resuelve la columna por el rectángulo de la tarjeta, no por el
 * cursor: al arrastrar cerca de un borde la tarjeta cae en la columna de al
 * lado. Priorizamos el puntero y solo caemos a las esquinas cuando el cursor
 * está fuera de cualquier columna (p. ej. arrastrando por encima del tablero).
 */
const collisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  return byPointer.length > 0 ? byPointer : closestCorners(args);
};

function Column({
  status,
  label,
  color,
  tasks,
  skills,
  compact,
  onSelect,
  onAdd,
}: {
  status: TaskStatus;
  label: string;
  color: string;
  tasks: Task[];
  skills: ReturnType<typeof useSkills>["data"];
  compact: boolean;
  onSelect: (task: Task) => void;
  onAdd: (status: TaskStatus) => void;
}): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });

  return (
    <div className="flex h-full w-60 shrink-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center gap-2 px-0.5">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} />
        <span className="text-sm font-semibold tracking-[.02em] text-txt-2">{label}</span>
        <span className="text-xs text-txt-3">{tasks.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-1 flex-col gap-1.5 overflow-y-auto rounded-lg border-[1.5px] p-1 transition-colors",
          isOver ? "border-dashed border-accent/40 bg-accent/[.05]" : "border-transparent",
        )}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              skills={skills ?? []}
              compact={compact}
              onSelect={onSelect}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="px-2 py-5 text-center text-xs text-txt-3">
            {status === "todo" ? "Sin tareas" : "—"}
          </div>
        )}

        <button
          type="button"
          onClick={() => onAdd(status)}
          className="mt-0.5 flex items-center gap-1.5 rounded-md border border-dashed border-border-2 px-2 py-1.5 text-xs text-txt-3 transition-colors hover:border-border-3 hover:text-txt-2"
        >
          <Icon name="plus" size={11} /> Añadir tarea
        </button>
      </div>
    </div>
  );
}

export function KanbanView({ project }: { project: Project }): ReactElement {
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const { data: tasks, error, isLoading } = useTasks(project.id);
  const { data: agents } = useAgents();
  const { data: skills } = useSkills();
  useBoardStream(project.id);

  const [board, setBoard] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const [addingTo, setAddingTo] = useState<TaskStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // El servidor manda; el estado local solo existe para que el drag se vea
  // instantáneo antes de que la revalidación traiga el orden definitivo.
  useEffect(() => {
    if (tasks) setBoard(tasks);
  }, [tasks]);

  const byStatus = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      todo: [],
      in_progress: [],
      review: [],
      done: [],
      blocked: [],
    };
    for (const task of board) groups[task.status]?.push(task);
    for (const status of Object.keys(groups) as TaskStatus[]) {
      groups[status].sort((a, b) => a.position - b.position);
    }
    return groups;
  }, [board]);

  const selected = board.find((t) => t.id === selectedId) ?? null;
  const draggingTask = board.find((t) => t.id === draggingId) ?? null;

  const sensors = useSensors(
    // Sin distancia mínima el click para abrir el drawer se interpreta como drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const statusOf = useCallback(
    (id: string): TaskStatus | null => {
      if (id.startsWith("column:")) return id.slice("column:".length) as TaskStatus;
      return board.find((t) => t.id === id)?.status ?? null;
    },
    [board],
  );

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const from = statusOf(String(active.id));
    const to = statusOf(String(over.id));
    if (!from || !to || from === to) return;

    // Reubicamos en local para que la tarjeta se vea ya en la columna destino.
    setBoard((current) =>
      current.map((task) =>
        task.id === active.id ? { ...task, status: to, position: Number.MAX_SAFE_INTEGER } : task,
      ),
    );
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggingId(null);
    if (!over) return;

    const taskId = String(active.id);
    const target = statusOf(String(over.id));
    if (!target) return;

    const column = byStatus[target].filter((t) => t.id !== taskId);
    const overIndex = column.findIndex((t) => t.id === String(over.id));
    const insertAt = overIndex === -1 ? column.length : overIndex;
    const ordered = [...column.slice(0, insertAt), board.find((t) => t.id === taskId)!, ...column.slice(insertAt)];

    setBoard((current) =>
      current.map((task) => {
        const index = ordered.findIndex((t) => t.id === task.id);
        return index === -1 ? task : { ...task, status: target, position: index };
      }),
    );

    try {
      // El endpoint /move fija la posición de una sola task sin renumerar a sus
      // hermanas, así que reenumeramos la columna entera para evitar empates.
      await Promise.all(ordered.map((task, index) => moveTask(task.id, target, index)));
      await mutate(keys.tasks(project.id));
      await mutate(keys.projects);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo mover la tarea", "error");
      await mutate(keys.tasks(project.id));
    }
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Algo ha fallado", "error");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    await mutate(keys.tasks(project.id));
    await mutate(keys.projects);
    await mutate(keys.queue);
  };

  const activeRuns = byStatus.in_progress.length;

  if (error) {
    return (
      <div className="p-7">
        <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">
          <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
          <span>No se pudieron cargar las tareas: {String(error.message ?? error)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border-1 bg-bg-2 px-4 py-2.5">
          <div
            className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-xs text-txt-3"
            title={project.repoPath}
          >
            <Icon name="folder" size={10} />
            <span className="truncate-1">{project.repoPath}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {activeRuns > 0 && (
              <span className="flex items-center gap-1.5 rounded-sm border border-info/20 bg-info-dim px-2 py-0.5 text-xs font-medium text-info">
                <StatusDot status="running" pulse />
                {activeRuns} en curso
              </span>
            )}
            <Button
              variant={compact ? "default" : "subtle"}
              size="xs"
              icon="layers"
              onClick={() => setCompact((c) => !c)}
            >
              {compact ? "Expandir" : "Compacto"}
            </Button>
            <Button variant="subtle" size="xs" icon="refresh" onClick={() => void refresh()}>
              Refrescar
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-7 text-sm text-txt-3">Cargando tablero…</div>
        ) : board.length === 0 ? (
          <EmptyState
            icon="layers"
            title="El tablero está vacío"
            hint="Crea una tarea, asígnale un agente y arrástrala para lanzarla."
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={() => setAddingTo("todo")}>
                Nueva tarea
              </Button>
            }
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={(e: DragStartEvent) => setDraggingId(String(e.active.id))}
            onDragOver={handleDragOver}
            onDragEnd={(e) => void handleDragEnd(e)}
            onDragCancel={() => setDraggingId(null)}
          >
            <div className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden p-4">
              {COLUMNS.map((col) => (
                <Column
                  key={col.id}
                  status={col.id}
                  label={col.label}
                  color={col.color}
                  tasks={byStatus[col.id]}
                  skills={skills}
                  compact={compact}
                  onSelect={(task) => setSelectedId(task.id)}
                  onAdd={setAddingTo}
                />
              ))}
            </div>

            <DragOverlay>
              {draggingTask && (
                <div className="w-60 rotate-1 opacity-90">
                  <TaskCardBody task={draggingTask} skills={skills ?? []} compact={compact} dragging />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-border-1 bg-bg-2 px-4 py-1.5 text-2xs text-txt-3">
          <Kbd>Ctrl K</Kbd> buscar
          <span className="text-border-3">·</span>
          Arrastra una tarjeta para cambiarla de columna
        </div>
      </div>

      {selected && (
        <TaskDrawer
          task={selected}
          agents={agents ?? []}
          skills={skills ?? []}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onRun={(agentId) =>
            void withBusy(async () => {
              await runTask(selected.id, agentId);
              toast(`Run lanzada para “${selected.title}”`, "success");
              await refresh();
            })
          }
          onCancel={(runId) =>
            void withBusy(async () => {
              const { ok } = await apiCancelRun(runId);
              toast(ok ? "Run cancelada" : "La run ya no estaba activa", ok ? "success" : "warn");
              await refresh();
            })
          }
          onMove={(status) =>
            void withBusy(async () => {
              await moveTask(selected.id, status, byStatus[status].length);
              toast(`Movida a ${COLUMN_LABEL[status]}`, "success");
              await refresh();
            })
          }
          onAssign={(agentId) =>
            void withBusy(async () => {
              await updateTask(selected.id, { assignedAgentId: agentId });
              await refresh();
            })
          }
          onDelete={() =>
            void withBusy(async () => {
              await deleteTask(selected.id);
              setSelectedId(null);
              toast("Tarea eliminada", "success");
              await refresh();
            })
          }
        />
      )}

      <NewTaskModal
        projectId={project.id}
        status={addingTo}
        agents={agents ?? []}
        onClose={() => setAddingTo(null)}
        onCreated={() => void refresh()}
      />
    </div>
  );
}
