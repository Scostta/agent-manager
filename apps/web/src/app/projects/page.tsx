import { ProjectsView } from "./_components/projects-view.client";
import { AppShell } from "@/components/shell/app-shell.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Proyectos — Claude Cockpit" };

export default function ProjectsPage(): ReactElement {
  return (
    <AppShell crumbs={[{ label: "Proyectos" }]}>
      <ProjectsView />
    </AppShell>
  );
}
