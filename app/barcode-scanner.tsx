"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import {
  describeCameraError,
  normalizeScannedBarcode,
  shouldAcceptScan,
  stopMediaStream,
  SUPPORTED_BARCODE_FORMATS,
} from "../lib/barcode-scanner";

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue?: string }[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScanRef = useRef<{ code: string | null; at: number }>({ code: null, at: 0 });
  const detectedLockRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [errorText, setErrorText] = useState("");
  const [engineLabel, setEngineLabel] = useState<"Native" | "ZXing" | "">("");

  useEffect(() => {
    let active = true;
    let rafId = 0;
    let zxingControls: { stop: () => void } | null = null;

    const handleCode = (raw: string | null | undefined) => {
      if (!active || detectedLockRef.current) return;
      const code = normalizeScannedBarcode(raw);
      if (!code) return;
      const now = Date.now();
      if (!shouldAcceptScan(lastScanRef.current.code, lastScanRef.current.at, code, now)) return;
      lastScanRef.current = { code, at: now };
      detectedLockRef.current = true;
      onDetectedRef.current(code);
    };

    const startScanner = async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (active) {
          setStatus("error");
          setErrorText("Live camera access is not supported in this browser. Enter the barcode manually below.");
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (!active) {
          stopMediaStream(stream);
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          stopMediaStream(stream);
          return;
        }
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (!active) {
          stopMediaStream(stream);
          return;
        }

        const NativeDetector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        let useNative = false;
        if (NativeDetector) {
          try {
            const supported = NativeDetector.getSupportedFormats
              ? await NativeDetector.getSupportedFormats()
              : [...SUPPORTED_BARCODE_FORMATS];
            useNative = SUPPORTED_BARCODE_FORMATS.some((fmt) => supported.includes(fmt));
          } catch {
            useNative = false;
          }
        }

        if (useNative && NativeDetector) {
          setEngineLabel("Native");
          setStatus("scanning");
          const formats = SUPPORTED_BARCODE_FORMATS;
          const detector = new NativeDetector({ formats });
          let busyFrame = false;

          const tick = () => {
            if (!active || detectedLockRef.current) return;
            if (!busyFrame && video.readyState >= 2) {
              busyFrame = true;
              void detector
                .detect(video)
                .then((codes) => {
                  if (!active || detectedLockRef.current) return;
                  for (const item of codes) {
                    if (item.rawValue) {
                      handleCode(item.rawValue);
                      break;
                    }
                  }
                })
                .catch(() => undefined)
                .finally(() => {
                  busyFrame = false;
                });
            }
            rafId = window.requestAnimationFrame(tick);
          };
          rafId = window.requestAnimationFrame(tick);
          return;
        }

        // Fallback to ZXing for browsers without BarcodeDetector (e.g., iOS Safari / Firefox)
        setEngineLabel("ZXing");
        setStatus("scanning");
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (!active || detectedLockRef.current) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ]);
        const reader = new BrowserMultiFormatReader(hints);
        zxingControls = await reader.decodeFromStream(stream, video, (result) => {
          if (!active || detectedLockRef.current) return;
          if (result) {
            handleCode(result.getText());
          }
        });
      } catch (err) {
        if (!active) return;
        setStatus("error");
        setErrorText(describeCameraError(err));
      }
    };

    void startScanner();

    return () => {
      active = false;
      if (rafId) window.cancelAnimationFrame(rafId);
      try {
        zxingControls?.stop();
      } catch {
        // ignore stop errors
      }
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  return (
    <div className="scanner-panel" role="region" aria-label="Camera barcode scanner">
      <div className="split-row" style={{ marginBottom: ".45rem" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".35rem", fontWeight: 620, fontSize: ".86rem" }}>
          <Camera size={16} aria-hidden="true" />
          {status === "starting"
            ? "Starting camera…"
            : status === "scanning"
              ? `Point at food barcode${engineLabel ? ` (${engineLabel})` : ""}`
              : "Camera unavailable"}
        </span>
        <button
          type="button"
          className="secondary compact"
          aria-label="Close camera scanner"
          onClick={onClose}
        >
          <X size={15} /> Close
        </button>
      </div>

      {status === "error" ? (
        <p className="scanner-error" role="alert">
          {errorText}
        </p>
      ) : (
        <div className="scanner-viewport">
          <video
            ref={videoRef}
            className="scanner-video"
            playsInline
            muted
            autoPlay
          />
          <div className="scanner-guide" aria-hidden="true">
            <span />
          </div>
        </div>
      )}
    </div>
  );
}
