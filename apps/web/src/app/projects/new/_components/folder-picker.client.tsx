"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/ui/icon";
import { Badge, Button, Input, Spinner, cn } from "@/components/ui/primitives.client";
import { browseDirectory, listFsRoots } from "@/lib/api";

import type { ReactElement } from "react";
import type { DirListing } from "@/lib/types";

/**
 * Picker de carpetas servido por la API. El navegador no puede dar una ruta
 * absoluta del disco, y `repoPath` tiene que serlo: es el cwd de cada run.
 */
export function FolderPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (path: string) => void;
}): ReactElement {
  // Carpeta que se está mirando. Distinta del valor elegido: dentro de ella se
  // puede seleccionar una subcarpeta existente o nombrar una nueva.
  const [cwd, setCwd] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");

  const { data: roots } = useSWR("/fs/roots", listFsRoots);
  const { data: listing, error, isLoading } = useSWR(
    ["/fs/browse", cwd],
    () => browseDirectory(cwd ?? undefined),
    { keepPreviousData: true },
  );

  // Las raíces del explorador (la home y cada unidad) son justo las carpetas en
  // las que un proyecto no puede vivir: `git init` ahí versionaría el disco
  // entero y cada run copiaría lo mismo. Sin destino válido no se continúa.
  const target = listing
    ? newFolder.trim()
      ? joinPath(listing.path, newFolder.trim(), listing.separator)
      : listing.path
    : "";
  const unsafe = Boolean(target) && (roots ?? []).some((root) => samePath(root.path, target));

  // El destino se recalcula solo: navegar o teclear cambia lo que se creará.
  useEffect(() => {
    if (!listing) return;
    onChange(unsafe ? "" : target);
    // onChange viene inline del wizard; incluirlo aquí re-dispararía el efecto
    // en cada render del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing, target, unsafe]);

  const navigate = (path: string): void => {
    setNewFolder("");
    setCwd(path);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {roots?.map((root) => (
          <Button
            key={root.path}
            size="xs"
            variant={listing?.path === root.path ? "primary" : "subtle"}
            icon="folder"
            onClick={() => navigate(root.path)}
          >
            {root.name}
          </Button>
        ))}
        {listing?.parent && (
          <Button size="xs" variant="ghost" onClick={() => navigate(listing.parent!)}>
            <span className="rotate-[-90deg]">
              <Icon name="chevronDown" size={11} />
            </span>
            Subir
          </Button>
        )}
      </div>

      {listing && <Breadcrumb listing={listing} onNavigate={navigate} />}

      <div className="h-64 overflow-y-auto rounded-md border border-border-1 bg-bg-3">
        {isLoading && !listing && (
          <div className="flex h-full items-center justify-center">
            <Spinner size={16} />
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-danger">
            {error instanceof Error ? error.message : "No se pudo leer la carpeta"}
          </div>
        )}

        {listing && !listing.entries.length && !error && (
          <div className="flex h-full items-center justify-center text-sm text-txt-3">
            {listing.isEmpty ? "Carpeta vacía" : "No hay subcarpetas aquí"}
          </div>
        )}

        {listing?.entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => navigate(entry.path)}
            className="flex w-full items-center gap-2 border-b border-border-1 px-3 py-1.5 text-left text-sm text-txt-1 last:border-b-0 hover:bg-bg-4"
          >
            <Icon name="folder" size={13} className="shrink-0 text-txt-3" />
            <span className="truncate-1 flex-1">{entry.name}</span>
            {entry.isGitRepo && (
              <Badge variant="accent" size="xs">
                <Icon name="gitBranch" size={9} />
                git
              </Badge>
            )}
            <Icon name="chevronRight" size={12} className="shrink-0 text-txt-3" />
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-txt-2">Carpeta nueva</span>
        <Input
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          placeholder="opcional — si lo dejas vacío se usa la carpeta actual"
          inputSize="sm"
          mono
        />
      </label>

      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2",
          unsafe ? "border-danger/25 bg-danger-dim" : "border-border-1 bg-bg-4",
        )}
      >
        <Icon name="folder" size={13} className="mt-0.5 shrink-0 text-txt-3" />
        <div className="min-w-0 flex-1">
          <div className="break-all font-mono text-xs text-txt-1">{target || "—"}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {unsafe ? (
              <span className="text-xs text-danger">
                Aquí no: un proyecto en la raíz o en tu carpeta personal versionaría y
                copiaría todo lo que hay debajo. Entra en una subcarpeta o dale nombre a
                una nueva.
              </span>
            ) : newFolder.trim() ? (
              <Badge variant="green" size="xs">Se creará</Badge>
            ) : listing?.isGitRepo ? (
              <Badge variant="accent" size="xs">
                <Icon name="gitBranch" size={9} />
                Ya es un repo Git
              </Badge>
            ) : listing?.isEmpty ? (
              <Badge variant="default" size="xs">Carpeta vacía</Badge>
            ) : (
              <Badge variant="yellow" size="xs">Carpeta existente con contenido</Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Breadcrumb({
  listing,
  onNavigate,
}: {
  listing: DirListing;
  onNavigate: (path: string) => void;
}): ReactElement {
  const segments = splitPath(listing.path, listing.separator);

  return (
    <div className="flex flex-wrap items-center gap-0.5 font-mono text-xs text-txt-3">
      {segments.map((segment, index) => (
        <span key={segment.path} className="flex items-center gap-0.5">
          {index > 0 && <Icon name="chevronRight" size={10} />}
          <button
            type="button"
            onClick={() => onNavigate(segment.path)}
            className={
              index === segments.length - 1
                ? "text-txt-1"
                : "transition-colors hover:text-txt-1"
            }
          >
            {segment.label}
          </button>
        </span>
      ))}
    </div>
  );
}

function joinPath(base: string, name: string, separator: string): string {
  return base.endsWith(separator) ? `${base}${name}` : `${base}${separator}${name}`;
}

/** Desmonta la ruta en migas acumulativas: cada una navega a su nivel. */
function splitPath(full: string, separator: string): { label: string; path: string }[] {
  const parts = full.split(separator).filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  // En POSIX el primer separador es la raíz y desaparece al partir la cadena.
  let current = full.startsWith(separator) ? separator : "";

  for (const part of parts) {
    current = current && !current.endsWith(separator) ? `${current}${separator}${part}` : `${current}${part}`;
    // "C:" a secas no es una ruta absoluta para Windows: significa "el
    // directorio actual de la unidad C". La raíz es "C:\".
    crumbs.push({ label: part, path: /^[A-Za-z]:$/.test(current) ? current + separator : current });
  }

  return crumbs;
}

/** Windows no distingue mayúsculas en rutas; comparar en crudo daría falsos negativos. */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
