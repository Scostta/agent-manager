"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { StatusDot, cn } from "@/components/ui/primitives.client";
import { useProjects, useQueueStats } from "@/lib/hooks";

import type { ReactElement } from "react";
import type { IconName } from "@/components/ui/icon";

const NAV = [
  { href: "/projects", icon: "folder", label: "Projects" },
  { href: "/agents", icon: "bot", label: "Agents" },
  { href: "/skills", icon: "layers", label: "Skills" },
  { href: "/claude-md", icon: "file", label: "CLAUDE.md" },
] as const satisfies readonly { href: string; icon: IconName; label: string }[];

export function Sidebar(): ReactElement {
  const pathname = usePathname();
  const { data: projects } = useProjects();
  const { data: queue } = useQueueStats();

  const activeRuns = (queue?.pending ?? 0) + (queue?.waiting ?? 0);

  return (
    <aside className="flex h-screen w-sidebar shrink-0 flex-col border-r border-border-1 bg-bg-2">
      <div className="flex h-header shrink-0 items-center gap-2 border-b border-border-1 px-3.5">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-accent/30 bg-accent-dim text-accent">
          <Icon name="activity" size={12} />
        </span>
        <span className="text-base font-semibold tracking-tight text-txt-1">Cockpit</span>
      </div>

      <nav className="flex flex-1 flex-col gap-px overflow-y-auto p-1.5">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-base transition-colors",
                active
                  ? "bg-bg-active font-medium text-txt-1"
                  : "text-txt-2 hover:bg-bg-hover",
              )}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
            </Link>
          );
        })}

        {!!projects?.length && (
          <>
            <div className="mx-1 mb-1 mt-3 text-2xs font-semibold uppercase tracking-[.08em] text-txt-3">
              Recientes
            </div>
            {projects.slice(0, 5).map((project) => {
              const active = pathname === `/projects/${project.id}`;
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-1 text-sm transition-colors",
                    active
                      ? "bg-bg-active text-txt-1"
                      : "text-txt-3 hover:bg-bg-hover hover:text-txt-2",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-[2px]",
                      active ? "bg-accent" : "bg-border-3",
                    )}
                  />
                  <span className="truncate-1">{project.name}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="shrink-0 border-t border-border-1 p-1.5">
        {activeRuns > 0 ? (
          <div className="flex items-center gap-2 rounded-md bg-accent-dim px-2.5 py-1.5 text-sm text-accent">
            <StatusDot status="running" pulse />
            <span className="font-medium">
              {activeRuns} {activeRuns === 1 ? "run activa" : "runs activas"}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2.5 py-1.5 text-sm text-txt-3">
            <StatusDot status="idle" />
            Sin runs activas
          </div>
        )}
      </div>
    </aside>
  );
}
