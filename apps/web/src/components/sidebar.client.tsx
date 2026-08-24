"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  FileText,
  LayoutGrid,
  Settings,
  Terminal,
  Zap,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "~/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: ReactElement;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/projects", label: "Proyectos", icon: <LayoutGrid size={15} /> },
  { href: "/agents", label: "Agentes", icon: <Bot size={15} /> },
  { href: "/skills", label: "Skills", icon: <Zap size={15} /> },
  { href: "/claude-md", label: "CLAUDE.md", icon: <FileText size={15} /> },
];

export function Sidebar(): ReactElement {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside
      className="flex h-screen w-[200px] shrink-0 flex-col border-r border-border-1 bg-bg-2"
      style={{ width: "var(--sidebar-w)" }}
    >
      {/* Logo */}
      <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-border-1 px-4">
        <Terminal size={15} className="text-accent" />
        <span className="text-sm font-semibold text-text-1">Cockpit</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded px-2.5 py-1.5 text-sm transition-colors",
              isActive(item.href)
                ? "bg-bg-active text-text-1"
                : "text-text-2 hover:bg-bg-hover hover:text-text-1",
            )}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-border-1 p-2">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 rounded px-2.5 py-1.5 text-sm transition-colors",
            isActive("/settings")
              ? "bg-bg-active text-text-1"
              : "text-text-2 hover:bg-bg-hover hover:text-text-1",
          )}
        >
          <Settings size={15} />
          Ajustes
        </Link>
      </div>
    </aside>
  );
}
