"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { COLUMNS, PRIORITY_LABEL } from "./columns";
import { Icon } from "@/components/ui/icon";
import {
  AgentAvatar,
  Badge,
  Button,
  Chip,
  Divider,
  Select,
  StatusDot,
  cn,
} from "@/components/ui/primitives.client";
import { formatCost, formatDuration, formatRelative, formatTokens } from "@/lib/format";
import { useRuns } from "@/lib/hooks";
import { isActiveRun, latestRun } from "@/lib/types";

import type { ReactElement } from "react";
import type { Agent, RunListItem, Task } from "@/lib/types";

const STATUS_BADGE = {
  todo: "default",
  in_progress: "blue",
  review: "yellow",
  done: "green",
  blocked: "red",
} as const;

function RunMetrics({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <div className="text-2xs text-txt-3">{label}</div>
      <div className="font-mono text-sm font-semibold text-txt-1">{value}</div>
    </div>
  );
}

const PREVIOUS_ICON = {
  succeeded: { name: "check", color: "text-ok" },
  failed: { name: "x", color: "text-danger" },
  cancelled: { name: "stop", color: "text-txt-3" },
  running: { name: "refresh", color: "text-info" },
  queued: { name: "clock", color: "text-txt-3" },
} as const;

/** Fila compacta de un reintento anterior. La run más reciente se pinta aparte,
 *  con todo el detalle. */
function PreviousRun({ run }: { run: RunListItem }): ReactElement {
  const icon = PREVIOUS_ICON[run.status];
  return (
    <Link
      href={`/runs/${run.id}`}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-bg-hover"
    >
      <Icon name={icon.name} size={11} className={cn("shrink-0", icon.color)} />
      <span className="text-txt-3">{formatRelative(run.endedAt ?? run.startedAt)}</span>
      <span className="ml-auto tabular-nums text-txt-3">
        {formatTokens(run.inputTokens + run.outputTokens)} tok
      </span>
      <span className="w-14 text-right tabular-nums text-txt-2">
        {formatCost(run.costUsd)}
      </span>
    </Link>
  );
}

