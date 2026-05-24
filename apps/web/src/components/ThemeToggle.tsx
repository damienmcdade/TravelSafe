"use client";
import type { ReactNode } from "react";
import { useTheme, type Theme } from "@/lib/use-theme";

/// Compact light/dark/system theme picker. Designed to live in a page
/// header — three small pill buttons in a single row. Same hook the
/// /settings/privacy AppearanceControls use, so any change here
/// propagates everywhere immediately.
export function ThemeToggle({
  align = "right",
  size = "sm",
}: {
  align?: "left" | "right";
  /// "sm" — landing-page corner placement (compact)
  /// "md" — in-flow placement (slightly larger)
  size?: "sm" | "md";
}) {
  const { theme, setTheme } = useTheme();
  const padding = size === "sm" ? "px-2 py-1" : "px-3 py-1.5";
  const text = size === "sm" ? "text-[11px]" : "text-xs";
  const alignCls = align === "right" ? "justify-end" : "justify-start";
  const opts: Array<{ id: Theme; label: string; sublabel: string; icon: ReactNode }> = [
    {
      id: "light", label: "Light", sublabel: "Use the light theme",
      icon: <SunIcon />,
    },
    {
      id: "dark", label: "Dark", sublabel: "Use the dark theme",
      icon: <MoonIcon />,
    },
    {
      id: "system", label: "Auto", sublabel: "Match your device's theme",
      icon: <SystemIcon />,
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex items-center gap-0.5 surface-muted p-0.5 ${alignCls}`}
    >
      {opts.map((o) => {
        const active = theme === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.sublabel}
            onClick={() => setTheme(o.id)}
            className={`inline-flex items-center gap-1 ${padding} ${text} rounded-md transition-colors ${
              active
                ? "bg-bay-500 text-white font-semibold"
                : "text-slate2-700 hover:bg-bay-100"
            }`}
          >
            <span aria-hidden className="w-3 h-3">{o.icon}</span>
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M3.5 12.5L5 11M11 5l1.5-1.5" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M13.5 9.5a5 5 0 1 1-7-7 6 6 0 0 0 7 7z" />
    </svg>
  );
}
function SystemIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="9" rx="1.5" />
      <path d="M6 14h4M8 12v2" strokeLinecap="round" />
    </svg>
  );
}
