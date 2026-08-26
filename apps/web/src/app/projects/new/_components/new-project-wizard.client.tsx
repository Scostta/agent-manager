"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";

import { Icon } from "@/components/ui/icon";
import {
  Badge,
  Button,
  Input,
  Spinner,
  Textarea,
  cn,
} from "@/components/ui/primitives.client";
import { useToast } from "@/components/ui/toast.client";
import {
  cancelProjectPlan,
  createProject,
  createTasksBulk,
  planProject,
  readClaudeMdFile,
} from "@/lib/api";
import { keys, usePlanStream } from "@/lib/hooks";

import { FolderPicker } from "./folder-picker.client";

import type { ReactElement, ReactNode } from "react";
import type { PlannedTask, Project } from "@/lib/types";

// Monaco toca `window` al cargar, así que no puede prerenderizarse en el server.
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-bg-base">
      <Spinner size={16} />
    </div>
  ),
});

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

const STEPS = [
  { label: "Descripción", hint: "Qué vas a construir" },
  { label: "Ubicación", hint: "Dónde vive la carpeta" },
  { label: "CLAUDE.md", hint: "Instrucciones del proyecto" },
  { label: "Tareas", hint: "Backlog inicial" },
] as const;

function claudeMdTemplate(name: string, description: string): string {
  return [
    "# CLAUDE.md",
    "",
    "Instrucciones para Claude Code cuando trabajes en este repositorio.",
    "",
    "## Qué es esto",
    "",
    description.trim() || `${name}: describe aquí para qué sirve el proyecto.`,
    "",
    "## Stack y decisiones",
    "",
    "- ",
    "",
    "## Convenciones de código",
    "",
    "- ",
    "",
    "## Cosas que no quiero",
    "",
    "- ",
    "",
  ].join("\n");
}

