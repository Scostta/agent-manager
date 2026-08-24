import type { ReactElement } from "react";
import { agents, skills } from "~/lib/api";
import { KanbanBoard } from "./_components/kanban-board.client";

type Props = {
  params: Promise<{ id: string }>;
};

export const metadata = { title: "Kanban — Agent Manager" };

export default async function KanbanPage(props: Props): Promise<ReactElement> {
  const { id } = await props.params;

  // Fetch agents and skills server-side; tasks are fetched client-side via SWR
  const [agentList, skillList] = await Promise.all([
    agents.list().catch(() => []),
    skills.list().catch(() => []),
  ]);

  return (
    <div className="flex h-full flex-col">
      <KanbanBoard
        projectId={id}
        agents={agentList}
        allSkills={skillList}
      />
    </div>
  );
}
