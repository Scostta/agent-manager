import type {
  Agent,
  BranchStatus,
  BrowseRoot,
  ClaudeMd,
  ClaudeMdScope,
  ClaudeMdFile,
  DirListing,
  MergeResult,
  PlanUsage,
  PlanResult,
  Project,
  QueueStats,
  RunDiff,
  RunList,
  ResumeStatus,
  RetryMode,
  RunLog,
  RunStatus,
  RunWithContext,
  Skill,
  SkillContent,
  StatsSummary,
  StopResult,
  WorkspaceReport,
  GcResult,
  Task,
  TaskDependency,
  TaskStatus,
} from "@/lib/types";

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
  /** Crea el repo si la carpeta no lo es: sin git no hay worktrees. */
  initGit?: boolean;
  /** Se guarda en BD y se escribe como CLAUDE.md dentro de la carpeta. */
  claudeMdContent?: string | null;
}) => api<Project>("/projects", { method: "POST", ...json(input) });

/** Propone el backlog inicial. Tarda lo que tarde el CLI; no guarda nada. */
export const planProject = (id: string, model?: string) =>
  api<PlanResult>(`/projects/${id}/plan`, { method: "POST", ...json({ model }) });

export const cancelProjectPlan = (id: string) =>
  api<{ cancelled: boolean }>(`/projects/${id}/plan`, { method: "DELETE" });

export const updateProject = (id: string, input: Partial<Project>) =>
  api<Project>(`/projects/${id}`, { method: "PATCH", ...json(input) });

export const deleteProject = (id: string) =>
  api<{ ok: true }>(`/projects/${id}`, { method: "DELETE" });

/* ── Agents ───────────────────────────────────────────────────────────────── */

export const listAgents = () => api<Agent[]>("/agents");
export const getAgent = (id: string) => api<Agent>(`/agents/${id}`);

export type AgentInput = {
  name: string;
  role: string;
  model: string;
  systemPrompt: string;
  maxBudgetUsd?: number;
  skillIds?: string[];
  /** Vacío o ausente = sin restricción. La API lo guarda como null. */
  allowedTools?: string[];
  disallowedTools?: string[];
};

export const createAgent = (input: AgentInput) =>
  api<Agent>("/agents", { method: "POST", ...json(input) });

export const updateAgent = (id: string, input: Partial<AgentInput>) =>
  api<Agent>(`/agents/${id}`, { method: "PATCH", ...json(input) });

export const deleteAgent = (id: string) =>
  api<{ ok: true }>(`/agents/${id}`, { method: "DELETE" });

/* ── Skills ───────────────────────────────────────────────────────────────── */

export const listSkills = () => api<Skill[]>("/skills");

export const getSkillContent = (id: string) =>
  api<SkillContent>(`/skills/${id}/content`);

/** Escribe el SKILL.md en disco. La API valida el frontmatter antes de tocarlo. */
export const updateSkillContent = (id: string, content: string) =>
  api<Skill>(`/skills/${id}/content`, { method: "PATCH", ...json({ content }) });

export const rescanSkills = () =>
  api<{ ok: true; indexed: number }>("/skills/rescan", { method: "POST" });

/* ── CLAUDE.md ────────────────────────────────────────────────────────────── */

export const listClaudeMd = () => api<ClaudeMd[]>("/claude-md");
export const getClaudeMd = (id: string) => api<ClaudeMd>(`/claude-md/${id}`);

export const createClaudeMd = (input: {
  scope: ClaudeMdScope;
  content: string;
  filePath?: string;
}) => api<ClaudeMd>("/claude-md", { method: "POST", ...json(input) });

export const updateClaudeMd = (
  id: string,
  input: { content?: string; filePath?: string },
) => api<ClaudeMd>(`/claude-md/${id}`, { method: "PATCH", ...json(input) });

export const deleteClaudeMd = (id: string) =>
  api<{ ok: true }>(`/claude-md/${id}`, { method: "DELETE" });

/* ── Tasks ────────────────────────────────────────────────────────────────── */

export const listTasks = (projectId: string) =>
  api<Task[]>(`/projects/${projectId}/tasks`);

export const createTask = (input: {
  projectId: string;
  title: string;
  description?: string;
  assignedAgentId?: string | null;
  priority?: number;
}) => api<Task>("/tasks", { method: "POST", ...json(input) });

/** Alta del backlog inicial. `dependsOn` son índices dentro del propio array. */
export const createTasksBulk = (
  projectId: string,
  tasks: { title: string; description?: string; dependsOn?: number[] }[],
) => api<Task[]>(`/projects/${projectId}/tasks/bulk`, { method: "POST", ...json({ tasks }) });