export function TaskDrawer({
  task,
  agents,
  busy,
  onClose,
  onRun,
  onCancel,
  onMove,
  onAssign,
  onDependenciesChange,
  siblings,
  onDelete,
}: {
  task: Task;
  agents: Agent[];
  busy: boolean;
  onClose: () => void;
  onRun: (agentId: string) => void;
  onCancel: (runId: string) => void;
  onMove: (status: Task["status"]) => void;
  onAssign: (agentId: string | null) => void;
  onDependenciesChange: (dependsOn: string[]) => void;
  /** Las demás tareas del proyecto, para elegir de cuáles depende. */
  siblings: Task[];
  onDelete: () => void;
}): ReactElement {
  const run = latestRun(task);
  const active = isActiveRun(run);
  // El board solo trae la run más reciente de cada task; los reintentos hay que
  // pedirlos aparte. Solo merece la pena si la task tiene más de una.
  const { data: history } = useRuns(task.totals.runs > 1 ? { taskId: task.id } : null);
  const previous =
    task.totals.runs > 1 ? (history?.runs ?? []).filter((item) => item.id !== run?.id) : [];
  // Una dependencia borrada no bloquea: si no está en la lista, está resuelta.
  const blocking = task.dependsOn
    .map((id) => siblings.find((candidate) => candidate.id === id))
    .filter((dep): dep is Task => !!dep && dep.status !== "done");
  const [agentId, setAgentId] = useState(task.assignedAgentId ?? "");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => setAgentId(task.assignedAgentId ?? ""), [task.assignedAgentId, task.id]);

  useEffect(() => {
    if (!active || !run) return;
    const startedAt = Date.parse(run.startedAt);
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [active, run]);

  const selectedAgent = agents.find((a) => a.id === agentId);

  return (
    <aside className="flex h-full w-[360px] shrink-0 animate-slide-right flex-col border-l border-border-1 bg-bg-2">
      <div className="flex shrink-0 items-center justify-between border-b border-border-1 px-3.5 py-3">
        <Badge variant={STATUS_BADGE[task.status]} size="sm" dot>
          {COLUMNS.find((c) => c.id === task.status)?.label ?? task.status}
        </Badge>
        <Button variant="ghost" size="xs" icon="x" onClick={onClose} aria-label="Cerrar" />
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-4">
        <h2 className="mb-2.5 text-md font-semibold leading-snug text-txt-1">{task.title}</h2>
        {task.description && (
          <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-txt-2">
            {task.description}
          </p>
        )}

        <div className="mb-4 flex items-center gap-2 text-xs text-txt-3">
          <Icon name="alertCircle" size={11} />
          Prioridad {PRIORITY_LABEL[task.priority] ?? "Baja"}
        </div>

        <Divider label="Agente" />
        <div className="my-3 flex flex-col gap-2">
          <Select
            value={agentId}
            inputSize="md"
            onChange={(e) => {
              const next = e.target.value;
              setAgentId(next);
              onAssign(next || null);
            }}
          >
            <option value="">Sin agente asignado</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} · {agent.model}
              </option>
            ))}
          </Select>
          {selectedAgent && (
            <div className="flex items-center gap-2.5 rounded-md border border-border-1 bg-bg-3 px-2.5 py-2">
              <AgentAvatar name={selectedAgent.name} color={selectedAgent.color} size={28} />
              <div className="min-w-0">
                <div className="text-base font-medium text-txt-1">{selectedAgent.name}</div>
                <div className="truncate-1 text-xs text-txt-3">
                  {selectedAgent.model}
                  {selectedAgent.maxBudgetUsd
                    ? ` · tope $${selectedAgent.maxBudgetUsd}`
                    : " · sin tope"}
                </div>
              </div>
            </div>
          )}
        </div>

        <Divider label="Depende de" />
        <div className="my-3 flex flex-col gap-1.5">
          {siblings.length === 0 ? (
            <span className="text-xs text-txt-3">
              No hay otras tareas en este proyecto de las que depender.
            </span>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {siblings.map((sibling) => {
                  const selected = task.dependsOn.includes(sibling.id);
                  return (
                    <Chip
                      key={sibling.id}
                      active={selected}
                      onClick={() =>
                        onDependenciesChange(
                          selected
                            ? task.dependsOn.filter((id) => id !== sibling.id)
                            : [...task.dependsOn, sibling.id],
                        )
                      }
                    >
                      {sibling.status === "done" && <Icon name="check" size={9} />}
                      {sibling.title}
                    </Chip>
                  );
                })}
              </div>
              {blocking.length > 0 && (
                <span className="text-2xs text-warn">
                  Bloqueada hasta que {blocking.length === 1 ? "termine" : "terminen"}:{" "}
                  {blocking.map((dep) => dep.title ?? dep.id).join(", ")}
                </span>
              )}
            </>
          )}
        </div>

        {task.totals.runs > 0 && (
          <>
            <Divider label="Gasto de la tarea" />
            <div className="my-3 rounded-md border border-border-1 bg-bg-3 px-2.5 py-2">
              <div className="flex gap-3">
                <RunMetrics label="Tokens" value={formatTokens(task.totals.totalTokens)} />
                <RunMetrics label="Coste" value={formatCost(task.totals.costUsd)} />
                <RunMetrics
                  label={task.totals.runs === 1 ? "Run" : "Runs"}
                  value={String(task.totals.runs)}
                />
              </div>
              <div className="mt-2 flex gap-3 border-t border-border-1 pt-2">
                <RunMetrics label="In" value={formatTokens(task.totals.inputTokens)} />
                <RunMetrics label="Out" value={formatTokens(task.totals.outputTokens)} />
                <RunMetrics
                  label="Caché"
                  value={formatTokens(
                    task.totals.cacheReadTokens + task.totals.cacheWriteTokens,
                  )}
                />
              </div>
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Divider label="Última run" />
          </div>
          {run && (
            <Link
              href={`/runs/${run.id}`}
              className="flex shrink-0 items-center gap-1 text-2xs font-medium text-accent hover:underline"
            >
              Ver log
              <Icon name="chevronRight" size={9} />
            </Link>
          )}
        </div>
        <div className="mt-3">
          {!run && <div className="py-2 text-sm text-txt-3">Todavía no se ha ejecutado</div>}

          {run && active && (
            <div className="rounded-md border border-info/20 bg-info-dim px-2.5 py-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <StatusDot status="running" pulse />
                  <span className="text-sm font-medium text-info">
                    {run.status === "queued" ? "En cola" : "Ejecutando"}
                  </span>
                </span>
                <span className="text-xs text-txt-3">{formatDuration(elapsed)}</span>
              </div>
              <div className="flex gap-3">
                <RunMetrics label="In" value={formatTokens(run.inputTokens)} />
                <RunMetrics label="Out" value={formatTokens(run.outputTokens)} />
                <RunMetrics label="Caché" value={formatTokens(run.cacheReadTokens + run.cacheWriteTokens)} />
                <RunMetrics label="Coste" value={formatCost(run.costUsd)} />
              </div>
            </div>
          )}

          {run && !active && (
            <div className="rounded-md border border-border-1 bg-bg-3 px-2.5 py-2">
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-medium",
                    run.status === "succeeded" ? "text-ok" : "text-danger",
                  )}
                >
                  <Icon name={run.status === "succeeded" ? "check" : "x"} size={12} />
                  {run.status === "succeeded"
                    ? "Completada"
                    : run.status === "cancelled"
                      ? "Cancelada"
                      : "Fallida"}
                </span>
                <span className="text-xs text-txt-3">{formatRelative(run.endedAt)}</span>
              </div>
              <div className="mt-2 flex gap-3">
                <RunMetrics label="Tokens" value={formatTokens(run.inputTokens + run.outputTokens)} />
                <RunMetrics label="Caché" value={formatTokens(run.cacheReadTokens + run.cacheWriteTokens)} />
                <RunMetrics label="Coste" value={formatCost(run.costUsd)} />
              </div>
              {run.resultSummary && (
                <p className="mt-2 border-t border-border-1 pt-2 text-xs leading-relaxed text-txt-2">
                  {run.resultSummary}
                </p>
              )}
              {run.branchName && (
                <div className="mt-2 flex items-center gap-1.5 font-mono text-2xs text-txt-3">
                  <Icon name="gitBranch" size={10} />
                  <span className="truncate-1">{run.branchName}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {previous.length > 0 && (
          <div className="mt-5">
            <Divider label={`${previous.length} intento${previous.length > 1 ? "s" : ""} anterior${previous.length > 1 ? "es" : ""}`} />
            <div className="mt-2 flex flex-col">
              {previous.map((item) => (
                <PreviousRun key={item.id} run={item} />
              ))}
            </div>
          </div>
        )}

        <div className="mt-5">
          <Divider label="Mover a" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {COLUMNS.filter((c) => c.id !== task.status).map((col) => (
              <Button key={col.id} variant="subtle" size="xs" onClick={() => onMove(col.id)}>
                {col.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <Divider label="Zona peligrosa" />
          <Button
            variant="danger"
            size="xs"
            icon="trash"
            className="mt-3"
            onClick={onDelete}
            disabled={active}
          >
            Eliminar tarea
          </Button>
          {active && (
            <p className="mt-1.5 text-2xs text-txt-3">
              No se puede eliminar mientras hay una run activa.
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border-1 px-3.5 py-3">
        {active && run ? (
          <Button
            variant="danger"
            size="sm"
            icon="stop"
            className="flex-1"
            loading={busy}
            onClick={() => onCancel(run.id)}
          >
            Cancelar run
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon="play"
            className="flex-1"
            loading={busy}
            disabled={!agentId || blocking.length > 0}
            title={
              blocking.length > 0
                ? `Falta terminar: ${blocking.map((dep) => dep.title).join(", ")}`
                : undefined
            }
            onClick={() => agentId && onRun(agentId)}
          >
            {blocking.length > 0
              ? `Bloqueada por ${blocking.length}`
              : agentId
                ? "Ejecutar ahora"
                : "Asigna un agente"}
          </Button>
        )}
      </div>
    </aside>
  );
}
