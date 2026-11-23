import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeCameraError,
  normalizeScannedBarcode,
  shouldAcceptScan,
  stopMediaStream,
  SUPPORTED_BARCODE_FORMATS,
} from "../lib/barcode-scanner";

test("barcode scanner normalizes valid EAN/UPC barcodes and rejects invalid input", () => {
  assert.deepEqual([...SUPPORTED_BARCODE_FORMATS], ["ean_13", "ean_8", "upc_a", "upc_e"]);
  assert.equal(normalizeScannedBarcode(" 5000112637922 "), "5000112637922");
  assert.equal(normalizeScannedBarcode("12345678"), "12345678");
  assert.equal(normalizeScannedBarcode("1234567"), null);
  assert.equal(normalizeScannedBarcode("abc12345678"), null);
  assert.equal(normalizeScannedBarcode(null), null);
});

test("shouldAcceptScan suppresses duplicate scans within cooldown window", () => {
  assert.equal(shouldAcceptScan(null, 0, "5000112637922", 1000), true);
  assert.equal(shouldAcceptScan("5000112637922", 1000, "5000112637922", 2000, 2500), false);
  assert.equal(shouldAcceptScan("5000112637922", 1000, "5000112637922", 3600, 2500), true);
  assert.equal(shouldAcceptScan("5000112637922", 1000, "123456789012", 1500, 2500), true);
});

test("stopMediaStream stops every track safely and describeCameraError explains permissions", () => {
  let stopped = 0;
  stopMediaStream({
    getTracks: () => [
      { stop: () => { stopped += 1; } },
      { stop: () => { stopped += 1; } },
    ],
  });
  assert.equal(stopped, 2);
  stopMediaStream(null);

  const denied = new Error("Permission denied");
  denied.name = "NotAllowedError";
  assert.match(describeCameraError(denied), /permission was denied/i);

  const missing = new Error("No camera");
  missing.name = "NotFoundError";
  assert.match(describeCameraError(missing), /no camera was found/i);
});
