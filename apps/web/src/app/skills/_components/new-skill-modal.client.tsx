"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/modal.client";
import { Button, Input, Textarea } from "@/components/ui/primitives.client";
import { useToast } from "@/components/ui/toast.client";
import { createSkill } from "@/lib/api";
import { slugifySkillName, slugifySkillNameDraft } from "@/lib/format";

import type { ReactElement } from "react";
import type { Skill } from "@/lib/types";

/**
 * El alta solo pide nombre y descripción: el cuerpo del SKILL.md se escribe
 * después en el mismo Monaco del catálogo, que ya existía. Aquí no se elige
 * ruta a propósito — la API la decide, y así crear desde la web no puede
 * escribir en cualquier sitio del disco.
 */
export function NewSkillModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (skill: Skill) => void;
}): ReactElement {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  // El guion que el borrador deja al final se limpia aquí, no en cada tecla.
  const finalName = slugifySkillName(name);

  const submit = async (): Promise<void> => {
    if (!finalName || !description.trim()) return;
    setSaving(true);
    try {
      const skill = await createSkill(finalName, description.trim());
      toast(`Skill "${skill.name}" creada`, "success");
      onCreated(skill);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo crear la skill", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva skill"
      footer={
        <>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void submit()}
            loading={saving}
            disabled={!finalName || !description.trim()}
          >
            Crear skill
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-txt-2">Nombre</span>
        <Input
          value={name}
          onChange={(e) => setName(slugifySkillNameDraft(e.target.value))}
          placeholder="revisar-migraciones"
          inputSize="md"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <span className="text-xs text-txt-3">
          Es también el nombre de la carpeta y el que ve el agente. Minúsculas,
          números y guiones.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-txt-2">Descripción</span>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Para qué sirve. Es lo que lee el agente para decidir si aplicarla."
          rows={3}
        />
      </label>
    </Modal>
  );
}
