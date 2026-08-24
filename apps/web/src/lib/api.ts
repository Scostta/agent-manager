import type {
  Agent,
  Project,
  QueueStats,
  Skill,
  Task,
  TaskRun,
  TaskStatus,
} from "./types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Fastify rechaza una petición con content-type JSON y cuerpo vacío, así que
  // la cabecera solo se manda cuando realmente hay algo que enviar.
  const headers = init?.body
    ? { "Content-Type": "application/json", ...(init.headers ?? {}) }
    : init?.headers;

  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    // Fastify/sensible responde { statusCode, error, message }.
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) message = parsed.message;
    } catch {
      /* el cuerpo no era JSON; usamos el texto crudo */
    }
    throw new ApiError(res.status, message || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function sseUrl(path: string): string {
  return `${API}${path}`;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

/* ── Projects ─────────────────────────────────────────────────────────────── */

export const listProjects = () => api<Project[]>("/projects");
export const getProject = (id: string) => api<Project>(`/projects/${id}`);

export const createProject = (input: {
  name: string;
  description?: string;
  repoPath: string;
  workspaceStrategy?: "worktree" | "copy";
}) => api<Project>("/projects", { method: "POST", ...json(input) });

export const updateProject = (id: string, input: Partial<Project>) =>
  api<Project>(`/projects/${id}`, { method: "PATCH", ...json(input) });

export const deleteProject = (id: string) =>
  api<{ ok: true }>(`/projects/${id}`, { method: "DELETE" });

/* ── Agents & skills ──────────────────────────────────────────────────────── */

export const listAgents = () => api<Agent[]>("/agents");
export const listSkills = () => api<Skill[]>("/skills");

/* ── Tasks ────────────────────────────────────────────────────────────────── */

export const listTasks = (projectId: string) =>
  api<Task[]>(`/projects/${projectId}/tasks`);

export const createTask = (input: {
  projectId: string;
  title: string;
  description?: string;
  assignedAgentId?: string | null;
  requiredSkillIds?: string[];
  priority?: number;
}) => api<Task>("/tasks", { method: "POST", ...json(input) });

export const updateTask = (
  id: string,
  input: {
    title?: string;
    description?: string;
    assignedAgentId?: string | null;
    requiredSkillIds?: string[];
    priority?: number;
  },
) => api<Task>(`/tasks/${id}`, { method: "PATCH", ...json(input) });

export const moveTask = (id: string, status: TaskStatus, position: number) =>
  api<Task>(`/tasks/${id}/move`, { method: "POST", ...json({ status, position }) });

export const deleteTask = (id: string) =>
  api<{ ok: true }>(`/tasks/${id}`, { method: "DELETE" });

/* ── Runs ─────────────────────────────────────────────────────────────────── */

export const runTask = (taskId: string, agentId?: string) =>
  api<{ runId: string }>(`/tasks/${taskId}/run`, {
    method: "POST",
    ...json(agentId ? { agentId } : {}),
  });

export const getRun = (runId: string) => api<TaskRun>(`/runs/${runId}`);

export const cancelRun = (runId: string) =>
  api<{ ok: boolean }>(`/runs/${runId}/cancel`, { method: "POST" });

/* ── Queue ────────────────────────────────────────────────────────────────── */

export const getQueueStats = () => api<QueueStats>("/queue/stats");
