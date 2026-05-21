"use client";

export function Sparkline({
  values,
  width = 160,
  height = 40,
  stroke = "currentColor",
  fill = "rgba(0,0,0,0.06)",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
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
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={areaPath} fill={fill} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.length > 0 && (() => {
        const [cx, cy] = points[points.length - 1];
        return <circle cx={cx} cy={cy} r={2.5} fill={stroke} />;
      })()}
    </svg>
  );
}
