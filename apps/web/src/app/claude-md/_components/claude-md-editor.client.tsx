"use client";

import {
  useState,
  useEffect,
  type ReactElement,
  type FormEvent,
} from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import {
  Plus,
  Save,
  HardDriveDownload,
  Eye,
  Code2,
  Trash2,
  X,
  FileText,
} from "lucide-react";
import { claudeMd } from "~/lib/api";
import type { ClaudeMd, ClaudeMdScope } from "@agent-manager/types";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/cn";

// Monaco se carga solo en el cliente porque usa APIs del DOM
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-text-3" size={20} />
      </div>
    ),
  },
);

const SCOPE_LABELS: Record<ClaudeMdScope, string> = {
  global: "Global",
  project: "Proyecto",
  agent: "Agente",
};

const SCOPE_BADGE: Record<ClaudeMdScope, "default" | "accent" | "blue"> = {
  global: "default",
  project: "accent",
  agent: "blue",
};

type NewFileModalProps = {
  onClose: () => void;
  onCreated: (id: string) => void;
};

function NewFileModal(props: NewFileModalProps): ReactElement {
  const { onClose, onCreated } = props;
  const [scope, setScope] = useState<ClaudeMdScope>("project");
  const [filePath, setFilePath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const created = await claudeMd.create({
        scope,
        content: `# CLAUDE.md\n\nInstrucciones para Claude Code.\n`,
        filePath: filePath || undefined,
      });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border-2 bg-bg-3 p-6 shadow-lg">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-1">Nuevo CLAUDE.md</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-2">Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ClaudeMdScope)}
              className={cn(
                "w-full rounded border border-border-2 bg-bg-4 px-3 py-2 text-sm text-text-1",
                "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
              )}
            >
              <option value="global">Global</option>
              <option value="project">Proyecto</option>
              <option value="agent">Agente</option>
            </select>
          </div>

          <Input
            id="filePath"
            label="Ruta en disco (opcional)"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="/ruta/a/CLAUDE.md"
            mono
          />

          {error ? (
            <p className="text-xs text-red" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isLoading}>
              Crear
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }): ReactElement {
  // Simple markdown → HTML rendering (headings, bold, code, lists)
  const lines = content.split("\n");
  const elements: ReactElement[] = [];
  let key = 0;

  for (const line of lines) {
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={key++} className="mt-4 text-sm font-semibold text-text-1">
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={key++} className="mt-5 text-base font-semibold text-text-1">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h1 key={key++} className="mt-6 text-lg font-bold text-text-1">
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li key={key++} className="ml-4 text-sm text-text-2 list-disc">
          {line.slice(2)}
        </li>,
      );
    } else if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
    } else {
      elements.push(
        <p key={key++} className="text-sm text-text-2 leading-relaxed">
          {line}
        </p>,
      );
    }
  }

  return <div className="flex flex-col gap-0.5 p-4">{elements}</div>;
}

