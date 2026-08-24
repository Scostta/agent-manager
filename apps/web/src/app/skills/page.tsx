import { AppShell } from "@/components/shell/app-shell.client";
import { SkillsView } from "./_components/skills-view.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Skills — Claude Cockpit" };

export default function SkillsPage(): ReactElement {
  return (
    <AppShell crumbs={[{ label: "Skills" }]}>
      <SkillsView />
    </AppShell>
  );
}
