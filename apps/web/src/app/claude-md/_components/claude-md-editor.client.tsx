"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSWRConfig } from "swr";

import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal.client";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Spinner,
  cn,
} from "@/components/ui/primitives.client";
import { useToast } from "@/components/ui/toast.client";
import { createClaudeMd, deleteClaudeMd, updateClaudeMd } from "@/lib/api";
import { formatRelative, shortenPath } from "@/lib/format";
import { keys, useClaudeMdDocs } from "@/lib/hooks";

import type { ReactElement } from "react";
import type { ClaudeMd, ClaudeMdScope } from "@/lib/types";

// Monaco toca `window` al cargar, así que no puede prerenderizarse en el server.
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-bg-base">
      <Spinner size={16} />
    </div>
  ),
});

const SCOPE_VARIANT = {
  global: "accent",
  project: "blue",
} as const;

const SCOPES: ClaudeMdScope[] = ["global", "project"];

const SCOPE_HINT = {
  global: "Se inyecta en el workspace de todas las runs, de cualquier proyecto.",
  project: "Se inyecta solo en las runs de su proyecto. Se enlaza desde el proyecto; aquí solo se crea el documento.",
} as const;

const EDITOR_OPTIONS = {
  fontSize: 12,
  lineHeight: 20,
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  minimap: { enabled: false },
  wordWrap: "on",
  scrollBeyondLastLine: false,
  renderLineHighlight: "none",
  padding: { top: 16, bottom: 16 },
  smoothScrolling: true,
  tabSize: 2,
} as const;

function docLabel(doc: ClaudeMd): string {
  if (doc.project) return doc.project.name;
  return doc.scope === "global" ? "Global" : `Sin asignar (${doc.scope})`;
}

