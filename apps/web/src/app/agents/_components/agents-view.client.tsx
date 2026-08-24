"use client";

import { useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";

import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal.client";
import {
  AgentAvatar,
  Badge,
  Button,
  Chip,
  EmptyState,
} from "@/components/ui/primitives.client";
import { useToast } from "@/components/ui/toast.client";
import { deleteAgent } from "@/lib/api";
import { formatCost, formatRelative } from "@/lib/format";
import { keys, useAgents } from "@/lib/hooks";

import type { ReactElement } from "react";
import type { Agent } from "@/lib/types";

function AgentCard({ agent, onDelete }: { agent: Agent; onDelete: () => void }): ReactElement {
  const skills = agent.skills ?? [];
  // TaskRun.agent no declara onDelete: Cascade, así que Prisma rechaza el
  // borrado en cuanto el agente tiene una run. Mejor no ofrecerlo.
  const runCount = agent._count?.runs ?? 0;
  const deletable = runCount === 0;

  return (
    <div className="flex flex-col rounded-lg border border-border-1 bg-bg-3 p-4 transition-colors hover:border-border-3">
      <div className="mb-3 flex items-start gap-2.5">
        <AgentAvatar name={agent.name} size={32} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/agents/${agent.id}`}
            className="text-md font-semibold text-txt-1 transition-colors hover:text-accent"
          >
            {agent.name}
          </Link>
          <div className="truncate-1 text-sm text-txt-2">{agent.role}</div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={!deletable}
          aria-label={`Borrar ${agent.name}`}
          title={
            deletable
              ? `Borrar ${agent.name}`
              : `No se puede borrar: tiene ${runCount} ${runCount === 1 ? "run" : "runs"} en el historial`
          }
          className="flex shrink-0 rounded p-1 text-txt-3 transition-colors hover:bg-bg-5 hover:text-danger disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-txt-3"
        >
          <Icon name="trash" size={12} />
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="accent" size="xs">
          <Icon name="bot" size={9} />
          {agent.model}
        </Badge>
        {agent.maxBudgetUsd != null && (
          <Badge variant="ghost" size="xs">
            <Icon name="dollar" size={9} />
            tope {formatCost(agent.maxBudgetUsd)}
          </Badge>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {skills.length === 0 ? (
          <span className="text-xs text-txt-3">Sin skills asignadas</span>
        ) : (
          skills.slice(0, 4).map(({ skill }) => (
            <Chip key={skill.id}>{skill.name}</Chip>
          ))
        )}
        {skills.length > 4 && (
          <span className="self-center text-xs text-txt-3">+{skills.length - 4}</span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border-1 pt-2.5">
        <span className="flex items-center gap-1 text-xs text-txt-3">
          <Icon name="activity" size={10} />
          {agent._count?.runs ?? 0} runs
        </span>
        <span className="flex items-center gap-1 text-xs text-txt-3">
          <Icon name="clock" size={10} />
          {formatRelative(agent.updatedAt)}
        </span>
      </div>
    </div>
  );
}

export function AgentsView(): ReactElement {
  const { data: agents, error, isLoading } = useAgents();
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteAgent(pendingDelete.id);
      await mutate(keys.agents);
      toast(`Agente "${pendingDelete.name}" borrado`, "success");
      setPendingDelete(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo borrar el agente", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-txt-1">Agentes</h1>
          <p className="text-sm text-txt-3">
            {isLoading
              ? "Cargando…"
              : `${agents?.length ?? 0} ${agents?.length === 1 ? "plantilla" : "plantillas"} de ejecución`}
          </p>
        </div>
        <Link href="/agents/new">
          <Button variant="primary" size="sm" icon="plus">
            Nuevo agente
          </Button>
        </Link>
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

      {!isLoading && !error && !agents?.length && (
        <EmptyState
          icon="bot"
          title="Todavía no hay agentes"
          hint="Un agente es una plantilla: modelo, prompt de sistema y las skills que puede usar. Las tareas del kanban se ejecutan con uno de ellos."
          action={
            <Link href="/agents/new">
              <Button variant="primary" size="sm" icon="plus">
                Crear el primero
              </Button>
            </Link>
          }
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        {agents?.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onDelete={() => setPendingDelete(agent)}
          />
        ))}
      </div>

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Borrar agente"
        footer={
          <>
            <Button variant="danger" size="sm" onClick={confirmDelete} loading={deleting}>
              Borrar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
              Cancelar
            </Button>
          </>
        }
      >
        <p className="text-sm text-txt-2">
          Se borrará <span className="font-medium text-txt-1">{pendingDelete?.name}</span> y sus
          asignaciones de skills. Las tareas que lo tengan asignado se quedarán sin agente.
        </p>
      </Modal>
    </div>
  );
}
