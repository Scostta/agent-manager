"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";

import { Icon } from "@/components/ui/icon";
import {
  AgentAvatar,
  Button,
  Chip,
  Divider,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui/primitives.client";
import { useToast } from "@/components/ui/toast.client";
import { createAgent, updateAgent } from "@/lib/api";
import { keys, useAgent, useSkills } from "@/lib/hooks";
import { MODELS } from "@/lib/types";

import type { ReactElement } from "react";

const EMPTY_FORM = {
  name: "",
  role: "",
  model: MODELS[0] as string,
  systemPrompt: "",
  maxBudgetUsd: "",
} as const;

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactElement;
}): ReactElement {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-txt-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-txt-3">{hint}</span>}
    </label>
  );
}

export function AgentEditor({ agentId }: { agentId: string | null }): ReactElement {
  const router = useRouter();
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const { data: agent, isLoading, error } = useAgent(agentId);
  const { data: skills } = useSkills();

  const [form, setForm] = useState<{
    name: string;
    role: string;
    model: string;
    systemPrompt: string;
    maxBudgetUsd: string;
  }>({ ...EMPTY_FORM });
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // El formulario es estado local para poder editar sin escribir en cada tecla;
  // se siembra en cuanto SWR resuelve el agente.
  useEffect(() => {
    if (!agent) return;
    setForm({
      name: agent.name,
      role: agent.role,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      maxBudgetUsd: agent.maxBudgetUsd == null ? "" : String(agent.maxBudgetUsd),
    });
    setSkillIds((agent.skills ?? []).map(({ skillId }) => skillId));
  }, [agent]);

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleSkill = (id: string) =>
    setSkillIds((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );

  const budget = Number(form.maxBudgetUsd);
  const budgetInvalid = form.maxBudgetUsd !== "" && (Number.isNaN(budget) || budget <= 0);
  const complete =
    !!form.name.trim() && !!form.role.trim() && !!form.systemPrompt.trim() && !budgetInvalid;

  const save = async (): Promise<void> => {
    if (!complete) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      role: form.role.trim(),
      model: form.model,
      systemPrompt: form.systemPrompt.trim(),
      maxBudgetUsd: form.maxBudgetUsd === "" ? undefined : budget,
      skillIds,
    };

    try {
      if (agentId) {
        await updateAgent(agentId, payload);
        await mutate(keys.agent(agentId));
        toast("Agente actualizado", "success");
      } else {
        await createAgent(payload);
        toast("Agente creado", "success");
      }
      await mutate(keys.agents);
      router.push("/agents");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar el agente", "error");
    } finally {
      setSaving(false);
    }
  };

  if (agentId && isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} />
      </div>
    );
  }

  if (agentId && error) {
    return (
      <div className="p-7">
        <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">
          <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
          <span>No se pudo cargar el agente: {String(error.message ?? error)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div className="flex items-center gap-3">
          <AgentAvatar name={form.name || "??"} size={36} />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-txt-1">
              {agentId ? form.name || "Agente" : "Nuevo agente"}
            </h1>
            <p className="text-sm text-txt-3">
              Plantilla de ejecución: modelo, prompt de sistema y skills permitidas.
            </p>
          </div>
        </div>

        <Divider />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="backend-dev"
              inputSize="md"
              autoFocus={!agentId}
            />
          </Field>

          <Field label="Rol">
            <Input
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
              placeholder="Implementa endpoints y migraciones"
              inputSize="md"
            />
          </Field>

          <Field label="Modelo">
            <Select
              value={form.model}
              onChange={(e) => set("model", e.target.value)}
              inputSize="md"
            >
              {MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Tope de gasto (USD)"
            hint="Opcional. Vacío = sin tope."
          >
            <Input
              value={form.maxBudgetUsd}
              onChange={(e) => set("maxBudgetUsd", e.target.value)}
              placeholder="5"
              inputSize="md"
              inputMode="decimal"
              className={budgetInvalid ? "border-danger" : undefined}
            />
          </Field>
        </div>

        <Field
          label="Prompt de sistema"
          hint="Se antepone a la descripción de cada task que ejecute este agente."
        >
          <Textarea
            value={form.systemPrompt}
            onChange={(e) => set("systemPrompt", e.target.value)}
            placeholder="Eres un agente que…"
            rows={10}
            mono
          />
        </Field>

        <Divider label="Skills habilitadas" />

        <div className="flex flex-wrap gap-1.5">
          {!skills?.length && (
            <span className="text-sm text-txt-3">
              No hay skills indexadas. Escanea el filesystem desde la pestaña Skills.
            </span>
          )}
          {skills?.map((skill) => (
            <Chip
              key={skill.id}
              active={skillIds.includes(skill.id)}
              onClick={() => toggleSkill(skill.id)}
            >
              {skillIds.includes(skill.id) && <Icon name="check" size={9} />}
              {skill.name}
            </Chip>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button
            variant="primary"
            size="md"
            icon="check"
            onClick={() => void save()}
            loading={saving}
            disabled={!complete}
          >
            {agentId ? "Guardar cambios" : "Crear agente"}
          </Button>
          <Button variant="ghost" size="md" onClick={() => router.push("/agents")}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
