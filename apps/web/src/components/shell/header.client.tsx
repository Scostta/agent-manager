"use client";

import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { Kbd, StatusDot } from "@/components/ui/primitives.client";
import { useQueueStats } from "@/lib/hooks";

import type { ReactElement } from "react";

export type Crumb = { label: string; href?: string };

export function Header({
  crumbs,
  onOpenPalette,
}: {
  crumbs: Crumb[];
  onOpenPalette: () => void;
}): ReactElement {
  const { data: queue } = useQueueStats();
  const running = queue?.pending ?? 0;
  const waiting = queue?.waiting ?? 0;

  return (
    <header className="flex h-header shrink-0 items-center justify-between border-b border-border-1 bg-bg-2 px-4">
      <div className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <div key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <Icon name="chevronRight" size={11} className="text-txt-3" />}
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="text-base text-txt-3 transition-colors hover:text-txt-1"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={
                    last
                      ? "truncate-1 text-base font-medium text-txt-1"
                      : "text-base text-txt-3"
                  }
                >
                  {crumb.label}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {running > 0 && (
          <span className="flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent-dim px-2.5 py-1 text-sm font-medium text-accent">
            <StatusDot status="running" pulse />
            {running} {running === 1 ? "run" : "runs"}
            {waiting > 0 && <span className="text-txt-3">· {waiting} en cola</span>}
          </span>
        )}
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex items-center gap-1.5 rounded-md border border-border-2 bg-bg-4 px-2.5 py-1 text-sm text-txt-3 transition-colors hover:border-border-3 hover:text-txt-2"
        >
          <Icon name="search" size={11} />
          <span>Buscar</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>
    </header>
  );
}
