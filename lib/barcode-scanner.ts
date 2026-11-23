export const SUPPORTED_BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

export function normalizeScannedBarcode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, "");
  return /^\d{8,14}$/.test(cleaned) ? cleaned : null;
}

export function shouldAcceptScan(
  lastCode: string | null,
  lastScannedAt: number,
  nextCode: string,
  now: number,
  cooldownMs = 2500,
): boolean {
  if (!nextCode) return false;
  if (lastCode === nextCode && now - lastScannedAt < cooldownMs) return false;
  return true;
}

export function stopMediaStream(
  stream: { getTracks?: () => { stop: () => void }[] } | null | undefined,
): void {
  if (!stream || typeof stream.getTracks !== "function") return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore already-stopped tracks
    }
  }
}

export function describeCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied. Allow camera access in your browser settings or enter the barcode manually.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device. Enter the barcode manually below.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Camera is currently in use by another app. Close it and try again, or enter the barcode manually.";
  }
  if (name === "OverconstrainedError") {
    return "Could not open the rear camera. Try again or enter the barcode manually.";
  }
  return err instanceof Error && err.message
    ? err.message
    : "Camera scanning is unavailable on this device. Enter the barcode manually.";
}
