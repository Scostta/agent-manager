"use client";

import {
  useState,
  useEffect,
  type ReactElement,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Search, Trash2 } from "lucide-react";
import { agents, skills as skillsApi, type SkillWithParsedTags } from "~/lib/api";
import type { AgentWithSkills } from "@agent-manager/types";
import { AgentAvatar } from "~/components/ui/agent-avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/cn";

const MODELS = [
  "claude-opus-4-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-opus-4-7",
];

type Tab = "config" | "prompt" | "skills";

type Props = {
  agentId: string;
};

function SkillPicker({
  allSkills,
  selectedIds,
  onChange,
}: {
  allSkills: SkillWithParsedTags[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}): ReactElement {
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

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

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((i) => i !== id)
        : [...selectedIds, id],
    );
  }

  return (
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
              "rounded px-2 py-0.5 text-xs transition-colors",
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
              onClick={() => setTagFilter(tag === tagFilter ? null : tag)}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
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

      <div className="flex flex-col gap-1 rounded border border-border-1 bg-bg-3 p-2 max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-3">
            Sin skills que coincidan
          </p>
        ) : (
          filtered.map((skill) => (
            <label
              key={skill.id}
              className="flex cursor-pointer items-start gap-2.5 rounded px-2 py-2 transition-colors hover:bg-bg-hover"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(skill.id)}
                onChange={() => toggle(skill.id)}
                className="mt-0.5 accent-accent"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-text-1">{skill.name}</p>
                <p className="line-clamp-1 text-xs text-text-3">
                  {skill.description}
                </p>
                {skill.tags.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {skill.tags.map((t) => (
                      <Badge key={t} variant="default">
                        {t}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export function AgentEditor(props: Props): ReactElement {
  const { agentId } = props;
  const router = useRouter();
  const isNew = agentId === "new";

  const { data: agent, isLoading } = useSWR(
    isNew ? null : `/agents/${agentId}`,
    () => agents.get(agentId),
  );

  const { data: allSkills = [] } = useSWR("/skills", () => skillsApi.list());

  const [activeTab, setActiveTab] = useState<Tab>("config");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [maxBudget, setMaxBudget] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setRole(agent.role);
      setModel(agent.model);
      setMaxBudget(agent.maxBudgetUsd ? String(agent.maxBudgetUsd) : "");
      setSystemPrompt(agent.systemPrompt);
      setSelectedSkillIds(agent.skills.map((s) => s.skillId));
    }
  }, [agent]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    const payload = {
      name,
      role,
      model,
      systemPrompt,
      maxBudgetUsd: maxBudget ? parseFloat(maxBudget) : undefined,
      skillIds: selectedSkillIds,
    };

    try {
      if (isNew) {
        await agents.create(payload);
        router.push("/agents");
      } else {
        await agents.update(agentId, payload);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await agents.delete(agentId);
      router.push("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-text-3" size={20} />
      </div>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "config", label: "Configuración" },
    { id: "prompt", label: "System Prompt" },
    { id: "skills", label: `Skills (${selectedSkillIds.length})` },
  ];

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        {!isNew && name ? (
          <AgentAvatar agentId={agentId} name={name} size="lg" />
        ) : null}
        <div>
          <h1 className="text-base font-semibold text-text-1">
            {isNew ? "Nuevo agente" : name || "Agente"}
          </h1>
          {!isNew && role ? (
            <p className="text-xs text-text-3">{role}</p>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex border-b border-border-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 pb-2 pt-1 text-sm transition-colors",
              activeTab === tab.id
                ? "border-b-2 border-accent font-medium text-text-1"
                : "text-text-3 hover:text-text-2",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => void handleSave(e)}>
        {/* Config tab */}
        {activeTab === "config" ? (
          <div className="flex flex-col gap-4">
            <Input
              id="name"
              label="Nombre *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mi agente"
              required
            />
            <Input
              id="role"
              label="Rol *"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="developer, reviewer, researcher..."
              required
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-2">Modelo</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={cn(
                  "w-full rounded border border-border-2 bg-bg-3 px-3 py-2 text-sm text-text-1",
                  "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
                )}
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <Input
              id="budget"
              label="Budget máximo (USD)"
              type="number"
              min="0"
              step="0.01"
              value={maxBudget}
              onChange={(e) => setMaxBudget(e.target.value)}
              placeholder="10.00"
            />
          </div>
        ) : null}

        {/* Prompt tab */}
        {activeTab === "prompt" ? (
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-text-2">
              System Prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Eres un agente que..."
              rows={20}
              className={cn(
                "w-full resize-y rounded border border-border-2 bg-bg-3 px-3 py-2 font-mono text-xs text-text-1",
                "placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
              )}
            />
          </div>
        ) : null}

        {/* Skills tab */}
        {activeTab === "skills" ? (
          <SkillPicker
            allSkills={allSkills}
            selectedIds={selectedSkillIds}
            onChange={setSelectedSkillIds}
          />
        ) : null}

        {/* Errors + actions */}
        {error ? (
          <p className="mt-4 text-xs text-red" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-4 text-xs text-green">Guardado correctamente</p>
        ) : null}

        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              type="submit"
              isLoading={isSaving}
            >
              {isNew ? "Crear agente" : "Guardar cambios"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => router.push("/agents")}
            >
              Cancelar
            </Button>
          </div>

          {!isNew ? (
            showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-2">¿Seguro?</span>
                <Button
                  variant="danger"
                  size="xs"
                  type="button"
                  isLoading={isDeleting}
                  onClick={() => void handleDelete()}
                >
                  Eliminar
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  No
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red/70 hover:text-red"
              >
                <Trash2 size={13} />
                Eliminar
              </Button>
            )
          ) : null}
        </div>
      </form>
    </div>
  );
}
