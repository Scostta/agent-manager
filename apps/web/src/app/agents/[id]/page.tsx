import type { ReactElement } from "react";
import { AgentEditor } from "./_components/agent-editor.client";

type Props = {
  params: Promise<{ id: string }>;
};

export const metadata = { title: "Agente — Claude Cockpit" };

export default async function AgentDetailPage(props: Props): Promise<ReactElement> {
  const { id } = await props.params;
  return <AgentEditor agentId={id} />;
}
