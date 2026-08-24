import type { ReactElement } from "react";
import type { TaskRunStatus } from "@agent-manager/types";
import { cn } from "~/lib/cn";

type Props = {
  status: TaskRunStatus;
  className?: string;
};

const statusColor: Record<TaskRunStatus, string> = {
  queued: "bg-yellow",
  running: "bg-blue",
  succeeded: "bg-green",
  failed: "bg-red",
  cancelled: "bg-text-3",
};

export function StatusDot(props: Props): ReactElement {
  const { status, className } = props;
  const isActive = status === "running" || status === "queued";

  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        statusColor[status],
        isActive && "animate-pulse",
        className,
      )}
    />
  );
}
