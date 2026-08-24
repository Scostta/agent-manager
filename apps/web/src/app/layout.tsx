import type { ReactElement } from "react";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "~/components/sidebar.client";
import { Header } from "~/components/header.client";
import "./globals.css";

const fontSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "Agent Manager",
  description: "Dashboard local para orquestar agentes Claude Code CLI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): ReactElement {
  return (
    <html lang="es" className="dark">
      <body
        className={`${fontSans.variable} ${fontMono.variable} flex h-screen overflow-hidden bg-bg-base font-sans text-text-1 antialiased`}
      >
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
