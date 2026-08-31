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

/* ── Explorador de carpetas (GET /fs/*) ───────────────────────────────────── */

export type DirEntry = { name: string; path: string; isGitRepo: boolean };

export type DirListing = {
  path: string;
  name: string;
  /** null en una raíz (`C:\`, `/`): no hay dónde subir. */
  parent: string | null;
  exists: boolean;
  isGitRepo: boolean;
  isEmpty: boolean;
  /** "\\" o "/": el cliente compone rutas nuevas y no puede adivinarlo. */
  separator: string;
  entries: DirEntry[];
};

export type BrowseRoot = { name: string; path: string };

export type ClaudeMdFile = { exists: boolean; path: string; content: string | null };

/* ── Planificación del backlog inicial ────────────────────────────────────── */

export type PlannedTask = {
  title: string;
  description: string;
  /** Índices dentro del propio array: las tasks aún no existen en BD. */
  dependsOn: number[];
};

export type PlanResult = {
  tasks: PlannedTask[];
  model: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
  logPath: string;
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
  /** Color del avatar, hex. null = se deriva del nombre. */
  color: string | null;
  /** Herramientas del CLI que puede usar. Vacías = sin restricción. */
  allowedTools: string[];
  disallowedTools: string[];
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
  /** "rate_limit" = sin cuota, esperando decisión; "rate_limit_waiting" = se
   *  reintentará sola al reset; "error" = fallo normal. */
  failureKind: string | null;
  rateLimitResetAt: string | null;
  /** session_id del CLI. Sin él no se puede retomar la conversación. */
  sessionId: string | null;
  /** Run cuya sesión continúa esta. Comparte su workspace y su rama. */
  resumedFromId: string | null;
  /** Instrucciones con las que se retomó. null en una run de primera vuelta. */
  followUpPrompt: string | null;
  startedAt: string;
  endedAt: string | null;
};

/** GET /runs/:id/resume. Si se puede seguir la conversación de esta run. */
export type ResumeStatus = {
  canResume: boolean;
  reason: string | null;
  sessionId: string | null;
};

export function isRateLimited(run: { failureKind?: string | null } | null | undefined): boolean {
  return run?.failureKind === "rate_limit" || run?.failureKind === "rate_limit_waiting";
}

export type WindowUsage = TokenTotals & { since: string };

/** GET /stats/plan. Solo cuenta lo que ha ejecutado el cockpit. */
export type PlanUsage = {
  authMode: "subscription" | "api_key";
  /** Ventana de 5h, la que usa el plan para el límite de sesión. */
  session: WindowUsage;
  week: WindowUsage;
  limit: {
    runId: string;
    taskId: string;
    /** true si ya se programó el reintento al reset. */
    waiting: boolean;
    resetAt: string | null;
    message: string | null;
    hitAt: string;
  } | null;
};

export type RetryMode = "wait" | "api_key" | "now";

export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** input + output + caché. Es el número que la UI enseña como "tokens". */
  totalTokens: number;
  costUsd: number;
  runs: number;
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
  dependsOn: string[];
  position: number;
  /** GET /projects/:id/tasks devuelve solo la run más reciente. */
  runs: TaskRun[];
  /** Suma de TODAS las runs de la task, reintentos incluidos. */
  totals: TokenTotals;
  createdAt: string;
  updatedAt: string;
};

export type QueueStats = {
  /** Runs ejecutándose ahora mismo. */
  pending: number;
  /** Runs esperando turno. */
  waiting: number;
  concurrency: number;
  paused: boolean;
};

export type StopResult = {
  discarded: number;
  killed: number;
  queue: QueueStats;
};

