import type { Config } from "tailwindcss";

// TravelSafe design system — calm-but-alive.
// Keeps the anti-pattern rule (no red-as-default, no alarmist red), but pairs
// the warm sand/slate base with a Pacific-blue accent and a sunset-coral
// highlight so interactive surfaces have life.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sand: {
          50:  "#FAF7F2",
          100: "#F2EBDD",
          200: "#E5D9BF",
          300: "#D2C19A",
          500: "#A48E63",
          700: "#6B5A38",
        },
        slate2: {
          50:  "#F1F3F5",
          200: "#C3CAD2",
          500: "#5D6A78",
          700: "#3A4654",
          900: "#1C232C",
        },
        sage: {
          200: "#CCDCC8",
          500: "#6C8B62",
          700: "#3F5C3B",
        },
        amber2: {
          200: "#F3D9A1",
          500: "#C18A2A",
          700: "#7E5C18",
        },
        dusk: {
          // Reserved for genuinely severe-tier indicators. Never the dominant color.
          500: "#B95049",
          700: "#7D2A24",
        },
        // New: Pacific-blue accent for primary interactive elements.
        bay: {
          50:  "#EFF6F9",
          200: "#BFDCE7",
          400: "#5FA4BE",
          500: "#357F9C",
          600: "#23627B",
          700: "#1A4B5E",
        },
        // New: sunset-coral highlight for hover/active emphasis.
        coral: {
          200: "#F7C9B5",
          400: "#E58C6A",
          500: "#D26E47",
          700: "#8E4528",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["ui-serif", "Georgia", "Cambria", "Times New Roman", "serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        "card":      "0 1px 0 rgba(28,35,44,0.04), 0 6px 18px -10px rgba(28,35,44,0.16)",
        "card-lift": "0 4px 0 rgba(28,35,44,0.04), 0 18px 32px -16px rgba(28,35,44,0.22)",
        "ring-bay":  "0 0 0 3px rgba(53,127,156,0.18)",
      },
      backgroundImage: {
        "hero-dusk":    "linear-gradient(135deg, #1A4B5E 0%, #357F9C 35%, #D26E47 100%)",
        "hero-soft":    "linear-gradient(160deg, #FAF7F2 0%, #EFF6F9 60%, #F7C9B5 100%)",
        "panel-warm":   "linear-gradient(180deg, #FFFFFF 0%, #FAF7F2 100%)",
        "panel-bay":    "linear-gradient(180deg, #EFF6F9 0%, #FFFFFF 100%)",
      },
      animation: {
        "fade-in":    "fade-in 0.35s ease-out both",
        "rise-in":    "rise-in 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "pop-in":     "pop-in 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2) both",
        "shimmer":    "shimmer 1.6s linear infinite",
        "pulse-slow": "pulse 3s ease-in-out infinite",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      transitionTimingFunction: {
        "spring": "cubic-bezier(0.2, 0.9, 0.3, 1.2)",
      },
    },
  },
  plugins: [],
};

export default config;
