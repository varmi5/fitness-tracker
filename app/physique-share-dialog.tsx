"use client";

import { useEffect, useId, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, Copy, Share2, X } from "lucide-react";
import { PHYSIQUE_POSES, type PhysiqueCheckinRecord, type PhysiquePose } from "../lib/physique-data";
import type { PhysiqueShareLink } from "../lib/physique-share";

async function readShareResponse(response: Response): Promise<PhysiqueShareLink | null> {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.message ?? "Could not update sharing. Try again.");
  return payload.link;
}

export function PhysiqueShareDialog({ checkins }: { checkins: PhysiqueCheckinRecord[] }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<PhysiqueShareLink | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [excludedPoses, setExcludedPoses] = useState<PhysiquePose[]>([]);
  const [expandedPose, setExpandedPose] = useState<PhysiquePose | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const pickerId = useId();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch("/api/physique/share", { cache: "no-store", signal: controller.signal })
      .then(readShareResponse)
      .then((current) => {
        if (controller.signal.aborted) return;
        setLink(current);
        setSelected(current?.checkinIds ?? []);
        setReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load sharing. Close this sheet and try again.");
      });
    return () => controller.abort();
  }, [open]);

  const chosenIds = new Set(selected);
  const chosenPhotos = checkins.filter((item) => chosenIds.has(item.id) && !excludedPoses.includes(item.pose));
  const availableIds = chosenPhotos.map((item) => item.id);
  const poseCount = new Set(chosenPhotos.map((item) => item.pose)).size;
  const changed = link == null || availableIds.length !== link.checkinIds.length || availableIds.some((id) => !link.checkinIds.includes(id));
  const url = link && typeof window !== "undefined" ? `${window.location.origin}/share/physique/${link.token}` : "";

  function togglePose(pose: PhysiquePose, photos: PhysiqueCheckinRecord[], included: boolean) {
    if (included) {
      setExcludedPoses((poses) => [...poses, pose]);
      return;
    }
    setExcludedPoses((poses) => poses.filter((item) => item !== pose));
    if (!photos.some((item) => chosenIds.has(item.id))) {
      setSelected((ids) => [...ids, ...photos.map((item) => item.id)]);
    }
  }

  function togglePhoto(photo: PhysiqueCheckinRecord, photos: PhysiqueCheckinRecord[]) {
    if (excludedPoses.includes(photo.pose)) {
      const poseIds = new Set(photos.map((item) => item.id));
      setSelected((ids) => [...ids.filter((id) => !poseIds.has(id)), photo.id]);
      setExcludedPoses((poses) => poses.filter((pose) => pose !== photo.pose));
      return;
    }
    setSelected((ids) => ids.includes(photo.id) ? ids.filter((id) => id !== photo.id) : [...ids, photo.id]);
  }

  async function updateShare(action: "save" | "revoke") {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const response = await fetch("/api/physique/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, checkinIds: availableIds, currentToken: link?.token ?? null }),
      });
      const updated = await readShareResponse(response);
      setLink(updated);
      setSelected(updated?.checkinIds ?? []);
      setExcludedPoses([]);
      setNotice(updated ? "Link ready to share." : "Sharing stopped.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update sharing. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied.");
    } catch {
      setNotice("Select the link to copy it.");
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      if (busy) return;
      if (next) {
        setReady(false);
        setError(null);
        setNotice("");
        setExcludedPoses([]);
        setExpandedPose(null);
      }
      setOpen(next);
    }}>
      <Dialog.Trigger asChild>
        <button type="button" className="secondary compact physique-share-trigger"><Share2 size={16} aria-hidden="true" /> Share progress</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="quick-sheet-overlay" />
        <Dialog.Content className="quick-sheet quick-sheet-launcher physique-share-sheet">
          <div className="quick-sheet-header">
            <div className="split-row">
              <Dialog.Title>Share physique progress</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="secondary icon-btn" aria-label="Close sharing" disabled={busy}><X size={17} /></button>
              </Dialog.Close>
            </div>
            <Dialog.Description>Choose the poses and photos anyone with your link can play.</Dialog.Description>
          </div>
          <div className="quick-sheet-body">
            {ready ? checkins.length ? (
              <div className="physique-share-poses" role="group" aria-label="Poses to share">
                {PHYSIQUE_POSES.map((pose) => {
                  const photos = checkins.filter((item) => item.pose === pose);
                  if (!photos.length) return null;
                  const count = excludedPoses.includes(pose) ? 0 : photos.filter((item) => chosenIds.has(item.id)).length;
                  const expanded = expandedPose === pose;
                  const photoPickerId = `${pickerId}-${pose}`;
                  return (
                    <div className="physique-share-pose" key={pose}>
                      <div className="split-row">
                        <button type="button" className="secondary compact physique-share-include" aria-pressed={count > 0}
                          aria-label={`Include ${pose} pose`} onClick={() => togglePose(pose, photos, count > 0)} disabled={busy}>
                          <span className="physique-share-check" aria-hidden="true">{count > 0 && <Check size={15} />}</span>
                          {pose}
                        </button>
                        <button type="button" className="secondary compact physique-share-expand" aria-expanded={expanded}
                          aria-controls={photoPickerId} aria-label={`Choose ${pose} photos (${count} of ${photos.length} selected)`}
                          onClick={() => setExpandedPose(expanded ? null : pose)}>
                          Photos {count}/{photos.length} <ChevronDown size={15} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="physique-share-picker" id={photoPickerId} role="group" aria-label={`${pose} photos`} hidden={!expanded}>
                        {expanded && photos.map((item) => {
                          const checked = count > 0 && chosenIds.has(item.id);
                          return (
                            <button type="button" className="physique-share-photo" key={item.id} aria-pressed={checked} disabled={busy}
                              onClick={() => togglePhoto(item, photos)}>
                              <img src={item.photoData} alt="" loading="lazy" />
                              <span className="physique-share-check" aria-hidden="true">{checked && <Check size={15} />}</span>
                              <span>{item.day}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="empty">Add a physique check-in to share it.</p> : !error && <p className="empty" role="status">Loading sharing…</p>}
          </div>
          <div className="physique-share-footer">
            {error && <p className="metric-provenance" role="alert">{error}</p>}
            {ready && (
              <>
                <div className="split-row">
                  <span aria-live="polite">{poseCount} {poseCount === 1 ? "pose" : "poses"} · {availableIds.length} {availableIds.length === 1 ? "photo" : "photos"}</span>
                  <button type="button" className="compact" disabled={busy || !availableIds.length || !changed} onClick={() => void updateShare("save")}>
                    {link ? "Replace link" : "Create link"}
                  </button>
                </div>
                {link && (
                  <>
                    {changed && <p className="metric-provenance">Replacing the link turns off the current one.</p>}
                    <div className="physique-share-link">
                      <input aria-label="Share link" value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
                      <button type="button" className="secondary compact" onClick={() => void copyLink()} disabled={busy}><Copy size={15} aria-hidden="true" /> Copy</button>
                    </div>
                    <button type="button" className="secondary compact" onClick={() => void updateShare("revoke")} disabled={busy}>Stop sharing</button>
                  </>
                )}
                <p className="metric-provenance physique-share-notice" role="status">{notice}</p>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
