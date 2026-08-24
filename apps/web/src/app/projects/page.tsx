"use client";

import { AppShell } from "@/components/shell/app-shell";
import { ProjectsView } from "@/components/projects/projects-view";

export default function ProjectsPage() {
  return (
    <AppShell crumbs={[{ label: "Proyectos" }]}>
      <ProjectsView />
    </AppShell>
  );
}
