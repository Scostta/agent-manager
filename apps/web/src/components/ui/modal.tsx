"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "./icon";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex animate-slide-up flex-col gap-3 rounded-xl border border-border-2 bg-bg-3 p-5 shadow-xl"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-txt-1">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex text-txt-3 hover:text-txt-1"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
        {children}
        {footer && <div className="flex items-center gap-2 pt-1">{footer}</div>}
      </div>
    </div>
  );
}
