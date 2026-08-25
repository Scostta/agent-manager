import { AppShell } from "@/components/shell/app-shell.client";
import { RunsView } from "./_components/runs-view.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Runs — Claude Cockpit" };

export default function RunsPage(): ReactElement {
  return (
    <AppShell crumbs={[{ label: "Runs" }]}>
      <RunsView />
    </AppShell>
  );
}
