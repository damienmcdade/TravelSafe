"use client";
import type { BaselinePoint } from "./types";

export interface BaselineTrendChartProps {
  /// Weekly bucket counts ordered oldest → newest.
  points: BaselinePoint[];
  /// Friendly label for the y-axis caption.
  metric?: string;
}

const WIDTH = 600;
const HEIGHT = 120;
const PAD = { top: 12, right: 8, bottom: 18, left: 8 };

/// A calm baseline sparkline rendered as a smooth area under a polyline.
/// Used as the empty-state fallback for ThreatFeed — when an area has no
/// dispatches in the past 30 days, we still show the user the macro
/// historical shape so the panel is never blank.
export function BaselineTrendChart({ points, metric = "weekly reported incidents" }: BaselineTrendChartProps) {
  if (points.length === 0) {
    return (
      <div className="surface-muted p-6 text-sm text-slate2-500 text-center">
        Historical baseline is still building for this area.
      </div>
    );
  }

  const max = Math.max(...points.map((p) => p.count), 1);
  const stepX = (WIDTH - PAD.left - PAD.right) / Math.max(1, points.length - 1);
  const yFor = (n: number) => HEIGHT - PAD.bottom - ((n / max) * (HEIGHT - PAD.top - PAD.bottom));

  const linePath = points.map((p, i) => {
    const x = PAD.left + i * stepX;
    const y = yFor(p.count);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const areaPath =
    `${linePath} L ${(PAD.left + (points.length - 1) * stepX).toFixed(1)} ${HEIGHT - PAD.bottom} L ${PAD.left.toFixed(1)} ${HEIGHT - PAD.bottom} Z`;

  const avg = Math.round(points.reduce((a, b) => a + b.count, 0) / points.length);

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-32"
        role="img"
        aria-label={`Baseline of ${metric}, ${points.length} weeks of history`}
      >
        <defs>
          <linearGradient id="szt-baseline-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#5C8AA7" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#5C8AA7" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Average reference line */}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={yFor(avg)}
          y2={yFor(avg)}
          stroke="#cbd5e1"
          strokeDasharray="3 4"
          strokeWidth={1}
        />
        <text
          x={WIDTH - PAD.right}
          y={yFor(avg) - 4}
          textAnchor="end"
          fontSize="9"
          fill="#64748b"
        >
          avg {avg}
        </text>

        <path d={areaPath} fill="url(#szt-baseline-gradient)" />
        <path d={linePath} fill="none" stroke="#5C8AA7" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-xs text-slate2-500 leading-snug">
        Analytical baseline — {points.length}-week rolling history of {metric} for this area.
      </p>
    </div>
  );
}
