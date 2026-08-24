import { AgentsView } from "./_components/agents-view.client";
import { AppShell } from "@/components/shell/app-shell.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Agentes — Claude Cockpit" };

export default function AgentsPage(): ReactElement {
  return (
    <AppShell crumbs={[{ label: "Agentes" }]}>
      <AgentsView />
    </AppShell>
  );
}
