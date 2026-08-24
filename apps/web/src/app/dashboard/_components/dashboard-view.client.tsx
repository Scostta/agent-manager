"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Icon } from "@/components/ui/icon";
import { Button, EmptyState, Spinner, cn } from "@/components/ui/primitives.client";
import { formatCost, formatDayShort, formatTokens } from "@/lib/format";
import { useStats } from "@/lib/hooks";

import type { ReactElement } from "react";
import type { Breakdown, DailyPoint, StatsSummary } from "@/lib/types";

/**
 * Paleta categórica validada con el validador del sistema de diseño sobre la
 * superficie #131318 (bg-3): pasa banda de luminosidad, croma, separación CVD y
 * contraste en todos los pares. No sustituir a ojo.
 */
const SERIES = [
  { key: "inputTokens", label: "Input", color: "#7B6CF6" },
  { key: "outputTokens", label: "Output", color: "#C87A3E" },
  { key: "cacheTokens", label: "Caché", color: "#48A0C8" },
] as const;

const SURFACE = "var(--bg-3)";
const GRID = "var(--border-1)";
const INK_MUTED = "var(--text-3)";

const RANGES = [7, 30, 90] as const;

type ChartPoint = DailyPoint & { cacheTokens: number; label: string };

function toChartPoints(daily: DailyPoint[]): ChartPoint[] {
  return daily.map((point) => ({
    ...point,
    cacheTokens: point.cacheReadTokens + point.cacheWriteTokens,
    label: formatDayShort(point.date),
  }));
}

/* ── Piezas ───────────────────────────────────────────────────────────────── */

function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border-1 bg-bg-3 px-4 py-3">
      <span className="text-2xs uppercase tracking-[.06em] text-txt-3">{label}</span>
      <span
        className={cn(
          "font-mono text-lg font-semibold tabular-nums",
          accent ? "text-accent" : "text-txt-1",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-txt-3">{hint}</span>}
    </div>
  );
}

