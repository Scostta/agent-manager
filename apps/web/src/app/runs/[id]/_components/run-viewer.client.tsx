"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";

import { Icon } from "@/components/ui/icon";
import {
  AgentAvatar,
  Badge,
  Button,
  Spinner,
  StatusDot,
  Textarea,
  cn,
} from "@/components/ui/primitives.client";
import { useToast } from "@/components/ui/toast.client";
import { Modal } from "@/components/ui/modal.client";
import {
  cancelRun,
  continueRun,
  discardRun,
  getRunDiff,
  mergeRun,
  retryRun,
} from "@/lib/api";
import { formatClock, formatCost, formatDuration, formatRelative, formatTokens } from "@/lib/format";
import { formatLogLine } from "@/lib/run-log";
import {
  keys,
  useRun,
  useRunBranch,
  useRunLog,
  useRunResume,
  useRunStream,
} from "@/lib/hooks";

import { isRateLimited } from "@/lib/types";

import type { ReactElement } from "react";
import type { LogTone } from "@/lib/run-log";
import type { BranchStatus, RetryMode, RunStatus, RunWithContext } from "@/lib/types";

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

const TONE_CLASS: Record<LogTone, string> = {
  text: "text-txt-2",
  thinking: "text-txt-3 italic",
  tool: "text-info",
  result: "text-txt-3",
  error: "text-danger",
  request: "rounded-md border border-border-1 bg-bg-2 px-3 py-2 text-txt-3",
};

