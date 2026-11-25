"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, Pause, Play, Plus, Trash2 } from "lucide-react";
import { extractPhotoDate, orderPhysiqueFrames } from "../lib/photo-date";
import { PHYSIQUE_POSES, type PhysiqueCadence, type PhysiqueCheckinRecord, type PhysiquePose } from "../lib/physique-data";

interface PhysiqueCheckinViewProps {
  today: string;
  latestWeight: number | null;
  latestBodyFat: number | null;
  onBack: () => void;
  onMessage: (msg: string) => void;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read image."));
    };
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unsupported image format. Try JPEG, PNG, or WebP."));
    img.src = dataUrl;
  });
}

async function compressPhoto(file: File): Promise<string> {
  const attempts = [
    { maxDim: 960, q: 0.78 },
    { maxDim: 840, q: 0.66 },
    { maxDim: 720, q: 0.54 },
    { maxDim: 600, q: 0.44 },
  ];

  let bitmap: ImageBitmap | null = null;
  let fallbackImg: HTMLImageElement | null = null;
  try {
    let srcW = 0;
    let srcH = 0;
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(file);
        srcW = bitmap.width;
        srcH = bitmap.height;
      } catch {
        bitmap = null;
      }
    }
    if (!bitmap) {
      fallbackImg = await loadImageElement(file);
      srcW = fallbackImg.naturalWidth || fallbackImg.width;
      srcH = fallbackImg.naturalHeight || fallbackImg.height;
    }

    const source: CanvasImageSource = bitmap ?? fallbackImg!;
    for (const { maxDim, q } of attempts) {
      const scale = Math.min(1, maxDim / Math.max(srcW, srcH, 1));
      const width = Math.max(1, Math.round(srcW * scale));
      const height = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable.");
      ctx.drawImage(source, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", q);
      if (dataUrl.length <= 850_000) return dataUrl;
    }
    throw new Error("Photo is still too large after compression. Try a smaller image.");
  } finally {
    bitmap?.close();
  }
}

const SPEED_INTERVAL_MS: Record<0.5 | 1 | 2, number> = {
  0.5: 1600,
  1: 800,
  2: 350,
};