/** Leyenda propia: el texto va en tinta, nunca en el color de la serie. */
function Legend({
  items,
}: {
  items: readonly { label: string; color: string }[];
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-[2px]"
            style={{ background: item.color }}
            aria-hidden="true"
          />
          <span className="text-xs text-txt-2">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function TooltipBox({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; color?: string }[];
}): ReactElement {
  return (
    <div className="rounded-md border border-border-2 bg-bg-4 px-2.5 py-2 shadow-lg">
      <div className="mb-1.5 text-xs font-medium text-txt-1">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2.5">
            {row.color && (
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: row.color }}
                aria-hidden="true"
              />
            )}
            <span className="flex-1 text-xs text-txt-3">{row.label}</span>
            <span className="font-mono text-xs tabular-nums text-txt-1">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactElement;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-1 bg-bg-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-txt-1">{title}</h2>
          {subtitle && <p className="text-xs text-txt-3">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ── Gráficas ─────────────────────────────────────────────────────────────── */

function TokensChart({ points }: { points: ChartPoint[] }): ReactElement {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: INK_MUTED, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          tick={{ fill: INK_MUTED, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(value: number) => formatTokens(value)}
        />
        <Tooltip
          cursor={{ fill: "var(--bg-hover)" }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as ChartPoint;
            return (
              <TooltipBox
                title={String(label)}
                rows={[
                  ...SERIES.map((serie) => ({
                    label: serie.label,
                    value: `${formatTokens(point[serie.key])} tok`,
                    color: serie.color,
                  })),
                  { label: "Coste", value: formatCost(point.costUsd) },
                  { label: "Runs", value: String(point.runs) },
                ]}
              />
            );
          }}
        />
        {SERIES.map((serie, i) => (
          <Bar
            key={serie.key}
            dataKey={serie.key}
            name={serie.label}
            stackId="tokens"
            fill={serie.color}
            // El borde del color de la superficie deja 2px de aire entre
            // segmentos apilados, que es lo que los separa visualmente.
            stroke={SURFACE}
            strokeWidth={2}
            radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
            maxBarSize={38}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function CostChart({ points }: { points: ChartPoint[] }): ReactElement {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7B6CF6" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#7B6CF6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: INK_MUTED, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          tick={{ fill: INK_MUTED, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(value: number) => formatCost(value)}
        />
        <Tooltip
          cursor={{ stroke: "var(--border-3)", strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as ChartPoint;
            return (
              <TooltipBox
                title={String(label)}
                rows={[
                  { label: "Coste", value: formatCost(point.costUsd) },
                  { label: "Tokens", value: `${formatTokens(point.totalTokens)} tok` },
                  { label: "Runs", value: String(point.runs) },
                ]}
              />
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="costUsd"
          name="Coste"
          stroke="#7B6CF6"
          strokeWidth={2}
          fill="url(#costFill)"
          activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function BreakdownChart({ rows }: { rows: Breakdown[] }): ReactElement {
  const height = Math.max(120, rows.length * 34 + 16);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 0, right: 56, bottom: 0, left: 4 }}
      >
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: INK_MUTED, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value: number) => formatTokens(value)}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: "var(--text-2)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={96}
        />
        <Tooltip
          cursor={{ fill: "var(--bg-hover)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as Breakdown;
            return (
              <TooltipBox
                title={row.name}
                rows={[
                  ...(row.detail ? [{ label: "Modelo", value: row.detail }] : []),
                  { label: "Tokens", value: `${formatTokens(row.totalTokens)} tok` },
                  { label: "Coste", value: formatCost(row.costUsd) },
                  { label: "Runs", value: String(row.runs) },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="totalTokens" name="Tokens" radius={[0, 4, 4, 0]} maxBarSize={18}>
          {rows.map((row) => (
            <Cell key={row.id} fill="#7B6CF6" />
          ))}
          <LabelList
            dataKey="totalTokens"
            position="right"
            offset={8}
            fill="var(--text-2)"
            fontSize={10}
            formatter={(value) => formatTokens(Number(value ?? 0))}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DailyTable({ points }: { points: ChartPoint[] }): ReactElement {
  const withData = points.filter((point) => point.runs > 0);

  return (
    <div className="max-h-[240px] overflow-auto">
      <table className="w-full text-left">
        <thead className="sticky top-0 bg-bg-3">
          <tr className="text-2xs uppercase tracking-[.06em] text-txt-3">
            <th className="py-1.5 pr-2 font-medium">Día</th>
            <th className="py-1.5 pr-2 text-right font-medium">Input</th>
            <th className="py-1.5 pr-2 text-right font-medium">Output</th>
            <th className="py-1.5 pr-2 text-right font-medium">Caché</th>
            <th className="py-1.5 pr-2 text-right font-medium">Runs</th>
            <th className="py-1.5 text-right font-medium">Coste</th>
          </tr>
        </thead>
        <tbody className="font-mono text-xs tabular-nums text-txt-2">
          {withData.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center font-sans text-sm text-txt-3">
                Ningún día del rango tiene runs.
              </td>
            </tr>
          )}
          {withData.map((point) => (
            <tr key={point.date} className="border-t border-border-1">
              <td className="py-1.5 pr-2 font-sans text-txt-1">{point.label}</td>
              <td className="py-1.5 pr-2 text-right">{formatTokens(point.inputTokens)}</td>
              <td className="py-1.5 pr-2 text-right">{formatTokens(point.outputTokens)}</td>
              <td className="py-1.5 pr-2 text-right">{formatTokens(point.cacheTokens)}</td>
              <td className="py-1.5 pr-2 text-right">{point.runs}</td>
              <td className="py-1.5 text-right text-accent">{formatCost(point.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Vista ────────────────────────────────────────────────────────────────── */

function Loaded({ stats }: { stats: StatsSummary }): ReactElement {
  const [asTable, setAsTable] = useState(false);
  const points = toChartPoints(stats.daily);
  const { totals } = stats;

  if (totals.runs === 0) {
    return (
      <EmptyState
        icon="dollar"
        title="Sin consumo en este rango"
        hint="Los datos salen de las runs ya ejecutadas. Lanza una task desde el kanban y aquí aparecerán los tokens y el coste."
      />
    );
  }

  const cachePct = totals.totalTokens
    ? Math.round(((totals.cacheReadTokens + totals.cacheWriteTokens) / totals.totalTokens) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <StatTile
          label="Tokens"
          value={formatTokens(totals.totalTokens)}
          hint={`${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`}
        />
        <StatTile label="Coste" value={formatCost(totals.costUsd)} accent />
        <StatTile
          label="Runs"
          value={String(totals.runs)}
          hint={`${totals.succeeded} ok · ${totals.failed} fallidas`}
        />
        <StatTile
          label="Coste por run"
          value={formatCost(totals.runs ? totals.costUsd / totals.runs : 0)}
          hint={`${cachePct}% de los tokens son caché`}
        />
      </div>

      <ChartCard
        title="Tokens por día"
        subtitle="Apilado por tipo. La caché suma lectura y escritura."
        action={
          <div className="flex items-center gap-3">
            <Legend items={SERIES} />
            <Button
              variant="ghost"
              size="xs"
              icon={asTable ? "activity" : "layers"}
              onClick={() => setAsTable((current) => !current)}
            >
              {asTable ? "Gráfica" : "Tabla"}
            </Button>
          </div>
        }
      >
        {asTable ? <DailyTable points={points} /> : <TokensChart points={points} />}
      </ChartCard>

      <ChartCard title="Coste por día" subtitle="USD acumulado por jornada.">
        <CostChart points={points} />
      </ChartCard>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
        <ChartCard title="Tokens por agente" subtitle="Quién consume el presupuesto.">
          <BreakdownChart rows={stats.byAgent} />
        </ChartCard>
        <ChartCard title="Tokens por proyecto" subtitle="Dónde se está gastando.">
          <BreakdownChart rows={stats.byProject} />
        </ChartCard>
      </div>

      {stats.byModel.length > 1 && (
        <ChartCard title="Tokens por modelo" subtitle="Reparto entre modelos usados.">
          <BreakdownChart rows={stats.byModel} />
        </ChartCard>
      )}
    </div>
  );
}

export function DashboardView(): ReactElement {
  const [days, setDays] = useState<number>(30);
  const { data: stats, error, isLoading } = useStats(days);

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-txt-1">Consumo</h1>
          <p className="text-sm text-txt-3">
            Tokens y coste de todas las runs, por día, agente y proyecto.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border-2 bg-bg-3 p-0.5">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              className={cn(
                "rounded-sm px-2.5 py-1 text-xs transition-colors",
                days === range
                  ? "bg-bg-5 font-medium text-txt-1"
                  : "text-txt-3 hover:text-txt-2",
              )}
            >
              {range} días
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">
          <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
          <span>
            No se pudo cargar el consumo desde{" "}
            <span className="font-mono">localhost:3001</span>.
          </span>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner size={18} />
        </div>
      )}

      {stats && <Loaded stats={stats} />}
    </div>
  );
}
