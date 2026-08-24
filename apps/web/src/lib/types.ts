export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type WorkspaceStrategy = "worktree" | "copy";

export type Project = {
  id: string;
  name: string;
  description: string | null;
  repoPath: string;
  workspaceStrategy: WorkspaceStrategy;
  claudeMdId: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number };
  /** Desglose por estado que añade GET /projects. Un estado sin tasks se omite. */
  taskCounts?: Partial<Record<TaskStatus, number>>;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  filePath: string;
  contentHash: string;
  scope: string;
  tags: string[];
  updatedAt: string;
};

export type Agent = {
  id: string;
  name: string;
  role: string;
  model: string;
  systemPrompt: string;
  maxBudgetUsd: number | null;
  status: string;
  skills?: { skillId: string; skill: Skill }[];
  _count?: { runs: number };
  createdAt: string;
  updatedAt: string;
};

export type TaskRun = {
  id: string;
  taskId: string;
  agentId: string;
  status: RunStatus;
  workspacePath: string;
  branchName: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  logPath: string;
  resultSummary: string | null;
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
};

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** La API usa Int. Convención del cockpit: 0 = low, 1 = medium, 2 = high. */
  priority: number;
  assignedAgentId: string | null;
  assignedAgent: Agent | null;
  requiredSkillIds: string[];
  dependsOn: string[];
  position: number;
  /** GET /projects/:id/tasks devuelve solo la run más reciente. */
  runs: TaskRun[];
  createdAt: string;
  updatedAt: string;
};

export type QueueStats = {
  pending: number;
  waiting: number;
  concurrency: number;
};

export type BoardEvent =
  | { type: "task_created"; taskId: string }
  | { type: "task_updated"; taskId: string }
  | { type: "task_deleted"; taskId: string };

export const PRIORITY_LOW = 0;
export const PRIORITY_MEDIUM = 1;
export const PRIORITY_HIGH = 2;

/** Una run se considera activa mientras ocupa un hueco de la cola. */
export function isActiveRun(run: TaskRun | undefined): boolean {
  return !!run && (run.status === "running" || run.status === "queued");
}

export function latestRun(task: Task): TaskRun | undefined {
  return task.runs?.[0];
}

export type ClaudeMdScope = "global" | "project" | "agent";

export type ClaudeMd = {
  id: string;
  scope: ClaudeMdScope;
  content: string;
  filePath: string | null;
  updatedAt: string;
  /** GET /claude-md incluye el proyecto; GET /claude-md/:id no. */
  project?: Project | null;
};

/** GET /runs/:id incluye task y agente; la lista del board no. */
export type RunWithContext = TaskRun & { task: Task; agent: Agent };

/** Eventos de /runs/:id/stream. Espejo de `RunEvent` en apps/api/src/bus.ts. */
export type RunEvent =
  | { type: "stream"; data: unknown }
  | {
      type: "tokens";
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      costUsd: number;
    }
  | { type: "status"; status: Exclude<RunStatus, "queued"> }
  | { type: "log"; line: string };

export type RunDiff = { branchName: string; diff: string };

export type SkillContent = { content: string; filePath: string };

/** Modelos con tarifa conocida en apps/api/src/runner/pricing.ts. Uno fuera de
 *  esta lista funciona, pero el coste se estima con la tarifa más cara. */
export const MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
] as const;
