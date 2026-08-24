"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Icon } from "@/components/ui/icon";

import type { ReactElement, ReactNode } from "react";

type ToastType = "default" | "success" | "error" | "warn";
type ToastItem = { id: number; message: string; type: ToastType };

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const DOT_COLOR: Record<ToastType, string> = {
  default: "bg-txt-2",
  success: "bg-ok",
  error: "bg-danger",
  warn: "bg-warn",
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }): ReactElement {
  useEffect(() => {
    const timer = setTimeout(onDismiss, item.type === "error" ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [item.type, onDismiss]);

  return (
    <div className="flex max-w-sm animate-slide-up items-center gap-2.5 rounded-lg border border-border-2 bg-bg-4 px-3.5 py-2.5 shadow-lg">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_COLOR[item.type]}`} />
      <span className="flex-1 text-base text-txt-1">{item.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar"
        className="flex text-txt-3 hover:text-txt-1"
      >
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, type: ToastType = "default") => {
    setToasts((current) => [...current, { id: nextId++, message, type }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[2000] flex flex-col gap-2">
        {toasts.map((item) => (
          <div key={item.id} className="pointer-events-auto">
            <Toast item={item} onDismiss={() => dismiss(item.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