export function ClaudeMdEditor(): ReactElement {
  const { data, isLoading, error, mutate } = useSWR(
    "/claude-md",
    () => claudeMd.list(),
    { refreshInterval: 0 },
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedFile = (data ?? []).find((f) => f.id === selectedId) ?? null;

  // Select first file by default
  useEffect(() => {
    if (data && data.length > 0 && !selectedId) {
      setSelectedId(data[0].id);
    }
  }, [data, selectedId]);

  // Sync content when selection changes
  useEffect(() => {
    if (selectedFile) {
      setContent(selectedFile.content);
      setIsDirty(false);
    }
  }, [selectedFile?.id]);

  async function handleSave() {
    if (!selectedId) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await claudeMd.update(selectedId, { content });
      setIsDirty(false);
      await mutate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSyncToDisk() {
    if (!selectedId || !selectedFile?.filePath) return;
    setIsSyncing(true);
    try {
      await claudeMd.update(selectedId, { content, filePath: selectedFile.filePath });
      await mutate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error al sincronizar");
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleDelete() {
    if (!selectedId) return;
    setIsDeleting(true);
    try {
      await claudeMd.delete(selectedId);
      setSelectedId(null);
      await mutate();
      setShowDeleteConfirm(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setIsDeleting(false);
    }
  }

  const groupedFiles = {
    global: (data ?? []).filter((f) => f.scope === "global"),
    project: (data ?? []).filter((f) => f.scope === "project"),
    agent: (data ?? []).filter((f) => f.scope === "agent"),
  };

  return (
    <>
      <div className="flex h-full">
        {/* Sidebar */}
        <div className="flex w-[200px] shrink-0 flex-col border-r border-border-1 bg-bg-2">
          <div className="flex items-center justify-between border-b border-border-1 px-3 py-2">
            <span className="text-xs font-medium text-text-2">Archivos</span>
            <button
              onClick={() => setShowNewModal(true)}
              className="rounded p-1 text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1"
              title="Nuevo archivo"
            >
              <Plus size={13} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="text-text-3" size={14} />
              </div>
            ) : (data ?? []).length === 0 ? (
              <p className="py-4 text-center text-xs text-text-3">
                Sin archivos
              </p>
            ) : (
              (["global", "project", "agent"] as ClaudeMdScope[]).map(
                (scope) =>
                  groupedFiles[scope].length > 0 ? (
                    <div key={scope} className="mb-3">
                      <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-text-3">
                        {SCOPE_LABELS[scope]}
                      </p>
                      {groupedFiles[scope].map((file) => (
                        <button
                          key={file.id}
                          onClick={() => {
                            if (isDirty && selectedId !== file.id) {
                              // Keep it simple: allow switching without saving
                              setIsDirty(false);
                            }
                            setSelectedId(file.id);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors text-left",
                            selectedId === file.id
                              ? "bg-bg-active text-text-1"
                              : "text-text-2 hover:bg-bg-hover",
                          )}
                        >
                          <FileText size={11} className="shrink-0" />
                          <span className="truncate">
                            {file.filePath
                              ? file.filePath.split("/").pop() ?? "CLAUDE.md"
                              : `${SCOPE_LABELS[scope]}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null,
              )
            )}
          </div>
        </div>

        {/* Editor area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedFile ? (
            <>
              {/* Editor toolbar */}
              <div className="flex shrink-0 items-center justify-between border-b border-border-1 bg-bg-2 px-4 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant={SCOPE_BADGE[selectedFile.scope as ClaudeMdScope]}>
                    {SCOPE_LABELS[selectedFile.scope as ClaudeMdScope]}
                  </Badge>
                  {selectedFile.filePath ? (
                    <span className="font-mono text-xs text-text-3">
                      {selectedFile.filePath}
                    </span>
                  ) : null}
                  {isDirty ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Sin guardar" />
                  ) : null}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPreviewMode((v) => !v)}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                      previewMode
                        ? "bg-bg-active text-text-1"
                        : "text-text-3 hover:bg-bg-hover hover:text-text-2",
                    )}
                  >
                    {previewMode ? (
                      <Code2 size={12} />
                    ) : (
                      <Eye size={12} />
                    )}
                    {previewMode ? "Editor" : "Vista previa"}
                  </button>

                  {selectedFile.filePath ? (
                    <Button
                      variant="subtle"
                      size="xs"
                      isLoading={isSyncing}
                      onClick={() => void handleSyncToDisk()}
                    >
                      <HardDriveDownload size={11} />
                      Sincronizar
                    </Button>
                  ) : null}

                  <Button
                    variant="primary"
                    size="xs"
                    isLoading={isSaving}
                    onClick={() => void handleSave()}
                    disabled={!isDirty}
                  >
                    <Save size={11} />
                    Guardar
                  </Button>

                  {showDeleteConfirm ? (
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="danger"
                        size="xs"
                        isLoading={isDeleting}
                        onClick={() => void handleDelete()}
                      >
                        Eliminar
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setShowDeleteConfirm(false)}
                      >
                        No
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-red/60 hover:text-red"
                    >
                      <Trash2 size={11} />
                    </Button>
                  )}
                </div>
              </div>

              {saveError ? (
                <div className="border-b border-red/20 bg-red-dim px-4 py-2">
                  <p className="text-xs text-red" role="alert">
                    {saveError}
                  </p>
                </div>
              ) : null}

              {/* Editor / Preview */}
              <div className="flex-1 overflow-hidden">
                {previewMode ? (
                  <div className="h-full overflow-y-auto">
                    <MarkdownPreview content={content} />
                  </div>
                ) : (
                  <MonacoEditor
                    height="100%"
                    language="markdown"
                    theme="vs-dark"
                    value={content}
                    onChange={(val) => {
                      setContent(val ?? "");
                      setIsDirty(true);
                    }}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineHeight: 20,
                      fontFamily: "'JetBrains Mono', monospace",
                      wordWrap: "on",
                      scrollBeyondLastLine: false,
                      padding: { top: 16, bottom: 16 },
                      renderLineHighlight: "none",
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              {isLoading ? (
                <Spinner className="text-text-3" size={20} />
              ) : error ? (
                <p className="text-sm text-red">No se pudo conectar con la API</p>
              ) : (
                <>
                  <FileText size={40} className="text-text-3" />
                  <div>
                    <p className="text-sm font-medium text-text-1">
                      Sin archivo seleccionado
                    </p>
                    <p className="mt-1 text-xs text-text-3">
                      Selecciona un archivo de la lista o crea uno nuevo
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowNewModal(true)}
                  >
                    <Plus size={13} />
                    Nuevo archivo
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showNewModal ? (
        <NewFileModal
          onClose={() => setShowNewModal(false)}
          onCreated={(id) => {
            setShowNewModal(false);
            void mutate().then(() => setSelectedId(id));
          }}
        />
      ) : null}
    </>
  );
}
