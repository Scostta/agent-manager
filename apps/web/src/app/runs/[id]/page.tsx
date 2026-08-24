import { RunViewer } from "./_components/run-viewer.client";
import { AppShell } from "@/components/shell/app-shell.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Run — Claude Cockpit" };

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return (
    <AppShell crumbs={[{ label: "Proyectos", href: "/projects" }, { label: "Run" }]}>
      <RunViewer runId={id} />
    </AppShell>
  );
}
