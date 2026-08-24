import type { TaskStatus } from "@/lib/types";

export const COLUMNS: {
  id: TaskStatus;
  label: string;
  color: string;
  badge: "default" | "blue" | "yellow" | "green" | "red";
}[] = [
  { id: "todo", label: "Todo", color: "var(--text-3)", badge: "default" },
  { id: "in_progress", label: "En curso", color: "var(--blue)", badge: "blue" },
  { id: "review", label: "Revisión", color: "var(--yellow)", badge: "yellow" },
  { id: "done", label: "Hecho", color: "var(--green)", badge: "green" },
  { id: "blocked", label: "Bloqueado", color: "var(--red)", badge: "red" },
];

export const COLUMN_LABEL: Record<TaskStatus, string> = COLUMNS.reduce(
  (acc, col) => ({ ...acc, [col.id]: col.label }),
  {} as Record<TaskStatus, string>,
);

export const PRIORITY_DOT: Record<number, string> = {
  2: "var(--red)",
  1: "var(--yellow)",
  0: "var(--text-3)",
};

export const PRIORITY_LABEL: Record<number, string> = {
  2: "Alta",
  1: "Media",
  0: "Baja",
};
