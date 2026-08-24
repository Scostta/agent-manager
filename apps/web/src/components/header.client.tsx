"use client";

import { usePathname } from "next/navigation";
import { Command } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { queue } from "~/lib/api";
import { cn } from "~/lib/cn";

const SEGMENT_LABELS: Record<string, string> = {
  projects: "Proyectos",
  agents: "Agentes",
  skills: "Skills",
  "claude-md": "CLAUDE.md",
  settings: "Ajustes",
  new: "Nuevo",
};

function Breadcrumb(): ReactElement {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <nav className="flex items-center gap-1.5 text-sm">
      {segments.map((seg, i) => {
        const label = SEGMENT_LABELS[seg] ?? seg;
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-text-3">/</span>}
            <span className={cn(isLast ? "text-text-1" : "text-text-2")}>
              {label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

function QueueBadge(): ReactElement {
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const stats = await queue.stats();
        if (alive) setActive(stats.size + stats.pending);
      } catch {
        // sin conexión con la API, no rompemos la UI
      }
    }

    void poll();
    const id = setInterval(() => void poll(), 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (active === 0) return <></>;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-dim px-2 py-0.5 text-xs font-medium text-blue">
      <span className="h-1.5 w-1.5 rounded-full bg-blue animate-pulse" />
      {active} activa{active !== 1 ? "s" : ""}
    </span>
  );
}

export function Header(): ReactElement {
  return (
    <header
      className="flex h-[44px] shrink-0 items-center justify-between border-b border-border-1 bg-bg-2 px-4"
      style={{ height: "var(--header-h)" }}
    >
      <Breadcrumb />
      <div className="flex items-center gap-3">
        <QueueBadge />
        <button
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text-3 transition-colors hover:bg-bg-hover hover:text-text-2"
          aria-label="Abrir paleta de comandos"
        >
          <Command size={12} />
          <span>K</span>
        </button>
      </div>
    </header>
  );
}
