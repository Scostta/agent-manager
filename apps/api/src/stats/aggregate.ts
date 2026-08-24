/**
 * Agregación de consumo a partir de las TaskRun. Vive fuera de la ruta porque
 * es la lógica de negocio del dashboard: la ruta solo valida y sirve.
 *
 * Todo se calcula en memoria: una instalación personal no acumula el volumen de
 * runs que justificaría un GROUP BY en SQL, y así el rango de fechas y el
 * relleno de días vacíos se hacen en un solo sitio.
 */

export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** input + output + caché: el número que la UI enseña como "tokens". */
  totalTokens: number;
  costUsd: number;
  runs: number;
};

export type DailyPoint = TokenTotals & { date: string };

export type Breakdown = TokenTotals & {
  id: string;
  name: string;
  /** Modelo del agente o ruta del proyecto, según el corte. */
  detail: string;
};

export type StatsSummary = {
  since: string;
  days: number;
  totals: TokenTotals & { succeeded: number; failed: number; cancelled: number };
  daily: DailyPoint[];
  byAgent: Breakdown[];
  byProject: Breakdown[];
  byModel: Breakdown[];
};

/** Fila mínima que necesita el agregador; evita acoplar esto al tipo de Prisma. */
export type RunRow = {
  id: string;
  status: string;
  startedAt: Date;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  agent: { id: string; name: string; model: string };
  task: { project: { id: string; name: string } };
};

function emptyTotals(): TokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    runs: 0,
  };
}

function add(target: TokenTotals, run: RunRow): void {
  target.inputTokens += run.inputTokens;
  target.outputTokens += run.outputTokens;
  target.cacheReadTokens += run.cacheReadTokens;
  target.cacheWriteTokens += run.cacheWriteTokens;
  target.totalTokens +=
    run.inputTokens + run.outputTokens + run.cacheReadTokens + run.cacheWriteTokens;
  target.costUsd += run.costUsd;
  target.runs += 1;
}

/** YYYY-MM-DD en hora local: el usuario mira su día, no el UTC. */
export function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Medianoche local de hace `days - 1` días: el rango incluye el día de hoy. */
export function rangeStart(days: number, now = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

function groupBy(
  runs: RunRow[],
  key: (run: RunRow) => { id: string; name: string; detail: string },
): Breakdown[] {
  const buckets = new Map<string, Breakdown>();

  for (const run of runs) {
    const meta = key(run);
    let bucket = buckets.get(meta.id);
    if (!bucket) {
      bucket = { ...meta, ...emptyTotals() };
      buckets.set(meta.id, bucket);
    }
    add(bucket, run);
  }

  return [...buckets.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

export function summarize(runs: RunRow[], days: number, now = new Date()): StatsSummary {
  const start = rangeStart(days, now);

  const totals = {
    ...emptyTotals(),
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };

  // Un día sin runs tiene que aparecer con ceros: si no, el eje temporal se
  // comprime y dos días separados por una semana salen pegados.
  const byDay = new Map<string, DailyPoint>();
  for (let i = 0; i < days; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const date = localDay(day);
    byDay.set(date, { date, ...emptyTotals() });
  }

  for (const run of runs) {
    add(totals, run);
    if (run.status === "succeeded") totals.succeeded += 1;
    if (run.status === "failed") totals.failed += 1;
    if (run.status === "cancelled") totals.cancelled += 1;

    const point = byDay.get(localDay(run.startedAt));
    if (point) add(point, run);
  }

  return {
    since: start.toISOString(),
    days,
    totals,
    daily: [...byDay.values()],
    byAgent: groupBy(runs, (run) => ({
      id: run.agent.id,
      name: run.agent.name,
      detail: run.agent.model,
    })),
    byProject: groupBy(runs, (run) => ({
      id: run.task.project.id,
      name: run.task.project.name,
      detail: "",
    })),
    byModel: groupBy(runs, (run) => ({
      id: run.agent.model,
      name: run.agent.model,
      detail: "",
    })),
  };
}
