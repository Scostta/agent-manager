"use client";

import { useState, type ReactElement, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import type { AgentWithStats } from "~/lib/api";
import { tasks } from "~/lib/api";
import type { TaskStatus } from "@agent-manager/types";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/cn";

type Props = {
  projectId: string;
  status: TaskStatus;
  agents: AgentWithStats[];
  onCreated: () => void;
};

export function AddTaskForm(props: Props): ReactElement {
  const { projectId, status, agents, onCreated } = props;
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const title = fd.get("title") as string;
    const description = fd.get("description") as string;
    const assignedAgentId = fd.get("agentId") as string | null;

    try {
      await tasks.create({
        projectId,
        title,
        description: description || "",
        assignedAgentId: assignedAgentId || null,
        status,
      } as Parameters<typeof tasks.create>[0]);
      onCreated();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear la tarea");
    } finally {
      setIsLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-text-3 transition-colors",
          "hover:bg-bg-hover hover:text-text-2",
        )}
      >
        <Plus size={12} />
        Añadir tarea
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-2 rounded-lg border border-border-2 bg-bg-3 p-3"
    >
      <Input
        name="title"
        placeholder="Título de la tarea"
        inputSize="sm"
        required
        autoFocus
      />
      <textarea
        name="description"
        placeholder="Descripción (opcional)"
        className={cn(
          "w-full resize-none rounded border border-border-2 bg-bg-4 px-2.5 py-1.5 text-xs text-text-1",
          "placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
        )}
        rows={2}
      />
      {agents.length > 0 ? (
        <select
          name="agentId"
          className={cn(
            "w-full rounded border border-border-2 bg-bg-4 px-2.5 py-1.5 text-xs text-text-1",
            "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
          )}
        >
          <option value="">Sin agente asignado</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      ) : null}

      {error ? (
        <p className="text-xs text-red" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button variant="primary" size="xs" type="submit" isLoading={isLoading}>
          Crear
        </Button>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onClick={() => setOpen(false)}
        >
          <X size={11} />
          Cancelar
        </Button>
      </div>
    </form>
  );
}
