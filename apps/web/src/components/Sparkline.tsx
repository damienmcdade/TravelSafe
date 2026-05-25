"use client";

export function Sparkline({
  values,
  width = 160,
  height = 40,
  stroke = "currentColor",
  fill = "rgba(0,0,0,0.06)",
  ariaLabel,
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  /// Caller-provided accessible label so screen readers get prose
  /// describing the sparkline (e.g. "Weekly trend: 4, 7, 6, 5, 8,
  /// 3 — most recent week 3"). v67 followup: app-audit caught
  /// these renders had no aria-label and SVGs were silent to AT.
  ariaLabel?: string;
}) {
  if (values.length === 0) return <span className="text-xs text-slate2-500">no data</span>;
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * (height - 4) - 2;
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${width},${height} L 0,${height} Z`;
  // Auto-derive an accessible label when none is provided: render the
  // raw values + a "most recent: N" hint so screen readers get
  // something — anything is better than the prior empty <svg>.
  const autoLabel = ariaLabel ?? `Sparkline values: ${values.join(", ")}; most recent ${values[values.length - 1]}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={autoLabel}
    >
      <path d={areaPath} fill={fill} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.length > 0 && (() => {
        const [cx, cy] = points[points.length - 1];
        return <circle cx={cx} cy={cy} r={2.5} fill={stroke} />;
      })()}
    </svg>
  );
}
