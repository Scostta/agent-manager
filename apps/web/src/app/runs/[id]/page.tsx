import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { runs } from "~/lib/api";
import { RunViewer } from "./_components/run-viewer.client";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function RunPage(props: Props): Promise<ReactElement> {
  const { id } = await props.params;

  const run = await runs.get(id).catch(() => null);
  if (!run) notFound();

  return <RunViewer initialRun={run} />;
}
