"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, Pause, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { extractPhotoDate, orderPhysiqueFrames } from "../lib/photo-date";
import { PHYSIQUE_POSES, type PhysiqueCadence, type PhysiqueCheckinRecord, type PhysiquePose } from "../lib/physique-data";

interface PhysiqueCheckinViewProps {
  today: string;
  latestWeight?: number | null;
  latestBodyFat?: number | null;
  onBack: () => void;
  onMessage: (msg: string) => void;
}

interface PendingUpload {
  localId: string;
  fileName: string;
  photoData: string;
  day: string;
  dateSource: "exif" | "file" | null;
  pose: PhysiquePose;
  weightKg: string;
  note: string;
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

function parseOptionalWeight(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0 || num > 400) return "invalid";
  return num;
}

export function PhysiqueCheckinView({
  today,
  onBack,
  onMessage,
}: PhysiqueCheckinViewProps) {
  const [checkins, setCheckins] = useState<PhysiqueCheckinRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [poseFilter, setPoseFilter] = useState<PhysiquePose>("front");
  const [viewCadence, setViewCadence] = useState<PhysiqueCadence>("weekly");
  const [showUpload, setShowUpload] = useState(false);

  // Batch upload form state
  const [uploadPose, setUploadPose] = useState<PhysiquePose>("front");
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [savingProgress, setSavingProgress] = useState<{ done: number; total: number } | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDay, setEditDay] = useState(today);
  const [editPose, setEditPose] = useState<PhysiquePose>("front");
  const [editWeightKg, setEditWeightKg] = useState("");
  const [editNote, setEditNote] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

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
      setShowUpload(true);
    } else {
      setShowUpload(false);
    }
  }

  function handleUploadPoseChange(nextPose: PhysiquePose) {
    setUploadPose(nextPose);
    setPendingUploads((prev) => prev.map((item) => ({ ...item, pose: nextPose })));
  }

  function updatePendingItem(localId: string, patch: Partial<PendingUpload>) {
    setPendingUploads((prev) => prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item)));
  }

  function removePendingItem(localId: string) {
    setPendingUploads((prev) => prev.filter((item) => item.localId !== localId));
  }

  async function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setProcessingPhoto(true);
    try {
      for (const file of files) {
        try {
          const [compressed, extracted] = await Promise.all([
            compressPhoto(file),
            extractPhotoDate(file, today),
          ]);
          const nextItem: PendingUpload = {
            localId:
              typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            fileName: file.name,
            photoData: compressed,
            day: extracted?.day ?? today,
            dateSource: extracted?.source ?? null,
            pose: uploadPose,
            weightKg: "",
            note: "",
          };
          setPendingUploads((prev) => [...prev, nextItem]);
        } catch (err) {
          onMessage(
            `${file.name}: ${err instanceof Error ? err.message : "Could not process image file."}`,
          );
        }
      }
    } finally {
      setProcessingPhoto(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pendingUploads.length === 0) {
      onMessage("Choose at least one check-in photo first.");
      return;
    }

    const snapshot = [...pendingUploads];
    for (const item of snapshot) {
      if (!item.day) {
        onMessage(`Set a date for ${item.fileName || "each photo"}.`);
        return;
      }
      if (parseOptionalWeight(item.weightKg) === "invalid") {
        onMessage(`Enter a valid weight (kg) or leave it blank for ${item.day}.`);
        return;
      }
    }

    setSavingProgress({ done: 0, total: snapshot.length });
    const savedPoses: PhysiquePose[] = [];
    let savedCount = 0;

    try {
      for (let idx = 0; idx < snapshot.length; idx++) {
        const item = snapshot[idx];
        const parsedWeight = parseOptionalWeight(item.weightKg);
        const res = await fetch("/api/physique", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            data: {
              day: item.day,
              pose: item.pose,
              cadence: viewCadence,
              photoData: item.photoData,
              weightKg: parsedWeight === "invalid" ? null : parsedWeight,
              note: item.note,
            },
          }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.message ?? "Could not save check-in.");

        setCheckins((prev) => [payload.checkin, ...prev]);
        setPendingUploads((prev) => prev.filter((p) => p.localId !== item.localId));
        savedPoses.push(item.pose);
        savedCount++;
        setSavingProgress({ done: idx + 1, total: snapshot.length });
      }

      if (savedPoses.length > 0) {
        setPoseFilter(savedPoses[0]);
      }
      setShowUpload(false);
      onMessage(savedCount === 1 ? "Physique check-in saved." : `Saved ${savedCount} check-ins.`);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Could not save check-in.");
    } finally {
      setSavingProgress(null);
    }
  }

  function startEdit(item: PhysiqueCheckinRecord) {
    setEditingId(item.id);
    setEditDay(item.day);
    setEditPose(item.pose);
    setEditWeightKg(item.weightKg != null ? String(item.weightKg) : "");
    setEditNote(item.note);
  }

  async function handleSaveEdit(e: FormEvent, id: string) {
    e.preventDefault();
    const parsedWeight = parseOptionalWeight(editWeightKg);
    if (parsedWeight === "invalid") {
      onMessage("Enter a valid weight in kg or leave it blank.");
      return;
    }

    setSavingEdit(true);
    try {
      const res = await fetch("/api/physique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id,
          data: {
            day: editDay,
            pose: editPose,
            weightKg: parsedWeight,
            note: editNote,
          },
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Could not update check-in.");
      setCheckins((prev) => prev.map((c) => (c.id === id ? payload.checkin : c)));
      setEditingId(null);
      if (editPose !== poseFilter) {
        setPoseFilter(editPose);
      }
      onMessage("Check-in updated.");
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Could not update check-in.");
    } finally {
      setSavingEdit(false);
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
      if (editingId === id) setEditingId(null);
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
            <h2>Add check-ins</h2>
            <button
              type="button"
              className="secondary compact"
              onClick={() => setShowUpload(false)}
              disabled={savingProgress != null}
            >
              Cancel
            </button>
          </div>
          <div className="input-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <label>
              Pose
              <select
                value={uploadPose}
                onChange={(e) => handleUploadPoseChange(e.target.value as PhysiquePose)}
                disabled={savingProgress != null}
              >
                <option value="front">Front</option>
                <option value="side">Side</option>
                <option value="back">Back</option>
              </select>
            </label>
            <label>
              Photos
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => void handleFileSelect(e)}
                disabled={savingProgress != null}
              />
            </label>
          </div>

          {pendingUploads.length > 0 && (
            <div className="physique-upload-list">
              {pendingUploads.map((item) => (
                <div key={item.localId} className="physique-upload-item">
                  <div className="physique-upload-head">
                    <img
                      src={item.photoData}
                      alt={item.fileName || `Queued ${item.pose} check-in`}
                      className="physique-upload-thumb"
                    />
                    <div style={{ flex: 1, minWidth: 0, display: "grid", gap: ".35rem" }}>
                      <label style={{ margin: 0 }}>
                        Date
                        <input
                          type="date"
                          value={item.day}
                          max={today}
                          onChange={(e) =>
                            updatePendingItem(item.localId, { day: e.target.value, dateSource: null })
                          }
                          required
                        />
                        <small style={{ color: "var(--muted)", fontSize: ".68rem" }}>
                          {item.dateSource === "exif"
                            ? "Auto-filled from photo EXIF"
                            : item.dateSource === "file"
                              ? "Auto-filled from file date"
                              : "Confirm photo date"}
                        </small>
                      </label>
                      <div className="input-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                        <label style={{ margin: 0 }}>
                          Pose
                          <select
                            value={item.pose}
                            onChange={(e) =>
                              updatePendingItem(item.localId, { pose: e.target.value as PhysiquePose })
                            }
                          >
                            <option value="front">Front</option>
                            <option value="side">Side</option>
                            <option value="back">Back</option>
                          </select>
                        </label>
                        <label style={{ margin: 0 }}>
                          Weight (kg)
                          <input
                            inputMode="decimal"
                            value={item.weightKg}
                            onChange={(e) =>
                              updatePendingItem(item.localId, { weightKg: e.target.value })
                            }
                            placeholder="Optional"
                          />
                        </label>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="secondary icon-btn"
                      style={{ width: 32, minWidth: 32, height: 32, minHeight: 32 }}
                      aria-label={`Remove ${item.fileName || "photo"}`}
                      onClick={() => removePendingItem(item.localId)}
                      disabled={savingProgress != null}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={item.note}
                    onChange={(e) => updatePendingItem(item.localId, { note: e.target.value })}
                    placeholder="Note (optional: lighting, fasted, pump…)"
                  />
                </div>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={savingProgress != null || processingPhoto || pendingUploads.length === 0}
          >
            {processingPhoto
              ? "Processing photos…"
              : savingProgress != null
                ? `Saving ${savingProgress.done} / ${savingProgress.total}…`
                : pendingUploads.length > 1
                  ? `Save ${pendingUploads.length} Check-ins`
                  : "Save Check-in"}
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
          {filteredNewest.map((item) => {
            const isEditing = editingId === item.id;
            return (
              <article key={item.id} className={`card physique-card${isEditing ? " is-editing" : ""}`}>
                <button
                  type="button"
                  className="physique-card-thumb"
                  aria-label={`View ${item.pose} check-in from ${item.day}`}
                  onClick={() => handleSelectThumbnail(item.id)}
                >
                  <img src={item.photoData} alt={`${item.pose} check-in ${item.day}`} />
                </button>

                {isEditing ? (
                  <form className="physique-edit-form" onSubmit={(e) => void handleSaveEdit(e, item.id)}>
                    <label>
                      Date
                      <input
                        type="date"
                        value={editDay}
                        max={today}
                        onChange={(e) => setEditDay(e.target.value)}
                        required
                      />
                    </label>
                    <div className="input-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                      <label>
                        Pose
                        <select value={editPose} onChange={(e) => setEditPose(e.target.value as PhysiquePose)}>
                          <option value="front">Front</option>
                          <option value="side">Side</option>
                          <option value="back">Back</option>
                        </select>
                      </label>
                      <label>
                        Weight (kg)
                        <input
                          inputMode="decimal"
                          value={editWeightKg}
                          onChange={(e) => setEditWeightKg(e.target.value)}
                          placeholder="Optional"
                        />
                      </label>
                    </div>
                    <label>
                      Note
                      <input
                        type="text"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder="Optional"
                      />
                    </label>
                    <div style={{ display: "flex", gap: ".45rem" }}>
                      <button type="submit" className="compact" style={{ flex: 1 }} disabled={savingEdit}>
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="secondary compact"
                        onClick={() => setEditingId(null)}
                        disabled={savingEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="split-row" style={{ marginTop: ".4rem", alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <strong className="num" style={{ fontSize: ".82rem" }}>{item.day}</strong>
                      {item.weightKg != null && (
                        <div className="num" style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                          {item.weightKg.toFixed(1)} kg
                        </div>
                      )}
                      {item.note && (
                        <div
                          style={{
                            fontSize: ".7rem",
                            color: "var(--muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.note}
                        </div>
                      )}
                    </div>
                    <div className="physique-card-actions">
                      <button
                        type="button"
                        className="secondary icon-btn"
                        style={{ width: 32, minWidth: 32, height: 32, minHeight: 32 }}
                        aria-label={`Edit check-in ${item.day}`}
                        onClick={() => startEdit(item)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="secondary icon-btn"
                        style={{ width: 32, minWidth: 32, height: 32, minHeight: 32 }}
                        aria-label={`Delete check-in ${item.day}`}
                        onClick={() => void handleDelete(item.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
