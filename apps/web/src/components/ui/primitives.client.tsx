"use client";

import { forwardRef } from "react";

import { Icon } from "@/components/ui/icon";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import type { IconName } from "@/components/ui/icon";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Badge ────────────────────────────────────────────────────────────────── */

type BadgeVariant =
  | "default"
  | "accent"
  | "green"
  | "red"
  | "yellow"
  | "blue"
  | "orange"
  | "ghost";

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  default: "bg-bg-5 text-txt-2 border-border-2",
  accent: "bg-accent-dim text-accent border-accent/25",
  green: "bg-ok-dim text-ok border-ok/25",
  red: "bg-danger-dim text-danger border-danger/25",
  yellow: "bg-warn-dim text-warn border-warn/25",
  blue: "bg-info-dim text-info border-info/25",
  orange: "bg-orange-dim text-orange border-orange/25",
  ghost: "bg-transparent text-txt-3 border-border-1",
};

const BADGE_SIZES = {
  xs: "px-[5px] text-2xs h-4 rounded-[3px]",
  sm: "px-1.5 text-xs h-[18px] rounded-sm",
  md: "px-2 text-sm h-[22px] rounded-sm",
} as const;

export function Badge({
  children,
  variant = "default",
  size = "sm",
  dot = false,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: keyof typeof BADGE_SIZES;
  dot?: boolean;
}): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap border font-medium",
        BADGE_VARIANTS[variant],
        BADGE_SIZES[size],
      )}
    >
      {dot && <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ── Chip ─────────────────────────────────────────────────────────────────── */

export function Chip({
  children,
  active,
  onClick,
  removable,
  onRemove,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  removable?: boolean;
  onRemove?: () => void;
}): ReactElement {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex select-none items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
        active
          ? "border-accent/35 bg-accent-dim text-accent"
          : "border-border-2 bg-bg-4 text-txt-2",
        onClick && "cursor-pointer hover:border-border-3",
      )}
    >
      {children}
      {removable && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Quitar"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onRemove?.();
            }
          }}
          className="flex cursor-pointer opacity-60 hover:opacity-100"
        >
          <Icon name="x" size={10} />
        </span>
      )}
    </Tag>
  );
}

/* ── Button ───────────────────────────────────────────────────────────────── */

type ButtonVariant = "default" | "primary" | "ghost" | "danger" | "subtle";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: "bg-bg-4 text-txt-1 border-border-2 hover:bg-bg-5",
  primary: "bg-accent text-white border-transparent hover:bg-accent-hover",
  ghost: "bg-transparent text-txt-2 border-transparent hover:bg-bg-3 hover:text-txt-1",
  danger: "bg-danger-dim text-danger border-danger/25 hover:border-danger/50",
  subtle: "bg-bg-3 text-txt-2 border-border-1 hover:bg-bg-4",
};

const BUTTON_SIZES = {
  xs: "h-6 px-2 text-xs rounded-sm gap-1.5",
  sm: "h-7 px-2.5 text-sm rounded-md gap-1.5",
  md: "h-[34px] px-3.5 text-base rounded-md gap-2",
  lg: "h-10 px-[18px] text-md rounded-lg gap-2",
} as const;

const ICON_SIZE = { xs: 11, sm: 12, md: 14, lg: 15 } as const;

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: keyof typeof BUTTON_SIZES;
    icon?: IconName;
    loading?: boolean;
  }
>(function Button(
  { children, variant = "default", size = "sm", icon, loading, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap border font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-45",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={ICON_SIZE[size]} color="currentColor" />
      ) : (
        icon && <Icon name={icon} size={ICON_SIZE[size]} />
      )}
      {children}
    </button>
  );
});

/* ── AgentAvatar ──────────────────────────────────────────────────────────── */

export const AGENT_COLORS = [
  "#7B6CF6",
  "#3FBA6E",
  "#E05050",
  "#C9961A",
  "#4A9EE8",
  "#D9784A",
  "#B06CB0",
] as const;

/** Color estable derivado del nombre: la API no guarda color por agente. */
export function agentColor(name: string): string {
  const sum = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AGENT_COLORS[Math.abs(sum) % AGENT_COLORS.length];
}

export function AgentAvatar({ name, size = 24 }: { name: string; size?: number }): ReactElement {
  const color = agentColor(name || "??");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border font-semibold"
      style={{
        width: size,
        height: size,
        background: `${color}28`,
        borderColor: `${color}60`,
        color,
        fontSize: size * 0.38,
      }}
      title={name}
    >
      {(name || "??").slice(0, 2).toUpperCase()}
    </span>
  );
}

