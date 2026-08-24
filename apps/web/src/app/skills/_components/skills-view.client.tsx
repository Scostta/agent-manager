"use client";

import { useState, type ReactElement } from "react";
import useSWR from "swr";
import { Search, RefreshCw, Zap, X, FileCode } from "lucide-react";
import { skills as skillsApi, type SkillWithParsedTags } from "~/lib/api";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/cn";

function SkillDetail({
  skill,
  onClose,
}: {
  skill: SkillWithParsedTags;
  onClose: () => void;
}): ReactElement {
  const { data, isLoading } = useSWR(
    `/skills/${skill.id}/content`,
    () => skillsApi.content(skill.id),
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-border-2 bg-bg-2 shadow-lg">
        <div className="flex shrink-0 items-center justify-between border-b border-border-1 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileCode size={14} className="text-accent" />
            <span className="text-sm font-medium text-text-1">{skill.name}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-medium text-text-3">Scope</p>
              <Badge variant="accent" className="mt-1">
                {skill.scope}
              </Badge>
            </div>

            {skill.tags.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-text-3">Tags</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {skill.tags.map((t) => (
                    <Badge key={t} variant="default">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-medium text-text-3">Ruta</p>
              <p className="mt-1 break-all font-mono text-xs text-text-2">
                {skill.filePath}
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-text-3">Contenido</p>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner className="text-text-3" size={16} />
                </div>
              ) : data ? (
                <pre className="overflow-x-auto rounded border border-border-1 bg-bg-3 p-3 font-mono text-xs text-text-1 leading-relaxed whitespace-pre-wrap">
                  {data.content}
                </pre>
              ) : (
                <p className="text-xs text-text-3">
                  No se pudo cargar el contenido
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SkillCard({
  skill,
  onClick,
}: {
  skill: SkillWithParsedTags;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-2.5 rounded-lg border border-border-2 bg-bg-2 p-4 text-left transition-colors hover:border-border-3 hover:bg-bg-3"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text-1">{skill.name}</p>
        <Badge variant="accent">{skill.scope}</Badge>
      </div>
      <p className="line-clamp-2 text-xs text-text-2">{skill.description}</p>
      {skill.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {skill.tags.map((t) => (
            <Badge key={t} variant="default">
              {t}
            </Badge>
          ))}
        </div>
      ) : null}
    </button>
  );
}

export function SkillsView(): ReactElement {
  const { data, error, isLoading, mutate } = useSWR(
    "/skills",
    () => skillsApi.list(),
    { refreshInterval: 0 },
  );

  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillWithParsedTags | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);

  const allSkills = data ?? [];

  const allTags = Array.from(
    new Set(allSkills.flatMap((s) => s.tags)),
  ).sort();

  const filtered = allSkills.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    const matchTag = tagFilter ? s.tags.includes(tagFilter) : true;
    return matchSearch && matchTag;
  });

  async function handleRescan() {
    setIsRescanning(true);
    try {
      await skillsApi.rescan();
      await mutate();
    } catch {
      // error silencioso, la UI ya mostrará el estado actualizado
    } finally {
      setIsRescanning(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-6 pb-4 pt-6">
        <h1 className="text-base font-semibold text-text-1">Skills</h1>
        <Button
          variant="subtle"
          size="sm"
          isLoading={isRescanning}
          onClick={() => void handleRescan()}
        >
          <RefreshCw size={13} />
          Rescanear
        </Button>
      </div>

      <div className="px-6 pb-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-3">
          <Input
            inputSize="sm"
            placeholder="Buscar skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            prefixIcon={<Search size={12} />}
          />

          {allTags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setTagFilter(null)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  tagFilter === null
                    ? "bg-accent text-white"
                    : "bg-bg-4 text-text-2 hover:bg-bg-5",
                )}
              >
                Todos
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() =>
                    setTagFilter(tag === tagFilter ? null : tag)
                  }
                  className={cn(
                    "rounded px-2.5 py-1 text-xs transition-colors",
                    tagFilter === tag
                      ? "bg-accent text-white"
                      : "bg-bg-4 text-text-2 hover:bg-bg-5",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-6 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner className="text-text-3" size={20} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <p className="text-sm text-red">No se pudo conectar con la API</p>
            <Button variant="ghost" size="sm" onClick={() => void mutate()}>
              Reintentar
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <Zap size={40} className="text-text-3" />
            <div>
              <p className="text-sm font-medium text-text-1">
                {search || tagFilter ? "Sin resultados" : "Sin skills indexadas"}
              </p>
              <p className="mt-1 text-xs text-text-3">
                {search || tagFilter
                  ? "Prueba con otros filtros"
                  : "Haz clic en Rescanear para indexar SKILL.md del disco"}
              </p>
            </div>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
          >
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onClick={() => setSelectedSkill(skill)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedSkill ? (
        <SkillDetail
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
        />
      ) : null}
    </>
  );
}
