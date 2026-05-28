/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        hud: {
          bg: "#050709",
          panel: "#111826",
          panel2: "#0c1320",
          border: "#1a2637",
          accent: "#a78bfa",   // violet primary
          accent2: "#22d3ee",  // cyan secondary
          warn: "#fbbf24",
          danger: "#fb7185",
          ok: "#34d399",
          mute: "#4f5b6e",
          text: "#eaf1fb",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
        sans: ["Geist", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 18px rgba(167,139,250,0.35)",
        "glow-ok": "0 0 12px rgba(52,211,153,0.4)",
        glass: "0 30px 80px -30px rgba(0,0,0,0.7), 0 1px 0 0 rgba(255,255,255,0.06) inset, 0 -1px 0 0 rgba(0,0,0,0.3) inset",
      },
    },
  },
  plugins: [],
};
