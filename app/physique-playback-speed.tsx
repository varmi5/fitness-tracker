"use client";

export const PHYSIQUE_FRAME_INTERVALS = { 0.5: 1600, 1: 800, 2: 350 } as const;
export type PhysiqueSpeed = keyof typeof PHYSIQUE_FRAME_INTERVALS;

export function PhysiquePlaybackSpeed({ speed, onChange }: { speed: PhysiqueSpeed; onChange: (speed: PhysiqueSpeed) => void }) {
  return (
    <div className="physique-pill-toggle" role="group" aria-label="Playback speed">
      {([0.5, 1, 2] as const).map((value) => (
        <button key={value} type="button" aria-pressed={speed === value}
          className={speed === value ? "is-active" : ""} onClick={() => onChange(value)}>
          {value}x
        </button>
      ))}
    </div>
  );
}
