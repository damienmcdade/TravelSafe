import type { Config } from "tailwindcss";

// TravelSafe design system — calm-but-alive, with a richer 2026 palette.
// Anti-pattern guardrails still apply (no red-as-default, no alarmist red),
// but colors are pushed saturation-wise so the UI feels active and modern.
// Adds an indigo accent for a third color voice (used for callouts, sparingly).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Class-based dark mode — toggled by adding/removing "dark" on
  // <html>. Implementation in lib/use-theme.ts; user toggle on
  // /settings/privacy. Dark variants intentionally cover only the
  // base surfaces + helper components — per-page polish happens
  // incrementally as components are touched.
  darkMode: "class",
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
          200: "#C2E0BD",
          500: "#5B9E51",
          700: "#2F6D26",
        },
        amber2: {
          200: "#F8D88A",
          500: "#E0962A",
          700: "#7E5C18",
        },
        dusk: {
          // Reserved for genuinely severe-tier indicators. Never the dominant color.
          500: "#B95049",
          700: "#7D2A24",
        },
        // Pacific blue — primary interactive
        bay: {
          50:  "#E8F4FA",
          100: "#CCE6F2",
          200: "#A0D0E5",
          400: "#3FA6CC",
          500: "#1E78A6",
          600: "#155F87",
          700: "#0E4F73",
        },
        // Sunset coral — hover / highlight
        coral: {
          200: "#FACBB6",
          400: "#EE8A66",
          500: "#E6643C",
          700: "#8E3819",
        },
        // Indigo — accent for callouts (sparingly used, never default)
        indigo2: {
          200: "#CBD0F2",
          500: "#5660C9",
          700: "#2F3886",
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
        "card":       "0 1px 0 rgba(28,35,44,0.04), 0 8px 22px -12px rgba(28,35,44,0.18)",
        "card-lift":  "0 4px 0 rgba(28,35,44,0.04), 0 22px 36px -18px rgba(28,35,44,0.28)",
        "ring-bay":   "0 0 0 3px rgba(30,120,166,0.22)",
        "glow-coral": "0 0 30px -6px rgba(230,100,60,0.45)",
        "glow-bay":   "0 0 32px -6px rgba(30,120,166,0.45)",
      },
      backgroundImage: {
        "hero-dusk":     "linear-gradient(135deg, #0E4F73 0%, #1E78A6 28%, #E6643C 78%, #F8D88A 100%)",
        "hero-soft":     "linear-gradient(160deg, #FAF7F2 0%, #E8F4FA 55%, #FACBB6 100%)",
        "panel-warm":    "linear-gradient(180deg, #FFFFFF 0%, #FAF7F2 100%)",
        "panel-bay":     "linear-gradient(180deg, #E8F4FA 0%, #FFFFFF 100%)",
        "panel-coral":   "linear-gradient(180deg, #FACBB6 0%, #FFFFFF 70%)",
        "title-stripe":  "linear-gradient(90deg, #1E78A6 0%, #5660C9 50%, #E6643C 100%)",
      },
      animation: {
        "fade-in":     "fade-in 0.35s ease-out both",
        "rise-in":     "rise-in 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "pop-in":      "pop-in 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2) both",
        "slide-up":    "slide-up 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.05) both",
        "shimmer":     "shimmer 1.6s linear infinite",
        "pulse-slow":  "pulse 3s ease-in-out infinite",
        "float":       "float 6s ease-in-out infinite",
        "gradient-x":  "gradient-x 8s ease infinite",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "rise-in": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "pop-in":  { "0%": { opacity: "0", transform: "scale(0.96)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        "slide-up": { "0%": { opacity: "0", transform: "translateY(100%)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        shimmer:   { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        float:     { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        "gradient-x": { "0%,100%": { backgroundPosition: "0% 50%" }, "50%": { backgroundPosition: "100% 50%" } },
      },
      transitionTimingFunction: { "spring": "cubic-bezier(0.2, 0.9, 0.3, 1.2)" },
    },
  },
  plugins: [],
};

export default config;
