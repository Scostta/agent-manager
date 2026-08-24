"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { Badge, Kbd, cn } from "@/components/ui/primitives";
import { useProjects } from "@/lib/hooks";
import { shortenPath } from "@/lib/format";

type Entry = {
  kind: "project" | "action";
  label: string;
  sub: string;
  icon: IconName;
  run: () => void;
};

const KIND_COLOR: Record<Entry["kind"], string> = {
  project: "text-accent",
  action: "text-txt-3",
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { data: projects } = useProjects();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const items: Entry[] = (projects ?? []).map((project) => ({
      kind: "project",
      label: project.name,
      sub: shortenPath(project.repoPath),
      icon: "folder",
      run: () => router.push(`/projects/${project.id}`),
    }));
    items.push({
      kind: "action",
      label: "Ver todos los proyectos",
      sub: "Ir a la lista de proyectos",
      icon: "folder",
      run: () => router.push("/projects"),
    });
    return items;
  }, [projects, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.label.toLowerCase().includes(q) || e.sub.toLowerCase().includes(q),
    );
  }, [entries, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        filtered[selected]?.run();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, selected, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/70 pt-[12vh] backdrop-blur-[4px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-[560px] animate-slide-up overflow-hidden rounded-xl border border-border-2 bg-bg-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
      >
        <div className="flex items-center gap-2.5 border-b border-border-1 px-4 py-3">
          <Icon name="search" size={15} className="text-txt-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar proyectos…"
            className="flex-1 bg-transparent text-md text-txt-1 outline-none placeholder:text-txt-3"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <div className="px-6 py-6 text-center text-base text-txt-3">
              Sin resultados para “{query}”
            </div>
          )}
          {filtered.map((entry, i) => (
            <button
              key={`${entry.kind}-${entry.label}`}
              type="button"
              onMouseEnter={() => setSelected(i)}
              onClick={() => {
                entry.run();
                onClose();
              }}
              className={cn(
                "mb-px flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                i === selected ? "bg-bg-5" : "bg-transparent",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-5",
                  KIND_COLOR[entry.kind],
                )}
              >
                <Icon name={entry.icon} size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium text-txt-1">{entry.label}</span>
                <span className="block truncate-1 font-mono text-xs text-txt-3">
                  {entry.sub}
                </span>
              </span>
              <Badge variant="ghost" size="xs">
                {entry.kind === "project" ? "proyecto" : "acción"}
              </Badge>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3.5 border-t border-border-1 px-4 py-2">
          {[
            ["↑↓", "navegar"],
            ["↵", "abrir"],
            ["esc", "cerrar"],
          ].map(([key, label]) => (
            <span key={key} className="flex items-center gap-1.5">
              <Kbd>{key}</Kbd>
              <span className="text-xs text-txt-3">{label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
