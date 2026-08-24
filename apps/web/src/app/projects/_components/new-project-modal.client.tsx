"use client";

import { useState, type ReactElement, type FormEvent } from "react";
import { X } from "lucide-react";
import { projects } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export function NewProjectModal(props: Props): ReactElement {
  const { onClose, onCreated } = props;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const name = fd.get("name") as string;
    const description = fd.get("description") as string;
    const repoPath = fd.get("repoPath") as string;

    try {
      await projects.create({ name, description: description || undefined, repoPath });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear el proyecto");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border-2 bg-bg-3 p-6 shadow-lg">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-1">Nuevo proyecto</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <Input
            id="name"
            name="name"
            label="Nombre *"
            placeholder="Mi proyecto"
            required
            autoFocus
          />
          <Input
            id="description"
            name="description"
            label="Descripción"
            placeholder="Descripción opcional"
          />
          <Input
            id="repoPath"
            name="repoPath"
            label="Ruta del repositorio *"
            placeholder="/home/user/mi-repo"
            mono
            required
          />

          {error ? (
            <p className="text-xs text-red" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isLoading}>
              Crear proyecto
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
