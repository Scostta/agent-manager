"use client";

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast.client";
import { sseUrl } from "@/lib/api";

import type { ReactElement } from "react";
import type { BoardEvent } from "@/lib/types";

/**
 * Avisos del navegador cuando una run termina. Una run tarda minutos y hasta
 * ahora había que quedarse mirando: orquestar agentes y tener que vigilarlos se
 * contradice.
 */

const STORAGE_KEY = "cockpit:run-notifications";

/** Lo que el navegador nos deja hacer ahora mismo. */
function permission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    // Modo incógnito o cookies bloqueadas: sin preferencia guardada, apagado.
    return false;
  }
}

function writePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    /* que no se pueda recordar no impide que funcione en esta sesión */
  }
}

const TITLE = {
  succeeded: "Run completada",
  failed: "Run fallida",
  cancelled: "Run cancelada",
} as const;

/**
 * Escucha el board y avisa. Vive en el shell, no en una ruta: el sentido de
 * esto es enterarte estés donde estés, incluso con el cockpit de fondo.
 */
export function useRunNotifications(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || permission() !== "granted") return;

    const source = new EventSource(sseUrl("/board/stream"));

    source.onmessage = (event) => {
      let parsed: BoardEvent;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (parsed?.type !== "run_finished") return;

      // Cancelaste tú: ya sabes que ha terminado.
      if (parsed.status === "cancelled") return;

      // Con la pestaña delante, la propia UI ya se actualiza sola. Avisar
      // encima sería ruido sobre algo que estás mirando.
      if (document.visibilityState !== "hidden") return;

      const notification = new Notification(TITLE[parsed.status], {
        body: `${parsed.taskTitle} · ${parsed.agentName}`,
        // Reemplaza el aviso anterior de la misma run en vez de apilarlo.
        tag: parsed.runId,
      });

      notification.onclick = () => {
        window.focus();
        window.location.href = `/runs/${parsed.runId}`;
        notification.close();
      };
    };

    source.onerror = () => {};

    return () => source.close();
  }, [enabled]);
}

/** Interruptor en la cabecera. Pide permiso al pulsarlo, que es el gesto que
 *  los navegadores exigen para no tratar la petición como spam. */
export function RunNotificationsToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}): ReactElement | null {
  const [state, setState] = useState<NotificationPermission | "unsupported">("default");
  const toast = useToast();

  // En el servidor no hay `Notification`, así que el estado real se lee ya
  // montados para no romper la hidratación.
  useEffect(() => setState(permission()), []);

  const toggle = useCallback(async (): Promise<void> => {
    if (enabled) {
      onChange(false);
      return;
    }

    let granted = permission();
    if (granted === "default") granted = await Notification.requestPermission();
    setState(granted);

    if (granted !== "granted") {
      // Una vez denegado, el navegador ya no vuelve a preguntar: insistir desde
      // aquí no hace nada y hay que decirlo.
      toast(
        "El navegador tiene bloqueados los avisos de esta página. Actívalos desde el candado de la barra de direcciones.",
        "error",
      );
      return;
    }

    onChange(true);
    // Sin esto, quien lo activa y se queda en la pestaña no ve nada (solo
    // avisamos con la pestaña de fondo) y da por hecho que no funciona.
    new Notification("Avisos activados", {
      body: "Te avisaremos cuando termine una run y no tengas el cockpit delante.",
      tag: "cockpit-test",
    });
  }, [enabled, onChange, toast]);

  if (state === "unsupported") return null;

  const blocked = state === "denied";
  const label = blocked
    ? "Avisos bloqueados por el navegador"
    : enabled
      ? "Avisos al terminar una run: activados"
      : "Avisos al terminar una run: desactivados";

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-label={label}
      aria-pressed={enabled}
      title={label}
      className={
        enabled
          ? "flex rounded-md border border-border-2 bg-bg-4 px-2 py-1.5 text-accent transition-colors hover:border-border-3"
          : "flex rounded-md border border-border-2 bg-bg-4 px-2 py-1.5 text-txt-3 transition-colors hover:border-border-3 hover:text-txt-2"
      }
    >
      <Icon name={enabled ? "bell" : "bellOff"} size={12} />
    </button>
  );
}

/** Estado compartido entre el interruptor y el listener. */
export function useRunNotificationSetting(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  // Arranca apagado siempre y se corrige al montar: leer localStorage durante
  // el render daría un HTML distinto en servidor y cliente.
  useEffect(() => {
    if (readPreference() && permission() === "granted") setEnabled(true);
  }, []);

  const change = useCallback((next: boolean) => {
    setEnabled(next);
    writePreference(next);
  }, []);

  return [enabled, change];
}
