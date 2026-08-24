"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Icon } from "@/components/ui/icon";
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  Input,
  Spinner,
  cn,
} from "@/components/ui/primitives.client";
import { useToast } from "@/components/ui/toast.client";
import { getSkillContent, rescanSkills } from "@/lib/api";
import { formatRelative, shortenPath } from "@/lib/format";
import { keys, useSkills } from "@/lib/hooks";

import type { ReactElement } from "react";
import type { Skill } from "@/lib/types";

function SkillRow({
  skill,
  active,
  onSelect,
}: {
  skill: Skill;
  active: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-accent/35 bg-accent-dim"
          : "border-border-1 bg-bg-3 hover:border-border-3 hover:bg-bg-4",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon name="layers" size={12} className={active ? "text-accent" : "text-txt-3"} />
        <span
          className={cn(
            "truncate-1 text-base font-medium",
            active ? "text-accent" : "text-txt-1",
          )}
        >
          {skill.name}
        </span>
      </div>
      <span className="truncate-1 text-sm text-txt-3">
        {skill.description || "Sin descripción en el frontmatter"}
      </span>
      {!!skill.tags.length && (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {skill.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="ghost" size="xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </button>
  );
}

function SkillDetail({ skill }: { skill: Skill }): ReactElement {
  const {
    data: file,
    error,
    isLoading,
  } = useSWR(`/skills/${skill.id}/content`, () => getSkillContent(skill.id));

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="shrink-0 border-b border-border-1 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-md font-semibold text-txt-1">{skill.name}</h2>
            <p className="text-sm text-txt-2">
              {skill.description || "Sin descripción en el frontmatter"}
            </p>
          </div>
          <Badge variant="accent" size="sm">
            {skill.scope}
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-txt-3">
          <span className="flex items-center gap-1.5 font-mono" title={skill.filePath}>
            <Icon name="file" size={11} />
            {shortenPath(skill.filePath, 60)}
          </span>
          <span className="flex items-center gap-1.5 font-mono" title={skill.contentHash}>
            <Icon name="copy" size={11} />
            {skill.contentHash.slice(0, 12)}
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="clock" size={11} />
            {formatRelative(skill.updatedAt)}
          </span>
        </div>

        {!!skill.tags.length && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {skill.tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-bg-base p-5">
        {isLoading && <Spinner size={16} />}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">
            <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
            <span>
              No se pudo leer el fichero en disco. Puede que se haya movido o borrado; un
              rescan lo quitaría del índice.
            </span>
          </div>
        )}

        {file && (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-txt-2">
            {file.content}
          </pre>
        )}
      </div>
    </div>
  );
}

export function SkillsView(): ReactElement {
  const { data: skills, error, isLoading } = useSkills();
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const tags = useMemo(() => {
    const all = new Set<string>();
    skills?.forEach((skill) => skill.tags.forEach((t) => all.add(t)));
    return [...all].sort();
  }, [skills]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (skills ?? []).filter((skill) => {
      if (tag && !skill.tags.includes(tag)) return false;
      if (!needle) return true;
      return (
        skill.name.toLowerCase().includes(needle) ||
        skill.description.toLowerCase().includes(needle) ||
        skill.filePath.toLowerCase().includes(needle)
      );
    });
  }, [skills, query, tag]);

  const selected = filtered.find((skill) => skill.id === selectedId) ?? filtered[0];

  const rescan = async (): Promise<void> => {
    setRescanning(true);
    try {
      const { indexed } = await rescanSkills();
      await mutate(keys.skills);
      toast(`Escaneo completado · ${indexed} skills indexadas`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo escanear", "error");
    } finally {
      setRescanning(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-1 px-7 py-4">
        <div>
          <h1 className="text-lg font-semibold text-txt-1">Skills</h1>
          <p className="text-sm text-txt-3">
            {isLoading
              ? "Cargando…"
              : `${skills?.length ?? 0} SKILL.md indexados desde el filesystem`}
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          icon="refresh"
          onClick={() => void rescan()}
          loading={rescanning}
        >
          Rescanear
        </Button>
      </div>

      {error && (
        <div className="m-7 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">
          <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
          <span>
            No se pudo contactar con la API en{" "}
            <span className="font-mono">localhost:3001</span>.
          </span>
        </div>
      )}

      {!isLoading && !error && !skills?.length && (
        <EmptyState
          icon="layers"
          title="No hay skills indexadas"
          hint="El scanner busca ficheros SKILL.md en las rutas configuradas en el .env de la API. Comprueba SKILLS_ROOTS y vuelve a escanear."
          action={
            <Button
              variant="primary"
              size="sm"
              icon="refresh"
              onClick={() => void rescan()}
              loading={rescanning}
            >
              Escanear ahora
            </Button>
          }
        />
      )}

      {!!skills?.length && (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[340px] shrink-0 flex-col border-r border-border-1">
            <div className="flex flex-col gap-2 border-b border-border-1 p-3">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre, descripción o ruta"
                prefixIcon="search"
              />
              {!!tags.length && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <Chip
                      key={t}
                      active={tag === t}
                      onClick={() => setTag(tag === t ? null : t)}
                    >
                      {t}
                    </Chip>
                  ))}
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
              {filtered.length === 0 && (
                <p className="px-1 py-6 text-center text-sm text-txt-3">
                  Ninguna skill coincide con el filtro.
                </p>
              )}
              {filtered.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  active={selected?.id === skill.id}
                  onSelect={() => setSelectedId(skill.id)}
                />
              ))}
            </div>
          </div>

          {selected ? (
            <SkillDetail key={selected.id} skill={selected} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-txt-3">
              Selecciona una skill para ver su contenido.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
