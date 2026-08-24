"use client";

import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  getQueueStats,
  listAgents,
  listProjects,
  listSkills,
  listTasks,
  sseUrl,
} from "./api";
import { isActiveRun, type BoardEvent } from "./types";

export const keys = {
  projects: "/projects",
  agents: "/agents",
  skills: "/skills",
  queue: "/queue/stats",
  tasks: (projectId: string) => `/projects/${projectId}/tasks`,
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
