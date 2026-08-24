import type { ReactElement } from "react";
import { cn } from "~/lib/cn";

// 7 colores determinísticos para avatares de agentes
const AVATAR_COLORS = [
  "bg-[#4A3FBA] text-[#C4BEFF]", // violet
  "bg-[#163B5A] text-[#4A9EE8]", // blue
  "bg-[#1A3A28] text-[#3FBA6E]", // green
  "bg-[#352800] text-[#C9961A]", // yellow
  "bg-[#351A0A] text-[#D9784A]", // orange
  "bg-[#3A1818] text-[#E05050]", // red
  "bg-[#2A1A3A] text-[#C084F5]", // pink
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Size = "xs" | "sm" | "md" | "lg";

type Props = {
  agentId: string;
  name: string;
  size?: Size;
  className?: string;
};

const sizeClasses: Record<Size, string> = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-7 w-7 text-xs",
  lg: "h-9 w-9 text-sm",
};

export function AgentAvatar(props: Props): ReactElement {
  const { agentId, name, size = "md", className } = props;
  const colorClass = AVATAR_COLORS[hashId(agentId) % AVATAR_COLORS.length];
  const initials = getInitials(name);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        colorClass,
        sizeClasses[size],
        className,
      )}
      title={name}
    >
      {initials}
    </span>
  );
}
