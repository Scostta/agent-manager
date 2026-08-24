"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";

import { Icon } from "@/components/ui/icon";
import {
  AgentAvatar,
  Badge,
  Button,
  Spinner,
  StatusDot,
  cn,
} from "@/components/ui/primitives.client";
import { useToast } from "@/components/ui/toast.client";
import { cancelRun, getRunDiff } from "@/lib/api";
import { formatCost, formatDuration, formatRelative, formatTokens } from "@/lib/format";
import { keys, useRun, useRunStream } from "@/lib/hooks";

import type { ReactElement } from "react";
import type { RunStatus } from "@/lib/types";

const STATUS_LABEL = {
  queued: "En cola",
  running: "Ejecutando",
  succeeded: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada",
} as const;

const STATUS_BADGE = {
  queued: "yellow",
  running: "blue",
  succeeded: "green",
  failed: "red",
  cancelled: "ghost",
} as const;

const STATUS_DOT = {
  queued: "idle",
  running: "running",
  succeeded: "done",
  failed: "error",
  cancelled: "idle",
} as const;

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-[.06em] text-txt-3">{label}</span>
      <span
        className={cn(
          "text-sm font-medium tabular-nums",
          accent ? "text-accent" : "text-txt-1",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** El CLI escupe NDJSON; si la línea es JSON mostramos lo legible, si no, crudo. */
function logText(line: string): { text: string; error: boolean } {
  try {
    const parsed = JSON.parse(line) as {
      type?: string;
      subtype?: string;
      content?: string;
      message?: { content?: { type: string; text?: string }[] };
      result?: string;
      is_error?: boolean;
    };
    const fromMessage = parsed.message?.content
      ?.filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n");
    const text = fromMessage || parsed.content || parsed.result || line;
    return { text, error: parsed.is_error === true || parsed.subtype === "error" };
  } catch {
    return { text: line, error: /error|failed|exception/i.test(line) };
  }
}

function RunLog({ lines, active }: { lines: string[]; active: boolean }): ReactElement {
  const boxRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Solo autoscroll si el usuario no se ha ido a mirar hacia arriba.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !pinnedRef.current) return;
    box.scrollTop = box.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={boxRef}
      onScroll={(e) => {
        const box = e.currentTarget;
        pinnedRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      }}
      className="min-h-0 flex-1 overflow-y-auto bg-bg-base px-5 py-4"
    >
      {lines.length === 0 ? (
        <p className={cn("font-mono text-xs", active ? "animate-pulse text-txt-3" : "text-txt-3")}>
          {active ? "Esperando salida del CLI…" : "Esta run no dejó log en vivo."}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {lines.map((line, i) => {
            const { text, error } = logText(line);
            return (
              <p
                key={i}
                className={cn(
                  "whitespace-pre-wrap break-words font-mono text-xs leading-5",
                  error ? "text-danger" : "text-txt-2",
                )}
              >
                {text}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RunDiffPanel({ runId }: { runId: string }): ReactElement {
  const { data, error, isLoading } = useSWR(`/runs/${runId}/diff`, () => getRunDiff(runId));

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-bg-base px-5 py-4">
      {isLoading && <Spinner size={16} />}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-warn/20 bg-warn-dim px-3 py-2.5 text-sm text-warn">
          <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
          <span>{error instanceof Error ? error.message : "No hay diff disponible"}</span>
        </div>
      )}

      {data && !data.diff.trim() && (
        <p className="font-mono text-xs text-txt-3">
          La rama {data.branchName} no tiene cambios respecto a la base.
        </p>
      )}

      {data && !!data.diff.trim() && (
        <pre className="font-mono text-xs leading-5">
          {data.diff.split("\n").map((line, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-words",
                line.startsWith("+") && !line.startsWith("+++") && "text-ok",
                line.startsWith("-") && !line.startsWith("---") && "text-danger",
                line.startsWith("@@") && "text-accent",
                line.startsWith("diff ") && "text-txt-1",
              )}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

export function RunViewer({ runId }: { runId: string }): ReactElement {
  const { data: run, error, isLoading } = useRun(runId);
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [tab, setTab] = useState<"log" | "diff">("log");
  const [cancelling, setCancelling] = useState(false);

  const live = run ? run.status === "running" || run.status === "queued" : false;
  const { lines, tokens, status: streamed } = useRunStream(live ? runId : null);

  const status: RunStatus = streamed ?? run?.status ?? "queued";
  const active = status === "running" || status === "queued";

  // El stream avisa del estado final antes de que SWR revalide; sin esto la
  // cabecera y las métricas se quedarían con los datos del arranque.
  useEffect(() => {
    if (streamed && streamed !== "running") {
      void mutate(keys.run(runId));
    }
  }, [streamed, runId, mutate]);

  const cancel = async (): Promise<void> => {
    setCancelling(true);
    try {
      await cancelRun(runId);
      await mutate(keys.run(runId));
      toast("Cancelación enviada", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo cancelar", "error");
    } finally {
      setCancelling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="p-7">
        <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">
          <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
          <span>No se encontró la run {runId}.</span>
        </div>
      </div>
    );
  }

  const inputTokens = tokens?.input ?? run.inputTokens;
  const outputTokens = tokens?.output ?? run.outputTokens;
  const cacheTokens =
    (tokens?.cacheRead ?? run.cacheReadTokens) + (tokens?.cacheWrite ?? run.cacheWriteTokens);
  const costUsd = tokens?.costUsd ?? run.costUsd;
  const elapsed = run.endedAt
    ? Date.parse(run.endedAt) - Date.parse(run.startedAt)
    : Date.now() - Date.parse(run.startedAt);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-1 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/projects/${run.task.projectId}`}
            aria-label="Volver al tablero"
            className="flex rounded p-1 text-txt-3 transition-colors hover:bg-bg-hover hover:text-txt-1"
          >
            <Icon name="chevronRight" size={14} className="rotate-180" />
          </Link>
          <AgentAvatar name={run.agent.name} size={28} />
          <div className="min-w-0">
            <div className="truncate-1 text-base font-medium text-txt-1">
              {run.task.title}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-txt-3">
              <span>{run.agent.name}</span>
              <span>·</span>
              <span className="font-mono">{run.id.slice(0, 8)}</span>
              {run.branchName && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1 font-mono">
                    <Icon name="gitBranch" size={9} />
                    {run.branchName}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <StatusDot status={STATUS_DOT[status]} pulse={active} />
          <Badge variant={STATUS_BADGE[status]} size="sm">
            {STATUS_LABEL[status]}
          </Badge>
          {active && (
            <Button
              variant="danger"
              size="xs"
              icon="stop"
              onClick={() => void cancel()}
              loading={cancelling}
            >
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-7 border-b border-border-1 bg-bg-2 px-5 py-2.5">
        <Stat label="Input" value={`${formatTokens(inputTokens)} tok`} />
        <Stat label="Output" value={`${formatTokens(outputTokens)} tok`} />
        <Stat label="Caché" value={`${formatTokens(cacheTokens)} tok`} />
        <Stat label="Coste" value={formatCost(costUsd)} accent />
        <Stat label="Duración" value={formatDuration(elapsed)} />
        <Stat
          label={run.endedAt ? "Terminó" : "Empezó"}
          value={formatRelative(run.endedAt ?? run.startedAt)}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border-1 px-5">
        {(["log", "diff"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              tab === key
                ? "border-accent font-medium text-txt-1"
                : "border-transparent text-txt-3 hover:text-txt-2",
            )}
          >
            {key === "log" ? "Log" : "Diff"}
          </button>
        ))}
      </div>

      {tab === "log" ? (
        <RunLog lines={lines} active={active} />
      ) : (
        <RunDiffPanel runId={runId} />
      )}

      {!active && run.resultSummary && (
        <div className="shrink-0 border-t border-border-1 bg-bg-2 px-5 py-3">
          <div className="text-2xs uppercase tracking-[.06em] text-txt-3">Resumen</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-txt-2">{run.resultSummary}</p>
        </div>
      )}
    </div>
  );
}
