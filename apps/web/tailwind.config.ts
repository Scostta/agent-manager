import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-base": "var(--bg-base)",
        "bg-2": "var(--bg-2)",
        "bg-3": "var(--bg-3)",
        "bg-4": "var(--bg-4)",
        "bg-5": "var(--bg-5)",
        "bg-hover": "var(--bg-hover)",
        "bg-active": "var(--bg-active)",
        "border-1": "var(--border-1)",
        "border-2": "var(--border-2)",
        "border-3": "var(--border-3)",
        "text-1": "var(--text-1)",
        "text-2": "var(--text-2)",
        "text-3": "var(--text-3)",
        accent: "var(--accent)",
        "accent-dim": "var(--accent-dim)",
        "accent-hover": "var(--accent-hover)",
        green: "var(--green)",
        "green-dim": "var(--green-dim)",
        yellow: "var(--yellow)",
        "yellow-dim": "var(--yellow-dim)",
        red: "var(--red)",
        "red-dim": "var(--red-dim)",
        blue: "var(--blue)",
        "blue-dim": "var(--blue-dim)",
        orange: "var(--orange)",
        "orange-dim": "var(--orange-dim)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
} satisfies Config;
