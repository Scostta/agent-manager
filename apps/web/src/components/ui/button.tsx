import type { ReactElement } from "react";
import { cn } from "~/lib/cn";

type Variant = "default" | "primary" | "ghost" | "danger" | "subtle";
type Size = "xs" | "sm" | "md" | "lg";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
};

const variantClasses: Record<Variant, string> = {
  default:
    "bg-bg-4 text-text-1 border border-border-2 hover:bg-bg-5 hover:border-border-3",
  primary:
    "bg-accent text-white hover:bg-accent-hover border border-transparent",
  ghost:
    "bg-transparent text-text-2 hover:bg-bg-hover hover:text-text-1 border border-transparent",
  danger:
    "bg-red-dim text-red border border-red/30 hover:bg-red/20",
  subtle:
    "bg-bg-3 text-text-2 border border-border-1 hover:bg-bg-4 hover:text-text-1",
};

const sizeClasses: Record<Size, string> = {
  xs: "h-6 px-2 text-xs gap-1",
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
  lg: "h-9 px-4 text-sm gap-2",
};

export function Button(props: Props): ReactElement {
  const {
    variant = "default",
    size = "md",
    isLoading = false,
    className,
    disabled,
    children,
    ...rest
  } = props;

  return (
    <button
      {...rest}
      disabled={disabled || isLoading}
      className={cn(
        "inline-flex items-center justify-center rounded font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {isLoading ? (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
}