export function PhysiqueCheckinView({
  today,
  latestWeight,
  latestBodyFat,
  onBack,
  onMessage,
}: PhysiqueCheckinViewProps) {
  const [checkins, setCheckins] = useState<PhysiqueCheckinRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [poseFilter, setPoseFilter] = useState<PhysiquePose>("front");
  const [viewCadence, setViewCadence] = useState<PhysiqueCadence>("weekly");
  const [showUpload, setShowUpload] = useState(false);

  // Upload form state
  const [day, setDay] = useState(today);
  const [dateSource, setDateSource] = useState<"exif" | "file" | null>(null);
  const [uploadPose, setUploadPose] = useState<PhysiquePose>("front");
  const [photoData, setPhotoData] = useState<string>("");
  const [weightKg, setWeightKg] = useState(latestWeight != null ? latestWeight.toFixed(1) : "");
  const [bodyFatPct, setBodyFatPct] = useState(latestBodyFat != null ? latestBodyFat.toFixed(1) : "");
  const [note, setNote] = useState("");
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);

  // Timelapse player state
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch("/api/physique", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { checkins: PhysiqueCheckinRecord[] }) : null))
      .then((payload) => {
        if (active && payload?.checkins) setCheckins(payload.checkins);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredNewest = useMemo(
    () =>
      checkins
        .filter((c) => c.pose === poseFilter)
        .sort((a, b) => b.day.localeCompare(a.day) || b.createdAt.localeCompare(a.createdAt)),
    [checkins, poseFilter],
  );
  const timelapseFrames = useMemo(
    () => orderPhysiqueFrames(checkins, poseFilter, viewCadence),
    [checkins, poseFilter, viewCadence],
  );

  useEffect(() => {
    setFrameIndex(0);
    setPlaying(false);
  }, [poseFilter]);

  useEffect(() => {
    setFrameIndex((i) => (timelapseFrames.length > 0 ? Math.min(i, timelapseFrames.length - 1) : 0));
    if (timelapseFrames.length < 2) {
      setPlaying(false);
    }
  }, [timelapseFrames.length]);

  useEffect(() => {
    if (!playing || timelapseFrames.length < 2) return;
    const ms = SPEED_INTERVAL_MS[speed];
    const id = window.setInterval(() => {
      setFrameIndex((i) => (i + 1) % timelapseFrames.length);
    }, ms);
    return () => window.clearInterval(id);
  }, [playing, speed, timelapseFrames.length]);

  function handleToggleAdd() {
    if (!showUpload) {
      setUploadPose(poseFilter);
      if (!photoData) {
        setDay(today);
        setDateSource(null);
      }
      setShowUpload(true);
    } else {
      setShowUpload(false);
    }
  }

  async function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProcessingPhoto(true);
    try {
      const [compressed, extracted] = await Promise.all([
        compressPhoto(file),
        extractPhotoDate(file, today),
      ]);
      setPhotoData(compressed);
      if (extracted?.day) {
        setDay(extracted.day);
        setDateSource(extracted.source);
      } else {
        setDateSource(null);
      }
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Could not process image file.");
    } finally {
      setProcessingPhoto(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!photoData) {
      onMessage("Choose a check-in photo first.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/physique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          data: {
            day,
            pose: uploadPose,
            cadence: viewCadence,
            photoData,
            weightKg: weightKg ? Number(weightKg) : null,
            bodyFatPct: bodyFatPct ? Number(bodyFatPct) : null,
            note,
          },
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Could not save check-in.");
      setCheckins((prev) => [payload.checkin, ...prev]);
      setPoseFilter(uploadPose);
      setPhotoData("");
      setDateSource(null);
      setDay(today);
      setNote("");
      setShowUpload(false);
      onMessage("Physique check-in saved.");
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Could not save check-in.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this check-in photo?")) return;
    const res = await fetch("/api/physique", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    if (res.ok) {
      setCheckins((prev) => prev.filter((c) => c.id !== id));
      onMessage("Check-in deleted.");
    }
  }

  function handleSelectThumbnail(id: string) {
    const idx = timelapseFrames.findIndex((f) => f.id === id);
    if (idx >= 0) {
      setPlaying(false);
      setFrameIndex(idx);
    } else {
      const dailyFrames = orderPhysiqueFrames(checkins, poseFilter, "daily");
      const dailyIdx = dailyFrames.findIndex((f) => f.id === id);
      if (dailyIdx >= 0) {
        setViewCadence("daily");
        setPlaying(false);
        setFrameIndex(dailyIdx);
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const safeFrameIndex = timelapseFrames.length > 0 ? Math.min(frameIndex, timelapseFrames.length - 1) : 0;
  const activeFrame = timelapseFrames[safeFrameIndex];

  return (
    <>
      <div className="page-header sticky-subpage-header" style={{ marginBottom: ".1rem" }}>
        <button type="button" className="secondary compact" onClick={onBack} style={{ minHeight: "36px" }}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 style={{ fontSize: "1.12rem", margin: 0, flex: 1, textAlign: "center" }}>Physique</h1>
        <div className="physique-header-actions">
          <select
            className="physique-pose-select"
            aria-label="Filter pose"
            value={poseFilter}
            onChange={(e) => setPoseFilter(e.target.value as PhysiquePose)}
          >
            {PHYSIQUE_POSES.map((pose) => (
              <option key={pose} value={pose}>
                {pose.charAt(0).toUpperCase() + pose.slice(1)}
              </option>
            ))}
          </select>
          <button type="button" className="compact" onClick={handleToggleAdd} style={{ minHeight: "36px" }}>
            <Plus size={15} /> Add
          </button>
        </div>
      </div>

      {showUpload && (
        <form className="card" onSubmit={(e) => void handleSubmit(e)}>
          <div className="split-row">
            <h2>New check-in</h2>
            <button type="button" className="secondary compact" onClick={() => setShowUpload(false)}>Cancel</button>
          </div>
          <label>
            Photo
            <input type="file" accept="image/*" onChange={(e) => void handleFileSelect(e)} />
          </label>
          {photoData && (
            <img
              src={photoData}
              alt="Check-in preview"
              style={{
                width: "100%",
                maxHeight: 280,
                objectFit: "contain",
                borderRadius: 16,
                background: "#14161f",
              }}
            />
          )}
          <div className="input-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <label>
              Date
              <input
                type="date"
                value={day}
                max={today}
                onChange={(e) => {
                  setDay(e.target.value);
                  setDateSource(null);
                }}
                required
              />
              {dateSource && (
                <small style={{ color: "var(--muted)", fontSize: ".7rem" }}>
                  {dateSource === "exif" ? "Date auto-filled from photo EXIF" : "Date auto-filled from file"}
                </small>
              )}
            </label>
            <label>
              Pose
              <select value={uploadPose} onChange={(e) => setUploadPose(e.target.value as PhysiquePose)}>
                <option value="front">Front</option>
                <option value="side">Side</option>
                <option value="back">Back</option>
              </select>
            </label>
            <label>
              Weight (kg)
              <input inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="Auto" />
            </label>
            <label>
              Body Fat (%)
              <input inputMode="decimal" value={bodyFatPct} onChange={(e) => setBodyFatPct(e.target.value)} placeholder="Auto" />
            </label>
          </div>
          <label>
            Note
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lighting, fasted, pump…" />
          </label>
          <button type="submit" disabled={saving || processingPhoto || !photoData}>
            {processingPhoto ? "Processing photo…" : saving ? "Saving…" : "Save Check-in"}
          </button>
        </form>
      )}

      {/* Photo & Timelapse Viewer */}
      {timelapseFrames.length >= 1 && activeFrame && (
        <section className="card physique-player" aria-label="Physique timelapse">
          <div className="physique-viewer-bar">
            <div className="physique-pill-toggle" role="group" aria-label="Timelapse cadence">
              {(["weekly", "daily"] as PhysiqueCadence[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={viewCadence === c}
                  className={viewCadence === c ? "is-active" : ""}
                  onClick={() => setViewCadence(c)}
                  style={{ textTransform: "capitalize" }}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="physique-pill-toggle" role="group" aria-label="Playback speed">
              {([0.5, 1, 2] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={speed === s}
                  className={speed === s ? "is-active" : ""}
                  onClick={() => setSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
          <div className="physique-stage">
            <img src={activeFrame.photoData} alt={`Physique ${activeFrame.day}`} />
            <div className="physique-overlay-pill num">
              <span>{activeFrame.day}</span>
              {activeFrame.weightKg != null && <span>· {activeFrame.weightKg.toFixed(1)} kg</span>}
              {activeFrame.bodyFatPct != null && <span>· {activeFrame.bodyFatPct.toFixed(1)}%</span>}
            </div>
          </div>
          {timelapseFrames.length >= 2 && (
            <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
              <button
                type="button"
                className="secondary icon-btn"
                aria-label={playing ? "Pause timelapse" : "Play timelapse"}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <input
                type="range"
                aria-label="Timelapse frame"
                min={0}
                max={timelapseFrames.length - 1}
                value={safeFrameIndex}
                onChange={(e) => {
                  setPlaying(false);
                  setFrameIndex(Number(e.target.value));
                }}
                style={{ flex: 1, boxShadow: "none" }}
              />
            </div>
          )}
        </section>
      )}

      {loading ? (
        <p className="empty">Loading check-ins…</p>
      ) : filteredNewest.length === 0 ? (
        <section className="card">
          <p className="empty">
            No {poseFilter} check-in photos yet. Tap <strong>+ Add</strong> to capture your first progress shot.
          </p>
        </section>
      ) : (
        <div className="physique-grid">
          {filteredNewest.map((item) => (
            <article key={item.id} className="card physique-card">
              <button
                type="button"
                className="physique-card-thumb"
                aria-label={`View ${item.pose} check-in from ${item.day}`}
                onClick={() => handleSelectThumbnail(item.id)}
              >
                <img src={item.photoData} alt={`${item.pose} check-in ${item.day}`} />
              </button>
              <div className="split-row" style={{ marginTop: ".4rem" }}>
                <div>
                  <strong className="num" style={{ fontSize: ".82rem" }}>{item.day}</strong>
                  <div className="num" style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                    {item.weightKg != null ? `${item.weightKg.toFixed(1)} kg` : "—"}
                    {item.bodyFatPct != null ? ` · ${item.bodyFatPct.toFixed(1)}% BF` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary icon-btn"
                  style={{ width: 34, minWidth: 34, height: 34, minHeight: 34 }}
                  aria-label={`Delete check-in ${item.day}`}
                  onClick={() => void handleDelete(item.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
