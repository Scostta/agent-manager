/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Los valores viven en globals.css como custom properties para que el
        // accent se pueda cambiar en caliente sin recompilar Tailwind.
        bg: {
          base: "var(--bg-base)",
          2: "var(--bg-2)",
          3: "var(--bg-3)",
          4: "var(--bg-4)",
          5: "var(--bg-5)",
          hover: "var(--bg-hover)",
          active: "var(--bg-active)",
        },
        border: {
          1: "var(--border-1)",
          2: "var(--border-2)",
          3: "var(--border-3)",
        },
        txt: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)",
          inv: "var(--text-inv)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          dim: "var(--accent-dim)",
          hover: "var(--accent-hover)",
          fg: "var(--accent-fg)",
        },
        ok: { DEFAULT: "var(--green)", dim: "var(--green-dim)" },
        warn: { DEFAULT: "var(--yellow)", dim: "var(--yellow-dim)" },
        danger: { DEFAULT: "var(--red)", dim: "var(--red-dim)" },
        info: { DEFAULT: "var(--blue)", dim: "var(--blue-dim)" },
        orange: { DEFAULT: "var(--orange)", dim: "var(--orange-dim)" },
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "1.4"],
        xs: ["11px", "1.45"],
        sm: ["12px", "1.5"],
        base: ["13px", "1.5"],
        md: ["14px", "1.45"],
        lg: ["18px", "1.35"],
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,.4)",
        md: "0 2px 8px rgba(0,0,0,.5)",
        lg: "0 8px 32px rgba(0,0,0,.7)",
        xl: "0 16px 48px rgba(0,0,0,.8)",
      },
      spacing: {
        sidebar: "var(--sidebar-w)",
        header: "var(--header-h)",
      },
      animation: {
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
        "fade-in": "fade-in 120ms ease forwards",
        "slide-right": "slide-in-right 150ms ease forwards",
        "slide-up": "slide-in-up 150ms ease forwards",
        "spin-token": "spin-token .7s linear infinite",
      },
    },
  },
  plugins: [],
};
