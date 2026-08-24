import { AppShell } from "@/components/shell/app-shell.client";
import { DashboardView } from "./_components/dashboard-view.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Consumo — Claude Cockpit" };

export default function DashboardPage(): ReactElement {
  return (
    <AppShell crumbs={[{ label: "Consumo" }]}>
      <DashboardView />
    </AppShell>
  );
}
