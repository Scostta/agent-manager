// Enums de estado — strings literales que Prisma guarda como String
export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked";
export type TaskRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type AgentStatus = "idle" | "running" | "paused" | "disabled";
export type ClaudeMdScope = "global" | "project" | "agent";
export type SkillScope = "public" | "user" | "project";

// Modelos de dominio — reflejan el schema Prisma sin los campos de relación raw
export interface Project {
  id: string;
  name: string;
  description: string | null;
  repoPath: string;
  claudeMdId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  systemPrompt: string;
  maxBudgetUsd: number | null;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  filePath: string;
  contentHash: string;
  scope: SkillScope;
  tags: string; // JSON array serializado
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  assignedAgentId: string | null;
  requiredSkillIds: string; // JSON array serializado
  dependsOn: string; // JSON array serializado
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRun {
  id: string;
  taskId: string;
  agentId: string;
  status: TaskRunStatus;
  workspacePath: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  logPath: string;
  resultSummary: string | null;
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
}

export interface ClaudeMd {
  id: string;
  scope: ClaudeMdScope;
  content: string;
  filePath: string | null;
  updatedAt: string;
}

// Tipos compuestos para las respuestas de la API
export interface TaskWithLatestRun extends Task {
  assignedAgent: Agent | null;
  runs: TaskRun[];
}

export interface TaskRunWithContext extends TaskRun {
  task: Task;
  agent: Agent;
}

export interface AgentWithSkills extends Agent {
  skills: Array<{ agentId: string; skillId: string; skill: Skill }>;
}

// Eventos SSE del board
export type BoardEvent =
  | { type: "task_created"; taskId: string }
  | { type: "task_updated"; taskId: string }
  | { type: "task_deleted"; taskId: string }
  | { type: "ping" };

// Eventos SSE de una run
export type RunEvent =
  | { type: "status"; status: TaskRunStatus }
  | { type: "token_usage"; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number }
  | { type: "log"; line: string }
  | { type: "error"; message: string }
  | { type: "ping" };

// Respuesta de GET /queue/stats
export interface QueueStats {
  size: number;
  pending: number;
}
