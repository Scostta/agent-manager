import type { ReactElement } from "react";
import { AgentsList } from "./_components/agents-list.client";

export const metadata = { title: "Agentes — Claude Cockpit" };

export default function AgentsPage(): ReactElement {
  return <AgentsList />;
}
