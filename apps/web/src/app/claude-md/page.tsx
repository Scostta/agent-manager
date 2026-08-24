import { ClaudeMdEditor } from "./_components/claude-md-editor.client";
import { AppShell } from "@/components/shell/app-shell.client";

import type { ReactElement } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "CLAUDE.md — Claude Cockpit" };

export default function ClaudeMdPage(): ReactElement {
  return (
    <AppShell crumbs={[{ label: "CLAUDE.md" }]}>
      <ClaudeMdEditor />
    </AppShell>
  );
}
