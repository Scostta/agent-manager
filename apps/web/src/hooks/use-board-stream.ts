"use client";

import { useEffect } from "react";
import type { KeyedMutator } from "swr";
import type { BoardEvent } from "@agent-manager/types";
import { sseUrl } from "~/lib/api";

/**
 * Suscribe al stream SSE del kanban y dispara mutate() de SWR
 * cuando llegan eventos de cambio de tasks.
 */
export function useBoardStream<T>(mutate: KeyedMutator<T>): void {
  useEffect(() => {
    const es = new EventSource(sseUrl("/board/stream"));

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as BoardEvent;
        if (
          event.type === "task_created" ||
          event.type === "task_updated" ||
          event.type === "task_deleted"
        ) {
          void mutate();
        }
      } catch {
        // línea de ping no-JSON, ignorar
      }
    };

    es.onerror = () => {
      // Reconexión automática del EventSource nativo del navegador
    };

    return () => {
      es.close();
    };
  }, [mutate]);
}