/* ── StatusDot ────────────────────────────────────────────────────────────── */

const DOT_COLORS = {
  running: "var(--green)",
  done: "var(--blue)",
  error: "var(--red)",
  blocked: "var(--yellow)",
  idle: "var(--text-3)",
} as const;

export function StatusDot({
  status = "idle",
  pulse,
}: {
  status?: keyof typeof DOT_COLORS;
  pulse?: boolean;
}): ReactElement {
  const color = DOT_COLORS[status] ?? DOT_COLORS.idle;
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0 items-center justify-center">
      {pulse && (
        <span
          className="absolute -inset-[3px] animate-pulse-dot rounded-full opacity-25"
          style={{ background: color }}
        />
      )}
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: color }} />
    </span>
  );
}

/* ── Kbd ──────────────────────────────────────────────────────────────────── */

export function Kbd({ children }: { children: ReactNode }): ReactElement {
  return (
    <kbd className="inline-flex items-center justify-center rounded-sm border border-b-2 border-border-3 bg-bg-4 px-[5px] text-2xs leading-relaxed text-txt-3">
      {children}
    </kbd>
  );
}

/* ── Input ────────────────────────────────────────────────────────────────── */

const INPUT_SIZES = {
  sm: "h-7 text-sm",
  md: "h-[34px] text-base",
  lg: "h-10 text-md",
} as const;

export const Input = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
    inputSize?: keyof typeof INPUT_SIZES;
    mono?: boolean;
    prefixIcon?: IconName;
  }
>(function Input({ inputSize = "sm", mono, prefixIcon, className, ...rest }, ref) {
  return (
    <div className="relative flex w-full items-center">
      {prefixIcon && (
        <span className="pointer-events-none absolute left-2.5 flex text-txt-3">
          <Icon name={prefixIcon} size={13} />
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          "w-full rounded-md border border-border-2 bg-bg-3 text-txt-1 outline-none transition-colors",
          "placeholder:text-txt-3 focus:border-accent",
          INPUT_SIZES[inputSize],
          prefixIcon ? "pl-[30px] pr-2.5" : "px-2.5",
          mono && "font-mono",
          className,
        )}
        {...rest}
      />
    </div>
  );
});

export function Select({
  className,
  inputSize = "sm",
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  inputSize?: keyof typeof INPUT_SIZES;
}): ReactElement {
  return (
    <select
      className={cn(
        "w-full cursor-pointer appearance-none rounded-md border border-border-2 bg-bg-3 px-2.5 text-txt-1 outline-none transition-colors",
        "focus:border-accent",
        INPUT_SIZES[inputSize],
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className,
  mono,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return (
    <textarea
      className={cn(
        "w-full resize-y rounded-md border border-border-2 bg-bg-3 px-2.5 py-2 text-sm text-txt-1 outline-none transition-colors",
        "placeholder:text-txt-3 focus:border-accent",
        mono && "font-mono",
        className,
      )}
      {...rest}
    />
  );
}

/* ── Divider ──────────────────────────────────────────────────────────────── */

export function Divider({ label }: { label?: string }): ReactElement {
  if (!label) return <div className="h-px bg-border-1" />;
  return (
    <div className="flex items-center gap-2">
      <span className="h-px flex-1 bg-border-1" />
      <span className="text-2xs font-medium uppercase tracking-[.06em] text-txt-3">
        {label}
      </span>
      <span className="h-px flex-1 bg-border-1" />
    </div>
  );
}

/* ── Spinner ──────────────────────────────────────────────────────────────── */

export function Spinner({
  size = 14,
  color = "var(--accent)",
}: {
  size?: number;
  color?: string;
}): ReactElement {
  return (
    <span
      className="inline-block shrink-0 animate-spin-token rounded-full"
      style={{
        width: size,
        height: size,
        border: `2px solid ${color === "currentColor" ? "currentColor" : `${color}30`}`,
        borderTopColor: color,
        opacity: color === "currentColor" ? 0.5 : 1,
      }}
    />
  );
}

/* ── EmptyState ───────────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-border-2 bg-bg-3 text-txt-3">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <div className="text-base font-medium text-txt-1">{title}</div>
        {hint && <div className="mt-1 max-w-sm text-sm text-txt-3">{hint}</div>}
      </div>
      {action}
    </div>
  );
}
