import { AgentEditor } from "../_components/agent-editor.client";
import { AppShell } from "@/components/shell/app-shell.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Agente — Claude Cockpit" };

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return (
    <AppShell crumbs={[{ label: "Agentes", href: "/agents" }, { label: "Editar" }]}>
      <AgentEditor agentId={id} />
    </AppShell>
  );
}