export const updateTask = (
  id: string,
  input: {
    title?: string;
    description?: string;
    assignedAgentId?: string | null;
      dependsOn?: string[];
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

export const getRun = (runId: string) => api<RunWithContext>(`/runs/${runId}`);

export type RunFilters = {
  projectId?: string;
  taskId?: string;
  agentId?: string;
  status?: RunStatus;
  /** ISO. Runs terminadas después de ese instante; para recuperar avisos perdidos. */
  endedAfter?: string;
  limit?: number;
  offset?: number;
};

/** Historial de runs. Sin filtros devuelve las últimas 50 de todo el cockpit. */
export const listRuns = (filters: RunFilters = {}) => {
  const query = new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  return api<RunList>(`/runs${query ? `?${query}` : ""}`);
};

export const cancelRun = (runId: string) =>
  api<{ ok: boolean }>(`/runs/${runId}/cancel`, { method: "POST" });

/** Solo existe si el proyecto usa estrategia worktree; con "copy" da 400. */
export const getRunDiff = (runId: string) => api<RunDiff>(`/runs/${runId}/diff`);

/** Log NDJSON persistido en disco: lo que ya había antes de conectar el SSE. */
export const getRunLog = (runId: string, tail?: number) =>
  api<RunLog>(`/runs/${runId}/log${tail ? `?tail=${tail}` : ""}`);

/* ── Integración del trabajo de una run ───────────────────────────────────── */

export const getRunBranch = (runId: string) =>
  api<BranchStatus>(`/runs/${runId}/branch`);

/** Commitea lo que el agente dejó suelto y mergea la rama en la base. */
export const mergeRun = (runId: string) =>
  api<MergeResult>(`/runs/${runId}/merge`, { method: "POST" });

/** Borra worktree y rama. Irreversible: se pierde lo que hizo el agente. */
export const discardRun = (runId: string) =>
  api<{ ok: true }>(`/runs/${runId}/discard`, { method: "POST" });

/* ── Stats ──────────────────────────────────────────── */

export const getStats = (days: number) => api<StatsSummary>(`/stats/summary?days=${days}`);

/** Consumo del plan atribuible al cockpit + estado del límite si se alcanzó. */
export const getPlanUsage = () => api<PlanUsage>("/stats/plan");

/** Qué hacer con una run cortada por falta de cuota. */
export const retryRun = (runId: string, mode: RetryMode) =>
  api<{ mode: RetryMode; runId?: string; scheduledFor?: string; resumed?: boolean }>(
    `/runs/${runId}/retry`,
    { method: "POST", ...json({ mode }) },
  );

/* ── Continuar la sesión de una run ───────────────────────────────────────── */

export const getRunResume = (runId: string) =>
  api<ResumeStatus>(`/runs/${runId}/resume`);

/** Encadena una run que sigue la conversación de esta, en su mismo workspace. */
export const continueRun = (runId: string, prompt: string) =>
  api<{ runId: string }>(`/runs/${runId}/resume`, { method: "POST", ...json({ prompt }) });

/* ── Backup ───────────────────────────────────────────────────────────────── */

export type BackupHistory = {
  root: string;
  keep: number;
  snapshots: { name: string; sizeBytes: number; at: string }[];
};

export const getBackupHistory = () => api<BackupHistory>("/backup/history");

/** No pasa por `api()`: el navegador descarga el fichero, no lo parseamos. */
export const backupDownloadUrl = (): string => sseUrl("/backup");

/* ── Queue ────────────────────────────────────────────────────────────────── */

export const getQueueStats = () => api<QueueStats>("/queue/stats");

/** Deja de sacar trabajo nuevo; lo que ya corre sigue hasta terminar. */
export const pauseQueue = () => api<QueueStats>("/queue/pause", { method: "POST" });

export const resumeQueue = () => api<QueueStats>("/queue/resume", { method: "POST" });

/** Se aplica en caliente: subirla arranca ya lo que quepa. */
export const setQueueConcurrency = (concurrency: number) =>
  api<QueueStats>("/queue/concurrency", { method: "PATCH", ...json({ concurrency }) });

/** Kill switch: mata lo que corre, descarta lo que espera y deja en pausa. */
export const stopQueue = () => api<StopResult>("/queue/stop", { method: "POST" });

/* ── Workspaces ───────────────────────────────────────────────────────────── */

export const getWorkspaceReport = (days?: number) =>
  api<WorkspaceReport>(`/workspaces${days === undefined ? "" : `?days=${days}`}`);

/** Con dryRun devuelve lo que se llevaría sin tocar el disco. */
export const collectWorkspaces = (options: { days?: number; dryRun?: boolean } = {}) =>
  api<GcResult>("/workspaces/gc", { method: "POST", ...json(options) });

export const getTaskDependencies = (taskId: string) =>
  api<{ dependencies: TaskDependency[] }>(`/tasks/${taskId}/dependencies`);

/* ── Filesystem ───────────────────────────────────────────────────────────── */

/** Puntos de partida del explorador: inicio y unidades del disco. */
export const listFsRoots = () => api<BrowseRoot[]>("/fs/roots");

export const browseDirectory = (path?: string) =>
  api<DirListing>(`/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`);

/** CLAUDE.md que ya viva en esa carpeta, para no sobrescribirlo a ciegas. */
export const readClaudeMdFile = (path: string) =>
  api<ClaudeMdFile>(`/fs/claude-md?path=${encodeURIComponent(path)}`);
