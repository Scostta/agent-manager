export function formatRelative(input: string | number | null | undefined): string {
  if (!input) return "";
  const ts = typeof input === "string" ? Date.parse(input) : input;
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "ahora mismo";
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)}h`;
  return `hace ${Math.floor(diff / 86_400_000)}d`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/** "2026-08-24" → "24 ago". El backend ya manda el día en hora local. */
export function formatDayShort(isoDay: string): string {
  const [, month, day] = isoDay.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""}`.trim();
}

/** Acorta rutas largas por el centro: C:\…\proyectos\repo */
export function shortenPath(path: string, maxLength = 48): string {
  if (path.length <= maxLength) return path;
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path.slice(0, maxLength - 1) + "…";
  return `${parts[0]}${path.includes("\\") ? "\\" : "/"}…${path.includes("\\") ? "\\" : "/"}${parts.slice(-2).join(path.includes("\\") ? "\\" : "/")}`;
}
