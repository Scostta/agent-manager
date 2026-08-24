import { AgentEditor } from "../_components/agent-editor.client";
import { AppShell } from "@/components/shell/app-shell.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Nuevo agente — Claude Cockpit" };

export default function NewAgentPage(): ReactElement {
  return (
    <AppShell crumbs={[{ label: "Agentes", href: "/agents" }, { label: "Nuevo" }]}>
      <AgentEditor agentId={null} />
    </AppShell>
  );
}