function DocRow({
  doc,
  active,
  dirty,
  onSelect,
}: {
  doc: ClaudeMd;
  active: boolean;
  dirty: boolean;
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
        <Icon name="file" size={12} className={active ? "text-accent" : "text-txt-3"} />
        <span
          className={cn(
            "truncate-1 flex-1 text-base font-medium",
            active ? "text-accent" : "text-txt-1",
          )}
        >
          {docLabel(doc)}
        </span>
        {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={SCOPE_VARIANT[doc.scope]} size="xs">
          {doc.scope}
        </Badge>
        <span className="text-xs text-txt-3">{formatRelative(doc.updatedAt)}</span>
      </div>
    </button>
  );
}

function NewDocModal({
  open,
  onClose,
  onCreated,
  globalTaken,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (doc: ClaudeMd) => void;
  /** Solo puede haber un global; con uno ya creado, el ámbito por defecto cambia. */
  globalTaken: boolean;
}): ReactElement {
  const toast = useToast();
  const [scope, setScope] = useState<ClaudeMdScope>(globalTaken ? "project" : "global");
  const [filePath, setFilePath] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    setSaving(true);
    try {
      const created = await createClaudeMd({
        scope,
        content: `# CLAUDE.md\n\nInstrucciones para los agentes.\n`,
        filePath: filePath.trim() || undefined,
      });
      toast("Documento creado", "success");
      setFilePath("");
      onCreated(created);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo crear", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo CLAUDE.md"
      footer={
        <>
          <Button variant="primary" size="sm" onClick={() => void submit()} loading={saving}>
            Crear
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-txt-2">Ámbito</span>
        <Select
          value={scope}
          onChange={(e) => setScope(e.target.value as ClaudeMdScope)}
          inputSize="md"
        >
          {SCOPES.map((s) => (
            <option key={s} value={s} disabled={s === "global" && globalTaken}>
              {s}
              {s === "global" && globalTaken ? " (ya existe)" : ""}
            </option>
          ))}
        </Select>
        <span className="text-xs text-txt-3">{SCOPE_HINT[scope]}</span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-txt-2">Ruta en disco (opcional)</span>
        <Input
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="C:\\Users\\tu-usuario\\.claude\\CLAUDE.md"
          inputSize="md"
          mono
        />
        <span className="text-xs text-txt-3">
          Si la indicas, cada guardado escribe también ese fichero.
        </span>
      </label>
    </Modal>
  );
}

export function ClaudeMdEditor(): ReactElement {
  const { data: docs, error, isLoading } = useClaudeMdDocs();
  const { mutate } = useSWRConfig();
  const toast = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClaudeMd | null>(null);

  const globalTaken = !!docs?.some((doc) => doc.scope === "global");

  const selected = useMemo(
    () => docs?.find((doc) => doc.id === selectedId) ?? docs?.[0] ?? null,
    [docs, selectedId],
  );

  // Al cambiar de documento el borrador se resiembra con lo que hay en BD.
  useEffect(() => {
    setDraft(selected?.content ?? "");
  }, [selected?.id, selected?.content]);

  const dirty = !!selected && draft !== selected.content;

  const save = async (): Promise<void> => {
    if (!selected || !dirty) return;
    setSaving(true);
    try {
      await updateClaudeMd(selected.id, { content: draft });
      await mutate(keys.claudeMd);
      toast(
        selected.filePath ? "Guardado en BD y en disco" : "Guardado",
        "success",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    try {
      await deleteClaudeMd(pendingDelete.id);
      await mutate(keys.claudeMd);
      if (selectedId === pendingDelete.id) setSelectedId(null);
      toast("Documento borrado", "success");
      setPendingDelete(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo borrar", "error");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-1 px-7 py-4">
        <div>
          <h1 className="text-lg font-semibold text-txt-1">CLAUDE.md</h1>
          <p className="text-sm text-txt-3">
            {isLoading
              ? "Cargando…"
              : `${docs?.length ?? 0} ${docs?.length === 1 ? "documento" : "documentos"} · el global va en todas las runs; el de un proyecto, solo en las suyas`}
          </p>
        </div>
        <Button variant="primary" size="sm" icon="plus" onClick={() => setShowNew(true)}>
          Nuevo documento
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

      {!isLoading && !error && !docs?.length && (
        <EmptyState
          icon="file"
          title="Todavía no hay ningún CLAUDE.md"
          hint="Crea uno global para las instrucciones comunes, o uno por proyecto para que se inyecte en el workspace de cada run."
          action={
            <Button variant="primary" size="sm" icon="plus" onClick={() => setShowNew(true)}>
              Crear el primero
            </Button>
          }
        />
      )}

      {!!docs?.length && (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[280px] shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-border-1 p-3">
            {docs.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                active={selected?.id === doc.id}
                dirty={dirty && selected?.id === doc.id}
                onSelect={() => setSelectedId(doc.id)}
              />
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {selected && (
              <>
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-1 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant={SCOPE_VARIANT[selected.scope]} size="sm">
                      {selected.scope}
                    </Badge>
                    <span className="truncate-1 text-sm text-txt-2">
                      {docLabel(selected)}
                    </span>
                    {selected.filePath && (
                      <span
                        className="truncate-1 font-mono text-xs text-txt-3"
                        title={selected.filePath}
                      >
                        · {shortenPath(selected.filePath, 40)}
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {dirty && <span className="text-xs text-warn">Sin guardar</span>}
                    <Button
                      variant="primary"
                      size="xs"
                      icon="check"
                      onClick={() => void save()}
                      loading={saving}
                      disabled={!dirty}
                    >
                      Guardar
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      icon="trash"
                      onClick={() => setPendingDelete(selected)}
                    >
                      Borrar
                    </Button>
                  </div>
                </div>

                <div className="min-h-0 flex-1">
                  <MonacoEditor
                    key={selected.id}
                    height="100%"
                    defaultLanguage="markdown"
                    theme="vs-dark"
                    value={draft}
                    onChange={(value) => setDraft(value ?? "")}
                    options={EDITOR_OPTIONS}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <NewDocModal
        open={showNew}
        globalTaken={globalTaken}
        onClose={() => setShowNew(false)}
        onCreated={(doc) => {
          void mutate(keys.claudeMd);
          setSelectedId(doc.id);
        }}
      />

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Borrar documento"
        footer={
          <>
            <Button variant="danger" size="sm" onClick={() => void confirmDelete()}>
              Borrar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
              Cancelar
            </Button>
          </>
        }
      >
        <p className="text-sm text-txt-2">
          Se borra el documento de la base de datos. El fichero en disco, si lo tiene, se
          queda donde está.
        </p>
      </Modal>
    </div>
  );
}