export function NewProjectWizard(): ReactElement {
  const router = useRouter();
  const toast = useToast();
  const { mutate } = useSWRConfig();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [initGit, setInitGit] = useState(true);

  const [withClaudeMd, setWithClaudeMd] = useState(true);
  const [claudeMd, setClaudeMd] = useState("");
  const [claudeMdIsExisting, setClaudeMdIsExisting] = useState(false);
  const claudeMdTouched = useRef(false);

  // Existe a partir del paso 4: el planificador necesita un proyecto real (lee
  // su carpeta y su CLAUDE.md) y las tasks se cuelgan de él.
  const [project, setProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<PlannedTask[]>([]);

  const activity = usePlanStream(project?.id ?? null, planning);

  // Precargamos el CLAUDE.md que ya viva en la carpeta elegida: guardarlo sin
  // mirar lo sobrescribiría con la plantilla.
  useEffect(() => {
    if (step !== 2 || !repoPath || claudeMdTouched.current) return;
    let cancelled = false;

    void readClaudeMdFile(repoPath)
      .then((file) => {
        if (cancelled) return;
        setClaudeMdIsExisting(file.exists);
        setClaudeMd(file.content ?? claudeMdTemplate(name, description));
      })
      .catch(() => {
        if (!cancelled) setClaudeMd(claudeMdTemplate(name, description));
      });

    return () => {
      cancelled = true;
    };
  }, [step, repoPath, name, description]);

  const canContinue =
    (step === 0 && name.trim().length > 0) || (step === 1 && repoPath.length > 0);

  /** Crea el proyecto (carpeta + git + CLAUDE.md) y arranca la planificación. */
  const startPlanning = async (): Promise<void> => {
    setBusy(true);
    try {
      const created =
        project ??
        (await createProject({
          name: name.trim(),
          description: description.trim() || undefined,
          repoPath,
          initGit,
          claudeMdContent: withClaudeMd ? claudeMd : null,
        }));

      setProject(created);
      await mutate(keys.projects);
      setStep(3);
      void runPlan(created);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo crear el proyecto", "error");
    } finally {
      setBusy(false);
    }
  };

  const runPlan = async (target: Project): Promise<void> => {
    setPlanning(true);
    setPlanError(null);
    try {
      const plan = await planProject(target.id);
      setTasks(plan.tasks);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "La planificación falló");
    } finally {
      setPlanning(false);
    }
  };

  const stopPlan = async (): Promise<void> => {
    if (!project) return;
    await cancelProjectPlan(project.id).catch(() => {});
  };

  const finish = async (): Promise<void> => {
    if (!project) return;
    setBusy(true);
    try {
      const pending = tasks.filter((task) => task.title.trim());
      if (pending.length) await createTasksBulk(project.id, pending);
      await mutate(keys.projects);
      toast(
        pending.length
          ? `Proyecto creado con ${pending.length} tarea${pending.length === 1 ? "" : "s"}`
          : "Proyecto creado",
        "success",
      );
      router.push(`/projects/${project.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudieron crear las tareas", "error");
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div>
          <h1 className="text-lg font-semibold text-txt-1">Nuevo proyecto</h1>
          <p className="text-sm text-txt-3">
            Describe qué quieres construir, elige dónde vive y deja que Claude proponga
            las primeras tareas.
          </p>
        </div>

        <StepTabs current={step} reached={project ? 3 : step} onSelect={setStep} />

        {step === 0 && (
          <Section
            title="¿Qué vas a construir?"
            hint="Esta descripción es lo que leerá Claude para proponer el backlog inicial. Cuanto más concreta, mejores tareas."
          >
            <Field label="Nombre">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="mi-proyecto"
                inputSize="md"
                autoFocus
              />
            </Field>
            <Field label="Descripción">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Un dashboard para… El stack será… Lo primero que hace falta es…"
                rows={8}
              />
            </Field>
          </Section>
        )}

        {step === 1 && (
          <Section
            title="¿Dónde se guarda?"
            hint="Navega hasta la carpeta padre y ponle nombre a la carpeta nueva, o entra en una que ya exista para darla de alta tal cual."
          >
            <FolderPicker value={repoPath} onChange={setRepoPath} />

            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border-1 bg-bg-3 px-3 py-2.5">
              <input
                type="checkbox"
                checked={initGit}
                onChange={(e) => setInitGit(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span className="text-sm text-txt-1">
                Inicializar como repositorio Git
                <span className="mt-0.5 block text-xs text-txt-3">
                  Sin repo, cada run trabaja sobre una copia de la carpeta: te quedas sin
                  ramas por run, sin diff y sin el botón de mergear. Si la carpeta ya es
                  un repo, esto no hace nada; si tiene contenido, el commit inicial se lo
                  lleva entero.
                </span>
              </span>
            </label>
          </Section>
        )}

        {step === 2 && (
          <Section
            title="CLAUDE.md del proyecto"
            hint="Se guarda en la carpeta y se inyecta en el workspace de cada run. Es opcional, pero es lo que evita que cada agente invente sus propias convenciones."
          >
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={withClaudeMd}
                onChange={(e) => setWithClaudeMd(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span className="text-sm text-txt-1">Crear un CLAUDE.md para este proyecto</span>
            </label>

            {withClaudeMd && claudeMdIsExisting && (
              <div className="flex items-start gap-2 rounded-md border border-warn/20 bg-warn-dim px-3 py-2 text-sm text-warn">
                <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
                <span>
                  Esa carpeta ya tiene un <span className="font-mono">CLAUDE.md</span>. Lo
                  estás editando: al crear el proyecto se sobrescribe con lo que dejes aquí.
                </span>
              </div>
            )}

            {withClaudeMd && (
              <div className="h-[420px] overflow-hidden rounded-md border border-border-1">
                <MonacoEditor
                  height="100%"
                  language="markdown"
                  theme="vs-dark"
                  value={claudeMd}
                  onChange={(value) => {
                    claudeMdTouched.current = true;
                    setClaudeMd(value ?? "");
                  }}
                  options={EDITOR_OPTIONS}
                />
              </div>
            )}
          </Section>
        )}

        {step === 3 && (
          <Section
            title="Tareas iniciales"
            hint="Claude las propone leyendo la descripción, el CLAUDE.md y lo que ya haya en la carpeta. Edítalas antes de guardarlas: se crearán en la columna «todo»."
          >
            {planning && <PlanProgress activity={activity} onCancel={stopPlan} />}

            {!planning && planError && (
              <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">
                <Icon name="alertCircle" size={13} className="mt-px shrink-0" />
                <div className="flex-1">
                  <div>{planError}</div>
                  <div className="mt-1 text-txt-3">
                    El proyecto ya está creado. Puedes reintentar, añadir las tareas a mano
                    o abrir el kanban vacío.
                  </div>
                </div>
              </div>
            )}

            {!planning && (
              <TaskList tasks={tasks} onChange={setTasks} />
            )}

            {!planning && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  icon="refresh"
                  onClick={() => project && void runPlan(project)}
                  disabled={!project}
                >
                  {tasks.length ? "Regenerar con Claude" : "Proponer con Claude"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="plus"
                  onClick={() =>
                    setTasks((current) => [
                      ...current,
                      { title: "", description: "", dependsOn: [] },
                    ])
                  }
                >
                  Añadir a mano
                </Button>
              </div>
            )}
          </Section>
        )}

        <div className="flex items-center justify-between border-t border-border-1 pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (step === 0 ? router.push("/projects") : setStep(step - 1))}
            disabled={busy || planning || step === 3}
          >
            {step === 0 ? "Cancelar" : "Atrás"}
          </Button>

          <div className="flex items-center gap-2">
            {step < 2 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setStep(step + 1)}
                disabled={!canContinue}
              >
                Continuar
              </Button>
            )}

            {step === 2 && (
              <Button
                variant="primary"
                size="sm"
                icon="bot"
                loading={busy}
                onClick={() => void startPlanning()}
              >
                Crear y planificar
              </Button>
            )}

            {step === 3 && (
              <Button
                variant="primary"
                size="sm"
                icon="check"
                loading={busy}
                disabled={planning}
                onClick={() => void finish()}
              >
                {tasks.filter((task) => task.title.trim()).length
                  ? `Guardar ${tasks.filter((task) => task.title.trim()).length} tareas y abrir el kanban`
                  : "Abrir el kanban"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepTabs({
  current,
  reached,
  onSelect,
}: {
  current: number;
  reached: number;
  onSelect: (step: number) => void;
}): ReactElement {
  return (
    <div className="flex gap-1.5">
      {STEPS.map((step, index) => {
        const done = index < reached;
        // Una vez creado el proyecto no se puede volver: la carpeta, el repo y
        // el CLAUDE.md ya están en disco.
        const clickable = index <= reached && reached < 3;
        return (
          <button
            key={step.label}
            type="button"
            disabled={!clickable}
            onClick={() => onSelect(index)}
            className={cn(
              "flex-1 rounded-md border px-3 py-2 text-left transition-colors",
              index === current
                ? "border-accent/35 bg-accent-dim"
                : "border-border-1 bg-bg-3",
              clickable && index !== current && "hover:border-border-3",
              !clickable && "cursor-default",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full text-2xs font-semibold",
                  index === current
                    ? "bg-accent text-white"
                    : done
                      ? "bg-ok/20 text-ok"
                      : "bg-bg-5 text-txt-3",
                )}
              >
                {done && index !== current ? <Icon name="check" size={9} /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-sm font-medium",
                  index === current ? "text-txt-1" : "text-txt-2",
                )}
              >
                {step.label}
              </span>
            </div>
            <div className="mt-0.5 pl-[22px] text-xs text-txt-3">{step.hint}</div>
          </button>
        );
      })}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h2 className="text-md font-semibold text-txt-1">{title}</h2>
        <p className="text-sm text-txt-3">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-txt-2">{label}</span>
      {children}
    </label>
  );
}

function PlanProgress({
  activity,
  onCancel,
}: {
  activity: string[];
  onCancel: () => void;
}): ReactElement {
  return (
    <div className="rounded-md border border-border-1 bg-bg-3 p-4">
      <div className="flex items-center gap-2.5">
        <Spinner size={14} />
        <span className="flex-1 text-sm text-txt-1">Claude está planificando el proyecto…</span>
        <Button size="xs" variant="ghost" icon="x" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {activity.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 border-t border-border-1 pt-3">
          {activity.map((line, index) => (
            <div
              key={`${index}-${line}`}
              className={cn(
                "truncate-1 font-mono text-xs",
                index === activity.length - 1 ? "text-txt-2" : "text-txt-3",
              )}
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskList({
  tasks,
  onChange,
}: {
  tasks: PlannedTask[];
  onChange: (tasks: PlannedTask[]) => void;
}): ReactElement {
  if (!tasks.length) {
    return (
      <div className="rounded-md border border-dashed border-border-2 px-4 py-10 text-center text-sm text-txt-3">
        Todavía no hay tareas propuestas.
      </div>
    );
  }

  const update = (index: number, patch: Partial<PlannedTask>): void =>
    onChange(tasks.map((task, i) => (i === index ? { ...task, ...patch } : task)));

  /**
   * Al borrar una tarea hay que reindexar: `dependsOn` son posiciones dentro de
   * este array, así que sin remapear las dependencias apuntarían a otra tarea.
   */
  const remove = (index: number): void =>
    onChange(
      tasks
        .filter((_, i) => i !== index)
        .map((task) => ({
          ...task,
          dependsOn: task.dependsOn
            .filter((dep) => dep !== index)
            .map((dep) => (dep > index ? dep - 1 : dep)),
        })),
    );

  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task, index) => (
        <div key={index} className="rounded-md border border-border-1 bg-bg-3 p-3">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-bg-5 text-2xs font-semibold text-txt-3">
              {index + 1}
            </span>
            <Input
              value={task.title}
              onChange={(e) => update(index, { title: e.target.value })}
              placeholder="Título de la tarea"
              inputSize="sm"
            />
            <Button
              size="xs"
              variant="ghost"
              icon="trash"
              onClick={() => remove(index)}
              aria-label="Quitar tarea"
            />
          </div>

          <Textarea
            value={task.description}
            onChange={(e) => update(index, { description: e.target.value })}
            placeholder="Qué hay que hacer y cómo se sabe que está hecho"
            rows={2}
            className="mt-2"
          />

          {task.dependsOn.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <Badge variant="yellow" size="xs">
                <Icon name="layers" size={9} />
                depende de {task.dependsOn.map((dep) => `#${dep + 1}`).join(", ")}
              </Badge>
              <button
                type="button"
                onClick={() => update(index, { dependsOn: [] })}
                className="text-xs text-txt-3 transition-colors hover:text-txt-1"
              >
                quitar
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
