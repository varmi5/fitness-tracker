import type { SVGProps } from "react";
import type { MealCategory } from "../lib/nutrition-model";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 20, props: IconProps = {}) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  ...props,
});

export function McpBrandMark({ size = 22, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3" y="3" width="18" height="18" rx="5.5" strokeWidth="1.9" />
      <path d="M7.5 14.5 10 9.5l2.5 3 2.5-4.5 1.5 6.5" />
      <circle cx="16.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function HomeRingIcon({ size = 22, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="8.5" opacity="0.28" />
      <path d="M12 3.5a8.5 8.5 0 1 1-6.9 13.45" />
      <path d="M8.5 12.5 11 10l2.2 2.2 2.8-3.2" />
    </svg>
  );
}

export function NutritionBowlIcon({ size = 22, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4 12h16a8 8 0 0 1-16 0Z" />
      <path d="M8 19.5h8" />
      <path d="M9.5 7.5c0-1.2.9-2 .9-3" />
      <path d="M14.5 7.5c0-1.2.9-2 .9-3" />
    </svg>
  );
}

export function MeasurementsCaliperIcon({ size = 22, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="4" width="16" height="6" rx="2" />
      <path d="M8 10v2M12 10v3M16 10v2" />
      <path d="M6 15.5h12" />
      <path d="M6 15.5l2.5-2M6 15.5l2.5 2M18 15.5l-2.5-2M18 15.5l-2.5 2" />
    </svg>
  );
}

export function SettingsSlidersIcon({ size = 22, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4 7h9M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 17h3M11 17h9" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}

export function FlameBurnIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 3c2.8 3.2 5 5.8 5 9.2a5 5 0 1 1-10 0c0-2.1 1.1-4.1 2.4-5.7.2 1.6 1 2.5 2.1 2.9-.5-2-.2-4.2.5-6.4Z" />
    </svg>
  );
}

export function FootstepsIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M8.5 13c-1.5 0-2.5-1.4-2.5-3.4C6 7.4 7.2 5.5 8.8 5.5S11 7.2 11 9.5c0 2-1 3.5-2.5 3.5Z" />
      <path d="M7.3 15.5h2.4c.5 1.3 0 2.5-1.2 2.5s-1.7-1.2-1.2-2.5Z" />
      <path d="M15.5 15c-1.5 0-2.5-1.4-2.5-3.4 0-2.2 1.2-4.1 2.8-4.1S18 9.2 18 11.5c0 2-1 3.5-2.5 3.5Z" />
      <path d="M14.3 17.5h2.4c.5 1.3 0 2.5-1.2 2.5s-1.7-1.2-1.2-2.5Z" />
    </svg>
  );
}

export function ScaleWeighedIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8.5 11.5a4.5 4.5 0 0 1 7 0" />
      <path d="M12 12l2-2.5" />
    </svg>
  );
}

export function WeightScaleIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M8 9.5a4.5 4.5 0 0 1 8 0" />
      <path d="m12 10 1.8-2.2" />
      <path d="M7.5 16.5h9" opacity="0.45" />
    </svg>
  );
}

export function SparklePhotoIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3.5" y="6" width="17" height="13" rx="3" />
      <circle cx="12" cy="12.5" r="2.8" />
      <path d="M9 6l1.2-2h3.6L15 6" />
    </svg>
  );
}

export function FitbitPulseIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 12h3.5l2.2-5 3.6 10 2.4-5H21" />
    </svg>
  );
}

export function TwoWaySyncIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M7 16V4m0 0L4 7m3-3 3 3" />
      <path d="M17 8v12m0 0-3-3m3 3 3-3" />
    </svg>
  );
}

export function CheckRingIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.3 2.3 4.7-5" />
    </svg>
  );
}

export function SunThemeIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonThemeIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7Z" />
    </svg>
  );
}

export function MealCategoryIcon({ category, size = 16 }: { category: MealCategory; size?: number }) {
  switch (category) {
    case "breakfast":
      return (
        <svg {...base(size)}>
          <path d="M4 17h16" />
          <path d="M6.5 17a5.5 5.5 0 0 1 11 0" />
          <path d="M12 5v2.5M6.2 8.2l1.6 1.6M17.8 8.2l-1.6 1.6" />
        </svg>
      );
    case "lunch":
      return (
        <svg {...base(size)}>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="3" opacity="0.45" />
        </svg>
      );
    case "dinner":
      return (
        <svg {...base(size)}>
          <path d="M5 13h14a7 7 0 0 1-14 0Z" />
          <path d="M9 19.5h6M9.5 8.5l.8-2M14 8.5l.8-2" />
        </svg>
      );
    case "drinks":
      return (
        <svg {...base(size)}>
          <path d="M7 7h9v7.5a4.5 4.5 0 0 1-9 0V7Z" />
          <path d="M16 9h2a2 2 0 0 1 0 4h-2" />
          <path d="M6 20h11" />
        </svg>
      );
    case "snacks":
    default:
      return (
        <svg {...base(size)}>
          <path d="M12 4.5c2.2-1.5 5-.2 5 2.7 0 4-2.8 11.3-5 11.3S7 11.2 7 7.2c0-2.9 2.8-4.2 5-2.7Z" />
          <path d="M12 4.5V2.5" />
        </svg>
      );
  }
}

export function BevelSegmentedRing({
  pct,
  overTarget,
  size = 138,
}: {
  pct: number;
  overTarget?: boolean;
  size?: number;
}) {
  const ticks = 40;
  const activeCount = Math.round((Math.min(100, Math.max(0, pct)) / 100) * ticks);
  const cx = 68;
  const cy = 68;
  const rInner = 50;
  const rOuter = 61;

  return (
    <svg width={size} height={size} viewBox="0 0 136 136" aria-hidden="true" style={{ display: "block" }}>
      {Array.from({ length: ticks }, (_, i) => {
        const angle = ((i / ticks) * 360 - 90) * (Math.PI / 180);
        const x1 = cx + rInner * Math.cos(angle);
        const y1 = cy + rInner * Math.sin(angle);
        const x2 = cx + rOuter * Math.cos(angle);
        const y2 = cy + rOuter * Math.sin(angle);
        const isLit = i < activeCount;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={isLit ? (overTarget ? "var(--danger-fg)" : "var(--accent)") : "var(--track)"}
            strokeWidth={3.1}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

export function BevelDotGauge({ pct, color }: { pct: number; color: string }) {
  const cols = 5;
  const rows = 4;
  const total = cols * rows;
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * total);

  return (
    <svg width="46" height="36" viewBox="0 0 46 36" aria-hidden="true" style={{ flexShrink: 0 }}>
      {Array.from({ length: total }, (_, idx) => {
        const col = Math.floor(idx / rows);
        const rowFromBottom = idx % rows;
        const row = rows - 1 - rowFromBottom;
        const lit = idx < filled;
        return (
          <circle
            key={idx}
            cx={5 + col * 9}
            cy={5 + row * 8.5}
            r={3}
            fill={lit ? color : "var(--track)"}
          />
        );
      })}
    </svg>
  );
}
