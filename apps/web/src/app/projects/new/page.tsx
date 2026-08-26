import { NewProjectWizard } from "./_components/new-project-wizard.client";
import { AppShell } from "@/components/shell/app-shell.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Nuevo proyecto — Claude Cockpit" };

export default function NewProjectPage(): ReactElement {
  return (
    <AppShell crumbs={[{ label: "Proyectos", href: "/projects" }, { label: "Nuevo" }]}>
      <NewProjectWizard />
    </AppShell>
  );
}
