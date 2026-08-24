"use client";

import { useEffect, useState } from "react";
import type { RunEvent, TaskRunStatus } from "@agent-manager/types";
import { sseUrl } from "~/lib/api";

type RunStreamState = {
  events: RunEvent[];
  status: TaskRunStatus | null;
};

/**
 * Suscribe al stream SSE de una run concreta.
 * Devuelve los eventos acumulados y el status actual.
 */
export function useRunStream(runId: string | null): RunStreamState {
  const [state, setState] = useState<RunStreamState>({
    events: [],
    status: null,
  });

  useEffect(() => {
    if (!runId) return;

    setState({ events: [], status: null });

    const es = new EventSource(sseUrl(`/runs/${runId}/stream`));

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as RunEvent;
        setState((prev) => {
          const next = { ...prev, events: [...prev.events, event] };
          if (event.type === "status") {
            next.status = event.status;
          }
          return next;
        });
      } catch {
        // ignorar líneas no-JSON
      }
    };

    es.onerror = () => {
      // EventSource reconecta automáticamente
    };

    return () => {
      es.close();
    };
  }, [runId]);

  return state;
}
