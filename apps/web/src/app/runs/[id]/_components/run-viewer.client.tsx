"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Square } from "lucide-react";
import type { Task, Agent, TaskRun, TaskRunStatus } from "@agent-manager/types";
import { useRunStream } from "~/hooks/use-run-stream";
import { runs, isActiveRun } from "~/lib/api";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import { formatRelative, formatCost, formatTokens } from "~/lib/format";

type InitialRun = TaskRun & { task: Task; agent: Agent };

type Props = {
  initialRun: InitialRun;
};

const STATUS_LABELS: Record<TaskRunStatus, string> = {
  queued: "En cola",
  running: "Ejecutando",
  succeeded: "Completado",
  failed: "Fallido",
  cancelled: "Cancelado",
};

const STATUS_BADGE: Record<TaskRunStatus, "yellow" | "blue" | "green" | "red" | "default"> = {
  queued: "yellow",
  running: "blue",
  succeeded: "green",
  failed: "red",
  cancelled: "default",
};

export function RunViewer({ initialRun }: Props): ReactElement {
  const router = useRouter();
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const shouldStream = isActiveRun(initialRun.status);
  const { events, status: streamStatus } = useRunStream(shouldStream ? initialRun.id : null);

  const status: TaskRunStatus = streamStatus ?? initialRun.status;

  const logLines = events
    .filter((e): e is { type: "log"; line: string } => e.type === "log")
    .map((e) => e.line);

  const latestTokens = events
    .filter((e): e is { type: "token_usage"; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number } =>
      e.type === "token_usage"
    )
    .at(-1);

  const inputTokens = latestTokens?.inputTokens ?? initialRun.inputTokens;
  const outputTokens = latestTokens?.outputTokens ?? initialRun.outputTokens;
  const cacheReadTokens = latestTokens?.cacheReadTokens ?? initialRun.cacheReadTokens;
  const costUsd = latestTokens?.costUsd ?? initialRun.costUsd;

  // Auto-scroll log to bottom on new lines
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines.length]);

  async function handleCancel() {
    setIsCancelling(true);
    setCancelError(null);
    try {
      await runs.cancel(initialRun.id);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Error al cancelar");
    } finally {
      setIsCancelling(false);
    }
  }

  const isActive = isActiveRun(status);
  const backHref = `/projects/${initialRun.task.projectId}`;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-1 bg-bg-2 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(backHref)}
            className="rounded p-1 text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-text-1 leading-none">
              {initialRun.task.title}
            </p>
            <p className="text-xs text-text-3">
              {initialRun.agent.name} · {initialRun.id.slice(0, 8)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <Badge variant={STATUS_BADGE[status]}>{STATUS_LABELS[status]}</Badge>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex shrink-0 items-center gap-6 border-b border-border-1 bg-bg-3 px-4 py-2">
        <StatItem label="Input" value={formatTokens(inputTokens) + " tok"} />
        <StatItem label="Output" value={formatTokens(outputTokens) + " tok"} />
        <StatItem label="Cache" value={formatTokens(cacheReadTokens) + " tok"} />
        <StatItem label="Coste" value={formatCost(costUsd)} highlight />
        {initialRun.endedAt ? (
          <StatItem label="Finalizado" value={formatRelative(initialRun.endedAt)} />
        ) : (
          <StatItem label="Iniciado" value={formatRelative(initialRun.startedAt)} />
        )}
      </div>

      {/* Log terminal */}
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto bg-bg-base p-4 font-mono"
      >
        {logLines.length === 0 ? (
          <p className={cn("text-xs", isActive ? "animate-pulse text-text-3" : "text-text-3")}>
            {isActive ? "Esperando salida..." : "Sin logs registrados."}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {logLines.map((line, i) => (
              <LogLine key={i} line={line} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {isActive ? (
        <div className="shrink-0 border-t border-border-1 bg-bg-2 px-4 py-3">
          {cancelError ? (
            <p className="mb-2 text-xs text-red" role="alert">{cancelError}</p>
          ) : null}
          <Button
            variant="danger"
            size="sm"
            isLoading={isCancelling}
            onClick={() => void handleCancel()}
          >
            <Square size={12} />
            Cancelar ejecución
          </Button>
        </div>
      ) : (
        <div className="shrink-0 border-t border-border-1 bg-bg-2 px-4 py-3">
          <p className="text-xs text-text-3">
            {status === "succeeded"
              ? "La ejecución terminó correctamente. La tarea ha pasado a revisión."
              : status === "failed"
                ? "La ejecución falló."
                : "La ejecución fue cancelada."}
          </p>
        </div>
      )}
    </div>
  );
}

function StatItem({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-3">{label}</span>
      <span className={cn("text-xs font-medium tabular-nums", highlight ? "text-accent" : "text-text-1")}>
        {value}
      </span>
    </div>
  );
}

function LogLine({ line }: { line: string }): ReactElement {
  let parsed: { type?: string; content?: string } | null = null;
  try {
    parsed = JSON.parse(line) as { type?: string; content?: string };
  } catch {
    // línea no-JSON, mostrar tal cual
  }

  const text = parsed?.content ?? line;
  const isError = parsed?.type === "error" || line.toLowerCase().includes("error");

  return (
    <p
      className={cn(
        "whitespace-pre-wrap break-all text-xs leading-5",
        isError ? "text-red" : "text-text-2",
      )}
    >
      {text}
    </p>
  );
}
