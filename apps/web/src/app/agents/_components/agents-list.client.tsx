"use client";

import { useState, type ReactElement } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Bot, Plus } from "lucide-react";
import type { AgentWithStats } from "~/lib/api";
import { agents } from "~/lib/api";
import { AgentAvatar } from "~/components/ui/agent-avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { formatCost } from "~/lib/format";

function AgentCard({ agent }: { agent: AgentWithStats }): ReactElement {
  const totalCost = agent.skills.reduce(() => 0, 0); // cost comes from runs
  const runsCount = agent._count.runs;

  return (
    <Link
      href={`/agents/${agent.id}`}
      className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-2 p-4 transition-colors hover:border-border-3 hover:bg-bg-3"
    >
      <div className="flex items-center gap-3">
        <AgentAvatar agentId={agent.id} name={agent.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-1">{agent.name}</p>
          <Badge variant="default" className="mt-1">
            {agent.role}
          </Badge>
        </div>
        <Badge
          variant={
            agent.status === "running"
              ? "blue"
              : agent.status === "idle"
                ? "ghost"
                : "default"
          }
        >
          {agent.status}
        </Badge>
      </div>

      <div className="flex items-center gap-4 border-t border-border-1 pt-3 text-xs text-text-3">
        <span>{runsCount} run{runsCount !== 1 ? "s" : ""}</span>
        <span>{agent.skills.length} skill{agent.skills.length !== 1 ? "s" : ""}</span>
        {agent.maxBudgetUsd ? (
          <span>Budget: {formatCost(agent.maxBudgetUsd)}</span>
        ) : null}
      </div>
    </Link>
  );
}

export function AgentsList(): ReactElement {
  const { data, error, isLoading, mutate } = useSWR(
    "/agents",
    () => agents.list(),
    { refreshInterval: 0 },
  );

  return (
    <>
      <div className="flex items-center justify-between px-6 pb-4 pt-6">
        <h1 className="text-base font-semibold text-text-1">Agentes</h1>
        <Link href="/agents/new">
          <Button variant="primary" size="sm">
            <Plus size={13} />
            Nuevo agente
          </Button>
        </Link>
      </div>

      <div className="px-6 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner className="text-text-3" size={20} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <p className="text-sm text-red">No se pudo conectar con la API</p>
            <Button variant="ghost" size="sm" onClick={() => void mutate()}>
              Reintentar
            </Button>
          </div>
        ) : data?.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <Bot size={40} className="text-text-3" />
            <div>
              <p className="text-sm font-medium text-text-1">Sin agentes</p>
              <p className="mt-1 text-xs text-text-3">
                Crea tu primer agente para comenzar
              </p>
            </div>
            <Link href="/agents/new">
              <Button variant="primary" size="sm">
                <Plus size={13} />
                Nuevo agente
              </Button>
            </Link>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
          >
            {(data ?? []).map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
