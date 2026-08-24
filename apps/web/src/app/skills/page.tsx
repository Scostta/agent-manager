import type { ReactElement } from "react";
import { SkillsView } from "./_components/skills-view.client";

export const metadata = { title: "Skills — Claude Cockpit" };

export default function SkillsPage(): ReactElement {
  return <SkillsView />;
}
