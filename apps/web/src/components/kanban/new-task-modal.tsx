"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { createTask, moveTask } from "@/lib/api";
import { PRIORITY_MEDIUM, type Agent, type TaskStatus } from "@/lib/types";
import { COLUMN_LABEL, PRIORITY_LABEL } from "./columns";

export function NewTaskModal({
  projectId,
  status,
  agents,
  onClose,
  onCreated,
}: {
  projectId: string;
  status: TaskStatus | null;
  agents: Agent[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [priority, setPriority] = useState(PRIORITY_MEDIUM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status) {
      setTitle("");
      setDescription("");
      setAgentId("");
      setPriority(PRIORITY_MEDIUM);
    }
  }, [status]);

  const submit = async () => {
    if (!title.trim() || !status) return;
    setSaving(true);
    try {
      const task = await createTask({
        projectId,
        title: title.trim(),
        description: description.trim(),
        assignedAgentId: agentId || null,
        priority,
      });
      // La API siempre crea en 'todo'; si el usuario pulsó "+" en otra columna
      // la movemos justo después.
      if (status !== "todo") await moveTask(task.id, status, 0);
      toast("Tarea creada", "success");
      onCreated();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo crear la tarea", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!status}
      onClose={onClose}
      title={status ? `Nueva tarea en ${COLUMN_LABEL[status]}` : "Nueva tarea"}
      footer={
        <>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            loading={saving}
            disabled={!title.trim()}
          >
            Crear tarea
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-txt-2">Título</span>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Qué tiene que hacer el agente"
          inputSize="md"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-txt-2">Instrucciones</span>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Contexto y criterios de aceptación. Esto se le pasa al agente tal cual."
          rows={4}
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-txt-2">Agente</span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="h-[34px] w-full rounded-md border border-border-2 bg-bg-3 px-2.5 text-base text-txt-1 outline-none focus:border-accent"
          >
            <option value="">Sin asignar</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-32 flex-col gap-1.5">
          <span className="text-xs font-medium text-txt-2">Prioridad</span>
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="h-[34px] w-full rounded-md border border-border-2 bg-bg-3 px-2.5 text-base text-txt-1 outline-none focus:border-accent"
          >
            {[2, 1, 0].map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}
