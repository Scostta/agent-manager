"use client";

import { useEffect, useState } from "react";

import { CommandPalette } from "@/components/shell/command-palette.client";
import { Header } from "@/components/shell/header.client";
import { Sidebar } from "@/components/shell/sidebar.client";

import type { ReactElement, ReactNode } from "react";
import type { Crumb } from "@/components/shell/header.client";

export function AppShell({ crumbs, children }: { crumbs: Crumb[]; children: ReactNode }): ReactElement {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header crumbs={crumbs} onOpenPalette={() => setPaletteOpen(true)} />
        <main className="relative flex-1 overflow-hidden">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
