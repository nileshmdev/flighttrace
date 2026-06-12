/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Design tokens ── color encodes STATUS, not identity ──
        surface: {
          bg: "#0B0E11", // app background
          card: "#16191F", // panels & cards
          raised: "#1D222B", // hover rows / nested containers
          border: "#262B33", // the one 1px border color
        },
        status: {
          good: "#34D399", // nominal
          caution: "#FBBF24", // degraded — weak RSSI, battery 20–35%
          critical: "#F87171", // TRUE alarms only — link loss, batt <20%, GPS lost
        },
        brand: "#8B7FE8", // chrome only (scrubber, active nav, selection) — never on telemetry values
        data: "#E8EAED", // neutral telemetry text
        label: "rgb(232 234 237 / 0.55)", // uppercase labels
        unit: "rgb(232 234 237 / 0.60)", // trailing units
      },
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      // Exactly three radii: cards, buttons/inputs/chips, pills/badges.
      borderRadius: {
        card: "0.625rem",
        btn: "0.5rem",
        pill: "9999px",
      },
      letterSpacing: {
        label: "0.08em",
      },
      boxShadow: {
        // Soft elevation only — 1px borders carry edge definition over the map.
        overlay: "0 8px 24px rgba(0,0,0,0.45)",
        glow: "0 0 8px rgba(52,211,153,0.5)", // status dot halo (good)
      },
    },
  },
  plugins: [],
};
