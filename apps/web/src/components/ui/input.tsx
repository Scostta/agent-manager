import type { ReactElement } from "react";
import { cn } from "~/lib/cn";

type Size = "sm" | "md" | "lg";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  inputSize?: Size;
  mono?: boolean;
  prefixIcon?: ReactElement;
  error?: string;
  label?: string;
};

const sizeClasses: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
  lg: "h-9 px-3.5 text-sm",
};

export function Input(props: Props): ReactElement {
  const {
    inputSize = "md",
    mono = false,
    prefixIcon,
    error,
    label,
    className,
    id,
    ...rest
  } = props;

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label
          htmlFor={id}
          className="text-xs font-medium text-text-2"
        >
          {label}
        </label>
      ) : null}
      <div className="relative flex items-center">
        {prefixIcon ? (
          <span className="pointer-events-none absolute left-2.5 flex items-center text-text-3">
            {prefixIcon}
          </span>
        ) : null}
        <input
          {...rest}
          id={id}
          className={cn(
            "w-full rounded border bg-bg-3 text-text-1 placeholder:text-text-3",
            "border-border-2 transition-colors",
            "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-red focus:border-red focus:ring-red/30",
            prefixIcon && "pl-8",
            mono && "font-mono",
            sizeClasses[inputSize],
            className,
          )}
        />
      </div>
      {error ? (
        <p className="text-xs text-red" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