function RunLog({
  lines,
  active,
  truncated,
  totalLines,
}: {
  lines: string[];
  active: boolean;
  truncated?: boolean;
  totalLines?: number;
}): ReactElement {
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
          {active ? "Esperando salida del CLI…" : "Esta run no dejó log."}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {truncated && (
            <p className="pb-1 font-mono text-xs text-txt-3">
              — mostrando las últimas {lines.length} de {totalLines} líneas —
            </p>
          )}
          {lines.map((line, i) => {
            const entry = formatLogLine(line);
            if (!entry) return null;
            return (
              <p
                key={i}
                className={cn(
                  "whitespace-pre-wrap break-words font-mono text-xs leading-5",
                  TONE_CLASS[entry.tone],
                )}
              >
                {entry.text}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "2 commits · 3 sin commitear". Vacío si el agente no dejó nada. */
function changesLabel(branch: BranchStatus): string {
  const parts = [];
  if (branch.commits) parts.push(`${branch.commits} commit${branch.commits > 1 ? "s" : ""}`);
  if (branch.uncommitted) parts.push(`${branch.uncommitted} sin commitear`);
  return parts.join(" · ");
}

/**
 * Controles para sacar el trabajo del worktree: mergearlo en la base o tirarlo.
 * Sin esto una run terminada era un callejón sin salida — solo se podía mirar.
 */
function IntegrationControls({
  runId,
  branch,
  onChanged,
}: {
  runId: string;
  branch: BranchStatus;
  onChanged: () => void;
}): ReactElement | null {
  const [merging, setMerging] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  if (!branch.branchName) return null;

  const merge = async (): Promise<void> => {
    setMerging(true);
    try {
      const result = await mergeRun(runId);
      toast(
        result.committed
          ? `Integrada en ${result.base} (se commiteó lo que el agente dejó suelto)`
          : `Integrada en ${result.base}`,
        "success",
      );
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo mergear", "error");
    } finally {
      setMerging(false);
    }
  };

  const discard = async (): Promise<void> => {
    setDiscarding(true);
    try {
      await discardRun(runId);
      toast("Workspace y rama eliminados", "success");
      setConfirming(false);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo descartar", "error");
    } finally {
      setDiscarding(false);
    }
  };

  if (branch.merged) {
    return (
      <Badge variant="green" size="sm">
        Integrada en {branch.base}
      </Badge>
    );
  }

  return (
    <>
      <Button
        variant="primary"
        size="xs"
        icon="gitBranch"
        disabled={!branch.canMerge}
        title={branch.blockedReason ?? undefined}
        loading={merging}
        onClick={() => void merge()}
      >
        Mergear en {branch.base}
      </Button>
      <Button
        variant="danger"
        size="xs"
        icon="trash"
        disabled={!branch.worktreeExists && !branch.branchExists}
        onClick={() => setConfirming(true)}
      >
        Descartar
      </Button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Descartar el trabajo de esta run"
        footer={
          <>
            <Button variant="danger" loading={discarding} onClick={() => void discard()}>
              Sí, descartar
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </>
        }
      >
        <p className="text-sm text-txt-2">
          Se borran el workspace y la rama{" "}
          <span className="font-mono text-xs text-txt-1">{branch.branchName}</span>. Lo que
          hizo el agente se pierde y no hay vuelta atrás.
        </p>
      </Modal>
    </>
  );
}

/**
 * Una run cortada por falta de cuota no es un fallo de la tarea: o esperas a
 * que el plan se reponga, o la relanzas pagando por API. Lo decide el usuario.
 */
function RateLimitBanner({
  run,
  onResolved,
}: {
  run: RunWithContext;
  onResolved: () => void;
}): ReactElement | null {
  const [busy, setBusy] = useState<RetryMode | null>(null);
  const toast = useToast();

  if (!isRateLimited(run)) return null;

  const waiting = run.failureKind === "rate_limit_waiting";
  const resetAt = run.rateLimitResetAt;

  const act = async (mode: RetryMode): Promise<void> => {
    setBusy(mode);
    try {
      const result = await retryRun(run.id, mode);
      const how = result.resumed ? "Retomada donde se cortó" : "Relanzada";
      toast(
        result.scheduledFor
          ? `Reintento programado para ${formatClock(result.scheduledFor)}`
          : mode === "api_key"
            ? `${how} con la API key (se factura aparte del plan)`
            : how,
        "success",
      );
      onResolved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo reintentar", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border-1 bg-warn-dim px-5 py-2.5 text-sm text-warn">
      <Icon name="clock" size={13} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {run.resultSummary ?? "Se agotó tu cuota del plan de Claude Code."}
        {waiting && resetAt && (
          <span className="text-txt-2"> · reintentando sola a las {formatClock(resetAt)}</span>
        )}
      </span>

      {waiting ? (
        <Button
          variant="subtle"
          size="xs"
          icon="play"
          loading={busy === "api_key"}
          onClick={() => void act("api_key")}
        >
          Mejor tirar de la API key
        </Button>
      ) : (
        <>
          <Button
            variant="default"
            size="xs"
            icon="clock"
            disabled={!resetAt}
            title={resetAt ? undefined : "El CLI no dijo cuándo se repone la cuota"}
            loading={busy === "wait"}
            onClick={() => void act("wait")}
          >
            {resetAt ? `Esperar a las ${formatClock(resetAt)}` : "Esperar al reset"}
          </Button>
          <Button
            variant="primary"
            size="xs"
            icon="play"
            loading={busy === "api_key"}
            onClick={() => void act("api_key")}
          >
            Usar la API key
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * "Casi, pero cambia X". Al revisar un diff eso es lo natural, y hasta ahora
 * obligaba a crear otra task o a reintentar la run entera: el agente volvía a
 * leerse el repo desde cero y lo pagabas otra vez. Esto retoma su sesión en el
 * mismo workspace y solo le dice lo que falta.
 */
function ContinueControl({ runId }: { runId: string }): ReactElement {
  const { data: resume } = useRunResume(runId);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      const { runId: nextRunId } = await continueRun(runId, prompt);
      toast("Retomando la sesión con tus instrucciones", "success");
      setOpen(false);
      setPrompt("");
      router.push(`/runs/${nextRunId}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo continuar", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="default"
        size="xs"
        icon="refresh"
        disabled={!resume?.canResume}
        title={resume?.reason ?? undefined}
        onClick={() => setOpen(true)}
      >
        Seguir con instrucciones
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Seguir con instrucciones"
        width={520}
        footer={
          <>
            <Button
              variant="primary"
              icon="play"
              disabled={!prompt.trim()}
              loading={busy}
              onClick={() => void send()}
            >
              Retomar
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </>
        }
      >
        <p className="text-sm text-txt-2">
          El agente sigue donde lo dejó, en este mismo workspace y con todo lo que ya
          sabe de la tarea. Dile solo qué cambiar.
        </p>
        <Textarea
          rows={5}
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Bien, pero extrae la validación a su propio módulo y añade un test del caso vacío."
        />
      </Modal>
    </>
  );
}

function RunDiffPanel({ runId }: { runId: string }): ReactElement {
  const { data, error, isLoading } = useSWR(keys.runDiff(runId), () => getRunDiff(runId));

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-bg-base px-5 py-4">
      {isLoading && <Spinner size={16} />}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-warn/20 bg-warn-dim px-3 py-2.5 text-sm text-warn">
          <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
          <span>{error instanceof Error ? error.message : "No hay diff disponible"}</span>
        </div>
      )}

      {/* SWR conserva el `data` anterior cuando una revalidación falla; tras
          mergear eso pintaría el diff de un workspace que ya no existe. */}
      {!error && data && !data.diff.trim() && (
        <p className="font-mono text-xs text-txt-3">
          La rama {data.branchName} no tiene cambios respecto a {data.base}.
        </p>
      )}

      {!error && data && !!data.diff.trim() && (
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
  const { lines: streamedLines, tokens, status: streamed } = useRunStream(live ? runId : null);
  const { data: log } = useRunLog(runId);
  const { data: branch } = useRunBranch(runId);

  // Merge y descarte cambian el worktree y la rama: lo que muestran el estado
  // de rama y el diff deja de valer en cuanto uno de los dos termina.
  const reloadIntegration = (): void => {
    void mutate(keys.runBranch(runId));
    void mutate(keys.runDiff(runId));
    void mutate(keys.run(runId));
  };

  // El histórico llega del NDJSON en disco y el SSE solo trae lo que pasa desde
  // que te conectas: concatenamos, descartando el solape de la ventana entre
  // el fetch y el open del EventSource.
  const lines = useMemo(() => {
    const history = log?.lines;
    if (!history?.length) return streamedLines;
    const seen = new Set(history);
    return [...history, ...streamedLines.filter((line) => !seen.has(line))];
  }, [log, streamedLines]);

  const status: RunStatus = streamed ?? run?.status ?? "queued";
  const active = status === "running" || status === "queued";

  // El stream avisa del estado final antes de que SWR revalide; sin esto la
  // cabecera y las métricas se quedarían con los datos del arranque.
  useEffect(() => {
    if (streamed && streamed !== "running") {
      void mutate(keys.run(runId));
      // Al cerrar, el fichero en disco es la versión completa y autoritativa
      // del log; sustituye a lo que hayamos ido acumulando por SSE.
      void mutate(keys.runLog(runId));
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
              {run.resumedFromId && (
                <>
                  <span>·</span>
                  <Link
                    href={`/runs/${run.resumedFromId}`}
                    className="flex items-center gap-1 transition-colors hover:text-txt-1"
                  >
                    <Icon name="refresh" size={9} />
                    sigue a {run.resumedFromId.slice(0, 8)}
                  </Link>
                </>
              )}
              {branch && !branch.merged && changesLabel(branch) && (
                <>
                  <span>·</span>
                  <span>{changesLabel(branch)}</span>
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
          {active ? (
            <Button
              variant="danger"
              size="xs"
              icon="stop"
              onClick={() => void cancel()}
              loading={cancelling}
            >
              Cancelar
            </Button>
          ) : (
            <>
              <ContinueControl runId={runId} />
              {branch && (
                <IntegrationControls
                  runId={runId}
                  branch={branch}
                  onChanged={reloadIntegration}
                />
              )}
            </>
          )}
        </div>
      </div>

      <RateLimitBanner run={run} onResolved={() => { void mutate(keys.run(runId)); void mutate(keys.plan); }} />

      {/* El NDJSON solo guarda lo que devuelve el CLI, así que sin esto no
          quedaría en ninguna parte qué se le pidió al retomar. */}
      {run.followUpPrompt && (
        <div className="flex shrink-0 items-start gap-2 border-b border-border-1 bg-bg-2 px-5 py-2.5">
          <Icon name="refresh" size={12} className="mt-0.5 shrink-0 text-txt-3" />
          <div className="min-w-0">
            <div className="text-2xs uppercase tracking-[.06em] text-txt-3">
              Se retomó con
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-txt-2">
              {run.followUpPrompt}
            </p>
          </div>
        </div>
      )}

      {!active && branch?.branchName && !branch.merged && branch.blockedReason && (
        <div className="flex shrink-0 items-start gap-2 border-b border-border-1 bg-warn-dim px-5 py-2 text-xs text-warn">
          <Icon name="alertCircle" size={12} className="mt-px shrink-0" />
          <span>{branch.blockedReason}</span>
        </div>
      )}

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
        <RunLog
          lines={lines}
          active={active}
          truncated={log?.truncated}
          totalLines={log?.totalLines}
        />
      ) : (
        <RunDiffPanel runId={runId} />
      )}

      {/* El resumen del agente puede ser larguísimo; sin tope se comía el log
          y el diff, que son lo que se viene a mirar. */}
      {!active && run.resultSummary && (
        <div className="max-h-[30%] shrink-0 overflow-y-auto border-t border-border-1 bg-bg-2 px-5 py-3">
          <div className="text-2xs uppercase tracking-[.06em] text-txt-3">Resumen</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-txt-2">{run.resultSummary}</p>
        </div>
      )}
    </div>
  );
}
