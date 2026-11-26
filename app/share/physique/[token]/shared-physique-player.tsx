"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { PhysiquePose } from "../../../../lib/physique-data";
import { PHYSIQUE_FRAME_INTERVALS, PhysiquePlaybackSpeed, type PhysiqueSpeed } from "../../../physique-playback-speed";

interface SharedPhysiqueFrame {
  day: string;
  src: string;
}

export interface SharedPhysiqueTrack {
  pose: PhysiquePose;
  frames: SharedPhysiqueFrame[];
}

const formatDay = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export function SharedPhysiquePlayer({ tracks }: { tracks: SharedPhysiqueTrack[] }) {
  const [trackIndex, setTrackIndex] = useState(0);
  const [speed, setSpeed] = useState<PhysiqueSpeed>(1);
  const track = tracks[trackIndex];

  return (
    <section className="card physique-player shared-physique-player" aria-label="Shared physique timelapse">
      <div className="physique-viewer-bar">
        <div className="physique-pill-toggle shared-physique-poses" role="group" aria-label="Shared poses">
          {tracks.map(({ pose }, index) => (
            <button key={pose} type="button" className={trackIndex === index ? "is-active" : ""}
              aria-pressed={trackIndex === index} onClick={() => setTrackIndex(index)}>{pose}</button>
          ))}
        </div>
        {track.frames.length > 1 && <PhysiquePlaybackSpeed speed={speed} onChange={setSpeed} />}
      </div>
      <PoseTimelapse key={track.pose} track={track} speed={speed} />
    </section>
  );
}

function PoseTimelapse({ track, speed }: { track: SharedPhysiqueTrack; speed: PhysiqueSpeed }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const { frames, pose } = track;
  const frame = frames[index];
  const nextFrame = frames[index + 1];
  const atEnd = index === frames.length - 1;
  const hasFailure = failedSrc != null && (failedSrc === frame.src || failedSrc === nextFrame?.src);

  useEffect(() => {
    if (!playing || atEnd || hasFailure) return;
    // Keep the current frame visible until the next image has loaded into the same stage.
    const imgs = stage.current?.querySelectorAll("img");
    if (!imgs || imgs.length !== 2 || [...imgs].some((img) => !img.complete || img.naturalWidth === 0)) return;
    const timer = window.setTimeout(() => {
      setIndex(index + 1);
      if (index + 1 === frames.length - 1) setPlaying(false);
    }, PHYSIQUE_FRAME_INTERVALS[speed]);
    return () => window.clearTimeout(timer);
  }, [atEnd, frames.length, hasFailure, index, loadVersion, playing, speed]);

  function togglePlayback() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (atEnd) setIndex(0);
    setPlaying(true);
  }

  const playLabel = playing ? "Pause timelapse" : atEnd ? "Replay timelapse" : "Play timelapse";
  const date = formatDay.format(new Date(`${frame.day}T12:00:00Z`));

  return (
    <>
      <div className="physique-stage shared-physique-stage" ref={stage}>
        {frames.slice(index, index + 2).map((photo, offset) => (
          <img key={`${photo.src}-${attempt}`} src={photo.src} className={offset === 0 ? undefined : "shared-physique-next"}
            alt={offset === 0 ? `${pose} progress photo, ${date}` : ""} aria-hidden={offset !== 0 || failedSrc === photo.src}
            onLoad={() => {
              setFailedSrc((failed) => failed === photo.src ? null : failed);
              setLoadVersion((version) => version + 1);
            }}
            onError={() => {
              setFailedSrc(photo.src);
              setPlaying(false);
            }} />
        ))}
        <div className="physique-overlay-pill num">
          <time dateTime={frame.day}>{date}</time>
          <span>· {index + 1} / {frames.length}</span>
        </div>
      </div>
      {frames.length > 1 && (
        <div className="shared-physique-controls">
          <button type="button" className="secondary compact" aria-label={playLabel} onClick={togglePlayback} disabled={hasFailure}>
            {playing ? <Pause size={16} aria-hidden="true" /> : atEnd ? <RotateCcw size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {playing ? "Pause" : atEnd ? "Replay" : "Play"}
          </button>
          <input type="range" min={0} max={frames.length - 1} value={index}
            aria-label="Timelapse frame" aria-valuetext={`Photo ${index + 1} of ${frames.length}, ${date}`}
            onChange={(event) => {
              setPlaying(false);
              setIndex(Number(event.target.value));
            }} />
        </div>
      )}
      {hasFailure && (
        <div className="split-row">
          <p className="metric-provenance" role="status">A photo couldn’t load.</p>
          <button type="button" className="secondary compact" onClick={() => {
            setFailedSrc(null);
            setAttempt((value) => value + 1);
          }}>Retry photos</button>
        </div>
      )}
    </>
  );
}
