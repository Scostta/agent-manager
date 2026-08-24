import type {
  Agent,
  AgentWithSkills,
  ClaudeMd,
  Project,
  QueueStats,
  Skill,
  Task,
  TaskRun,
  TaskRunStatus,
  TaskStatus,
  TaskWithLatestRun,
} from "@agent-manager/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function sseUrl(path: string): string {
  return `${API}${path}`;
}

// --- Projects ---

export type ProjectWithCount = Project & { _count: { tasks: number } };

export const projects = {
  list: () => api<ProjectWithCount[]>("/projects"),
  get: (id: string) => api<Project & { tasks: Task[]; claudeMd: ClaudeMd | null }>(`/projects/${id}`),
  create: (body: { name: string; description?: string; repoPath: string }) =>
    api<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<{ name: string; description: string; repoPath: string }>) =>
    api<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: string) => api<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
};

// --- Agents ---

export type AgentWithStats = AgentWithSkills & { _count: { runs: number } };

export const agents = {
  list: () => api<AgentWithStats[]>("/agents"),
  get: (id: string) => api<AgentWithSkills>(`/agents/${id}`),
  create: (body: {
    name: string;
    role: string;
    model: string;
    systemPrompt: string;
    maxBudgetUsd?: number;
    skillIds?: string[];
  }) => api<AgentWithSkills>("/agents", { method: "POST", body: JSON.stringify(body) }),
  update: (
    id: string,
    body: Partial<{
      name: string;
      role: string;
      model: string;
      systemPrompt: string;
      maxBudgetUsd: number;
      skillIds: string[];
    }>,
  ) =>
    api<AgentWithSkills>(`/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  delete: (id: string) => api<{ ok: boolean }>(`/agents/${id}`, { method: "DELETE" }),
};

// --- Skills ---

export type SkillWithParsedTags = Omit<Skill, "tags"> & { tags: string[] };

export const skills = {
  list: () => api<SkillWithParsedTags[]>("/skills"),
  content: (id: string) => api<{ content: string; filePath: string }>(`/skills/${id}/content`),
  rescan: () => api<{ ok: boolean; indexed: number }>("/skills/rescan", { method: "POST" }),
};

// --- Tasks ---

export const tasks = {
  list: (projectId: string) =>
    api<TaskWithLatestRun[]>(`/projects/${projectId}/tasks`),
  create: (body: {
    projectId: string;
    title: string;
    description?: string;
    assignedAgentId?: string | null;
    requiredSkillIds?: string[];
  }) => api<Task>("/tasks", { method: "POST", body: JSON.stringify(body) }),
  update: (
    id: string,
    body: Partial<{
      title: string;
      description: string;
      assignedAgentId: string | null;
      requiredSkillIds: string[];
    }>,
  ) => api<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  move: (id: string, status: TaskStatus, position: number) =>
    api<Task>(`/tasks/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ status, position }),
    }),
  delete: (id: string) =>
    api<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),
  run: (id: string, agentId?: string) =>
    api<{ runId: string }>(`/tasks/${id}/run`, {
      method: "POST",
      body: JSON.stringify(agentId ? { agentId } : {}),
    }),
};

// --- Runs ---

export const runs = {
  get: (runId: string) => api<TaskRun & { task: Task; agent: Agent }>(`/runs/${runId}`),
  cancel: (runId: string) =>
    api<{ ok: boolean }>(`/runs/${runId}/cancel`, { method: "POST" }),
};

// --- ClaudeMd ---

export const claudeMd = {
  list: () => api<ClaudeMd[]>("/claude-md"),
  get: (id: string) => api<ClaudeMd>(`/claude-md/${id}`),
  create: (body: { scope: "global" | "project" | "agent"; content: string; filePath?: string }) =>
    api<ClaudeMd>("/claude-md", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<{ scope: string; content: string; filePath: string }>) =>
    api<ClaudeMd>(`/claude-md/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: string) =>
    api<{ ok: boolean }>(`/claude-md/${id}`, { method: "DELETE" }),
};

// --- Queue ---

export const queue = {
  stats: () => api<QueueStats>("/queue/stats"),
};

// --- Task Run Status helper ---

export function isActiveRun(status: TaskRunStatus): boolean {
  return status === "queued" || status === "running";
}
