"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  getAgent,
  getPlanUsage,
  getQueueStats,
  getRun,
  getRunBranch,
  getRunLog,
  getStats,
  listAgents,
  listClaudeMd,
  listProjects,
  listRuns,
  listSkills,
  listTasks,
  sseUrl,
  type RunFilters,
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
  // La clave lleva los filtros serializados: cada combinación es su propia
  // entrada de caché.
  runs: (filters: RunFilters) => ["/runs", JSON.stringify(filters)] as const,
  runLog: (id: string) => `/runs/${id}/log`,
  runBranch: (id: string) => `/runs/${id}/branch`,
  runDiff: (id: string) => `/runs/${id}/diff`,
  stats: (days: number) => `/stats/summary?days=${days}`,
  plan: "/stats/plan",
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

/**
 * Historial de runs. Sondea mientras haya alguna activa: las runs en marcha no
 * emiten por /board/stream, solo por su propio stream.
 */
export function useRuns(filters: RunFilters | null = {}) {
  return useSWR(filters ? keys.runs(filters) : null, () => listRuns(filters!), {
    keepPreviousData: true,
    refreshInterval: (data) =>
      data?.runs.some((run) => isActiveRun(run)) ? 3000 : 0,
  });
}

/**
 * Estado de la rama de la run: si tiene trabajo, si ya está integrado y si se
 * puede mergear ahora. Se calcula con git en vivo, así que cambia si el usuario
 * toca su repo por fuera; por eso revalidamos al volver a la pestaña.
 */
export function useRunBranch(runId: string | null) {
  return useSWR(runId ? keys.runBranch(runId) : null, () => getRunBranch(runId!));
}

/**
 * Log NDJSON ya escrito en disco. El SSE solo emite desde que te conectas, así
 * que sin esto una run terminada (o recargar la página a medias) se veía vacía.
 */
export function useRunLog(runId: string | null) {
  return useSWR(runId ? keys.runLog(runId) : null, () => getRunLog(runId!), {
    revalidateOnFocus: false,
  });
}

/**
 * Consumo del plan. Se sondea despacio: cambia solo cuando termina una run, y
 * el aviso de límite tiene que aparecer sin recargar.
 */
export function usePlanUsage() {
  return useSWR(keys.plan, getPlanUsage, { refreshInterval: 15000 });
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
      if (parsed?.type === "queue_changed") {
        void mutate(keys.queue);
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

      const pushLine = (line: string): void =>
        setLines((current) =>
          current.length >= MAX_LOG_LINES
            ? [...current.slice(1 - MAX_LOG_LINES), line]
            : [...current, line],
        );

      switch (parsed.type) {
        case "log":
          pushLine(parsed.line);
          break;
        // El grueso del log son eventos `stream`: el runner solo manda `log`
        // para stderr y para las líneas que no son JSON. Los reserializamos
        // igual que están en el NDJSON para que el visor los pinte igual.
        case "stream":
          pushLine(JSON.stringify(parsed.data));
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
          break;
      }
    };

    source.onerror = () => {};

    return () => source.close();
  }, [runId]);

  return { lines, tokens, status };
}