export type BoardEvent =
  | { type: "task_created"; taskId: string }
  | { type: "task_updated"; taskId: string }
  | { type: "task_deleted"; taskId: string }
  /** Pausa, concurrencia o kill switch. */
  | { type: "queue_changed" }
  /** Una run que acaba de terminar. Trae lo justo para pintar el aviso. */
  | {
      type: "run_finished";
      runId: string;
      taskId: string;
      taskTitle: string;
      agentName: string;
      status: "succeeded" | "failed" | "cancelled";
    };

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

export type DailyPoint = TokenTotals & { date: string };

/** Corte del consumo por agente, proyecto o modelo. */
export type Breakdown = TokenTotals & { id: string; name: string; detail: string };

export type StatsSummary = {
  since: string;
  days: number;
  totals: TokenTotals & { succeeded: number; failed: number; cancelled: number };
  daily: DailyPoint[];
  byAgent: Breakdown[];
  byProject: Breakdown[];
  byModel: Breakdown[];
};

/** `global` se inyecta en todas las runs; `project`, solo en las de su proyecto. */
export type ClaudeMdScope = "global" | "project";

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

/** Fila de GET /runs: solo lo justo de task y agente para pintar la tabla. */
export type RunListItem = TaskRun & {
  task: { id: string; title: string; projectId: string };
  agent: { id: string; name: string; model: string; color: string | null };
};

export type RunList = {
  runs: RunListItem[];
  /** Total que cumple el filtro, no lo devuelto en esta página. */
  total: number;
  limit: number;
  offset: number;
};

export const RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const satisfies readonly RunStatus[];

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "En cola",
  running: "Ejecutando",
  succeeded: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada",
};

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

/** Eventos de /projects/:id/plan/stream. Espejo de `PlanEvent` en bus.ts. */
export type PlanEvent =
  | { type: "stream"; data: unknown }
  | { type: "log"; line: string }
  | { type: "done"; cancelled: boolean };

export type RunDiff = { branchName: string; base: string; diff: string };

/** GET /runs/:id/branch. Todo se deriva de git en vivo, no de la BD. */
export type BranchStatus = {
  branchName: string | null;
  /** Rama destino del merge: main, master o la actual del repo. */
  base: string | null;
  branchExists: boolean;
  worktreeExists: boolean;
  /** El trabajo de la run ya está en la base. */
  merged: boolean;
  commits: number;
  uncommitted: number;
  canMerge: boolean;
  blockedReason: string | null;
};

export type MergeResult = {
  base: string;
  branchName: string;
  /** El cockpit tuvo que commitear lo que el agente dejó suelto. */
  committed: boolean;
};

/** GET /runs/:id/log. `lines` son las últimas `tail` líneas del NDJSON. */
export type RunLog = { lines: string[]; totalLines: number; truncated: boolean };

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

export type WorkspaceEntrySummary = {
  runId: string;
  taskId: string;
  sizeBytes: number;
  branchName: string | null;
  /** "all" borra directorio y rama, "dir" conserva la rama, "keep" no toca. */
  action: "all" | "dir" | "keep";
  reason: string;
};

/** GET /workspaces. `reclaimable` es lo que el GC se llevaría ahora mismo. */
export type WorkspaceReport = {
  root: string;
  olderThanDays: number;
  total: { count: number; sizeBytes: number };
  reclaimable: { count: number; sizeBytes: number };
  entries: WorkspaceEntrySummary[];
};

export type GcResult = {
  removed: number;
  freedBytes: number;
  /** Cuántos conservaron su rama pese a borrarse el directorio. */
  keptBranches: number;
  dryRun: boolean;
};

/** GET /tasks/:id/dependencies. `status: null` = la tarea ya no existe. */
export type TaskDependency = {
  id: string;
  title: string | null;
  status: TaskStatus | null;
  /** Cumplida: en Hecho, o borrada (una tarea que no existe no bloquea). */
  done: boolean;
};

/** Las que impiden lanzar. Una lista vacía significa vía libre. */
export function blockingOf(deps: TaskDependency[]): TaskDependency[] {
  return deps.filter((dep) => !dep.done);
}
