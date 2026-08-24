import type { ReactElement } from "react";
import { ProjectsList } from "./_components/projects-list.client";

export const metadata = { title: "Proyectos — Claude Cockpit" };

export default function ProjectsPage(): ReactElement {
  return <ProjectsList />;
}
