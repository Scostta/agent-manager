"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  getAgent,
  getQueueStats,
  getRun,
  getStats,
  listAgents,
  listClaudeMd,
  listProjects,
  listSkills,
  listTasks,
  sseUrl,
} from "@/lib/api";
import {
  isActiveRun,
  type BoardEvent,
  type RunEvent,
  type RunStatus,
} from "@/lib/types";

export const keys = {
  projects: "/projects",
  agents: "/agents",
  skills: "/skills",
  queue: "/queue/stats",
  claudeMd: "/claude-md",
  tasks: (projectId: string) => `/projects/${projectId}/tasks`,
  agent: (id: string) => `/agents/${id}`,
  run: (id: string) => `/runs/${id}`,
  stats: (days: number) => `/stats/summary?days=${days}`,
};

export function useProjects() {
  return useSWR(keys.projects, listProjects);
}

export function useAgents() {
  return useSWR(keys.agents, listAgents);
}

export function useSkills() {
  return useSWR(keys.skills, listSkills);
}

export function useAgent(id: string | null) {
  return useSWR(id ? keys.agent(id) : null, () => getAgent(id!));
}

export function useClaudeMdDocs() {
  return useSWR(keys.claudeMd, listClaudeMd);
}

export function useRun(id: string | null) {
  return useSWR(id ? keys.run(id) : null, () => getRun(id!));
}

export function useStats(days: number) {
  return useSWR(keys.stats(days), () => getStats(days));
}

export function useTasks(projectId: string | null) {
  return useSWR(projectId ? keys.tasks(projectId) : null, () => listTasks(projectId!), {
    // Durante una run el backend solo emite por /runs/:id/stream, no por
    // /board/stream, así que sin esto los tokens y el coste de la tarjeta se
    // quedarían congelados hasta que la run termine. Sondeamos solo mientras
    // hay algo activo; en reposo el coste es cero.
    refreshInterval: (data) =>
      data?.some((task) => isActiveRun(task.runs?.[0])) ? 2000 : 0,
  });
}

export function useQueueStats() {
  // La cola cambia por eventos que no llegan por SSE, así que un sondeo lento
  // es más simple que instrumentar el bus solo para esto.
  return useSWR(keys.queue, getQueueStats, { refreshInterval: 4000 });
}

/**
 * Escucha /board/stream y revalida las listas afectadas. El backend emite el
 * evento pero no el estado nuevo, así que revalidamos en vez de parchear.
 */
export function useBoardStream(projectId: string | null) {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    const source = new EventSource(sseUrl("/board/stream"));

    source.onmessage = (event) => {
      let parsed: BoardEvent;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!parsed?.type?.startsWith("task_")) return;
      if (projectId) void mutate(keys.tasks(projectId));
      void mutate(keys.projects);
    };

    // EventSource reconecta solo; solo silenciamos el ruido en consola.
    source.onerror = () => {};

    return () => source.close();
  }, [projectId, mutate]);
}

export type RunTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
};

/** Un run largo puede escupir decenas de miles de líneas; conservamos solo la
 *  cola, que es lo único que el visor muestra. */
const MAX_LOG_LINES = 2000;

/**
 * Escucha /runs/:id/stream. Devuelve el log acumulado, el último recuento de
 * tokens y el estado final si llega. Pasar `null` cierra el stream (útil para
 * no abrir conexión en runs ya terminadas).
 */
export function useRunStream(runId: string | null) {
  const [lines, setLines] = useState<string[]>([]);
  const [tokens, setTokens] = useState<RunTokens | null>(null);
  const [status, setStatus] = useState<RunStatus | null>(null);

  useEffect(() => {
    setLines([]);
    setTokens(null);
    setStatus(null);
    if (!runId) return;

    const source = new EventSource(sseUrl(`/runs/${runId}/stream`));

    source.onmessage = (event) => {
      let parsed: RunEvent;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (parsed.type) {
        case "log":
          setLines((current) =>
            current.length >= MAX_LOG_LINES
              ? [...current.slice(1 - MAX_LOG_LINES), parsed.line]
              : [...current, parsed.line],
          );
          break;
        case "tokens":
          setTokens({
            input: parsed.input,
            output: parsed.output,
            cacheRead: parsed.cacheRead,
            cacheWrite: parsed.cacheWrite,
            costUsd: parsed.costUsd,
          });
          break;
        case "status":
          setStatus(parsed.status);
          break;
        default:
          // `stream` trae el evento crudo de stream-json; el visor usa `log`.
          break;
      }
    };

    source.onerror = () => {};

    return () => source.close();
  }, [runId]);

  return { lines, tokens, status };
}
