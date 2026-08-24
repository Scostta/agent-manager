import type { ReactElement } from "react";
import { cn } from "~/lib/cn";

type Variant =
  | "default"
  | "accent"
  | "green"
  | "red"
  | "yellow"
  | "blue"
  | "orange"
  | "ghost";

type Props = {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
};

const variantClasses: Record<Variant, string> = {
  default: "bg-bg-4 text-text-2 border border-border-2",
  accent: "bg-accent-dim text-accent border border-accent/30",
  green: "bg-green-dim text-green border border-green/30",
  red: "bg-red-dim text-red border border-red/30",
  yellow: "bg-yellow-dim text-yellow border border-yellow/30",
  blue: "bg-blue-dim text-blue border border-blue/30",
  orange: "bg-orange-dim text-orange border border-orange/30",
  ghost: "text-text-2",
};

export function Badge(props: Props): ReactElement {
  const { variant = "default", className, children } = props;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
