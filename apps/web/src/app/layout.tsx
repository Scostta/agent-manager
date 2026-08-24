import { ToastProvider } from "@/components/ui/toast.client";

import "./globals.css";

import type { ReactElement, ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Claude Cockpit",
  description: "Dashboard personal para orquestar agentes Claude Code",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <html lang="es">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
