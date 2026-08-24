import { ProjectBoard } from "./_components/project-board.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tablero — Claude Cockpit" };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <ProjectBoard projectId={id} />;
}
