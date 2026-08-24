import type { ReactElement } from "react";
import { AgentEditor } from "../[id]/_components/agent-editor.client";

export const metadata = { title: "Nuevo agente — Claude Cockpit" };

export default function NewAgentPage(): ReactElement {
  return <AgentEditor agentId="new" />;
}
