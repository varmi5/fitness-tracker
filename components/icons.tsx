import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 20, props: IconProps = {}) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.85,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  ...props,
});

export function HomeRingIcon({ size = 22, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="8.5" opacity="0.32" />
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
      <path d="M9 7.5c0-1.2 1-2 1-3" />
      <path d="M14 8c0-1.2 1-2 1-3" />
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

export function CheckRingIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.3 2.3 4.7-5" />
    </svg>
  );
}
