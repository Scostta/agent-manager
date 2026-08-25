"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";

import { Icon } from "@/components/ui/icon";
import { Button, StatusDot, cn } from "@/components/ui/primitives.client";
import { Modal } from "@/components/ui/modal.client";
import { useToast } from "@/components/ui/toast.client";
import { pauseQueue, resumeQueue, setQueueConcurrency, stopQueue } from "@/lib/api";
import { keys, useQueueStats } from "@/lib/hooks";

import type { ReactElement } from "react";

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 6, 8] as const;

/**
 * Estado de la cola y sus mandos: pausa, cuántos agentes caben a la vez y el
 * botón de parar todo. Vive en la cabecera porque es lo único que se ve desde
 * cualquier pantalla mientras algo corre.
 */
export function QueueControl(): ReactElement {
  const { data: queue } = useQueueStats();
  const { mutate } = useSWRConfig();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Un panel que se queda abierto detrás de un click en otro sitio molesta más
  // de lo que ayuda.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!queue) return <></>;

  const { pending, waiting, concurrency, paused } = queue;
  const refresh = (): Promise<unknown> => mutate(keys.queue);

  const act = async (fn: () => Promise<unknown>, message: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast(message, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo cambiar la cola", "error");
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await stopQueue();
      await refresh();
      setConfirmingStop(false);
      toast(
        result.killed || result.discarded
          ? `Parado: ${result.killed} en marcha, ${result.discarded} descartadas de la cola`
          : "No había nada corriendo. La cola queda en pausa.",
        "success",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo parar", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Estado de la cola"
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors",
          paused
            ? "border-warn/25 bg-warn-dim font-medium text-warn"
            : pending > 0
              ? "border-accent/25 bg-accent-dim font-medium text-accent"
              : "border-border-2 bg-bg-4 text-txt-3 hover:border-border-3 hover:text-txt-2",
        )}
      >
        {paused ? (
          <>
            <Icon name="stop" size={11} />
            Cola en pausa
          </>
        ) : (
          <>
            <StatusDot status={pending > 0 ? "running" : "idle"} pulse={pending > 0} />
            {pending > 0 ? `${pending} ${pending === 1 ? "run" : "runs"}` : "Cola libre"}
          </>
        )}
        {waiting > 0 && <span className="text-txt-3">· {waiting} en espera</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-[400] flex w-[280px] flex-col gap-3 rounded-lg border border-border-2 bg-bg-3 p-3 shadow-xl">
          <div className="flex items-center justify-between text-xs">
            <span className="text-txt-3">Ejecutando</span>
            <span className="font-mono tabular-nums text-txt-1">
              {pending} de {concurrency}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-txt-3">En espera</span>
            <span className="font-mono tabular-nums text-txt-1">{waiting}</span>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border-1 pt-2.5">
            <span className="text-2xs uppercase tracking-[.06em] text-txt-3">
              Agentes a la vez
            </span>
            <div className="flex gap-1">
              {CONCURRENCY_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => setQueueConcurrency(value),
                      `Hasta ${value} ${value === 1 ? "agente" : "agentes"} a la vez`,
                    )
                  }
                  className={cn(
                    "flex-1 rounded-sm border py-1 font-mono text-xs transition-colors",
                    value === concurrency
                      ? "border-accent/35 bg-accent-dim text-accent"
                      : "border-border-2 bg-bg-4 text-txt-3 hover:text-txt-1",
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
            <span className="text-2xs text-txt-3">
              Se aplica ya. Bajarla no corta lo que está en marcha.
            </span>
          </div>

          <div className="flex gap-2 border-t border-border-1 pt-2.5">
            {paused ? (
              <Button
                variant="primary"
                size="xs"
                icon="play"
                className="flex-1"
                loading={busy}
                onClick={() => void act(resumeQueue, "Cola reanudada")}
              >
                Reanudar
              </Button>
            ) : (
              <Button
                variant="subtle"
                size="xs"
                icon="stop"
                className="flex-1"
                loading={busy}
                onClick={() => void act(pauseQueue, "Cola en pausa")}
              >
                Pausar
              </Button>
            )}
            <Button
              variant="danger"
              size="xs"
              icon="alertCircle"
              onClick={() => setConfirmingStop(true)}
            >
              Parar todo
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={confirmingStop}
        onClose={() => setConfirmingStop(false)}
        title="Parar todo"
        footer={
          <>
            <Button variant="danger" loading={busy} onClick={() => void stop()}>
              Sí, parar todo
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingStop(false)}>
              Cancelar
            </Button>
          </>
        }
      >
        <p className="text-sm text-txt-2">
          {pending + waiting === 0 ? (
            <>No hay nada corriendo ahora mismo, así que esto solo deja la cola en pausa.</>
          ) : (
            <>
              Se matan {pending} {pending === 1 ? "run en marcha" : "runs en marcha"} y se
              descartan {waiting} en espera. Sus tareas vuelven a “Todo”.
            </>
          )}
        </p>
        <p className="text-xs text-txt-3">
          El trabajo que un agente ya hubiera escrito en su workspace se conserva. La cola
          queda en pausa hasta que la reanudes.
        </p>
      </Modal>
    </div>
  );
}
