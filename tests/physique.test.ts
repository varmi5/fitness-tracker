import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createPhysiqueInput, physiqueData } from "../lib/physique-data";
import { extractExifDateFromBuffer, isoWeekKey, orderPhysiqueFrames } from "../lib/photo-date";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

const SAMPLE_DATA_URL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

before(async () => {
  for (const migration of [
    "001-auth.sql",
    "002-tracker.sql",
    "004-nutrition-health.sql",
    "011-sleep-and-active-day.sql",
    "012-tracking-mode-and-fitbit-metrics.sql",
    "019-physique-checkins.sql",
  ]) {
    await pg.exec(await readFile(`migrations/${migration}`, "utf8"));
  }
  await db.insert(schema.user).values(
    ["A", "B"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
});

after(async () => pg.close());

test("physique check-ins auto-fill weight/body-fat, filter by pose, and enforce user isolation", async () => {
  const a = physiqueData(db, "A");
  const b = physiqueData(db, "B");

  await db.insert(schema.measurement).values({
    id: "m1",
    userId: "A",
    metric: "weight",
    side: "none",
    value: 71.9,
    date: "2026-11-23",
    note: "",
  });
  await db.insert(schema.dailyRecovery).values({
    userId: "A",
    day: "2026-11-24",
    source: "google",
    bodyFatPct: 22.6,
  });

  const front = await a.create({
    day: "2026-11-24",
    pose: "front",
    cadence: "weekly",
    photoData: SAMPLE_DATA_URL,
    note: "Morning fasted",
  });
  assert.equal(front.weightKg, 71.9);
  assert.equal(front.bodyFatPct, 22.6);
  assert.equal(front.pose, "front");

  const side = await a.create({
    day: "2026-11-24",
    pose: "side",
    cadence: "daily",
    photoData: SAMPLE_DATA_URL,
    weightKg: 72.1,
    bodyFatPct: 22.4,
    note: "",
  });
  assert.equal(side.weightKg, 72.1);

  assert.equal((await a.list()).length, 2);
  assert.equal((await a.list("front")).length, 1);
  assert.equal((await b.list()).length, 0);

  // User B cannot delete User A's check-in
  assert.deepEqual(await b.remove(front.id), { deleted: false });
  assert.deepEqual(await a.remove(front.id), { deleted: true });
  assert.equal((await a.list()).length, 1);
});

test("physique validation rejects non-image data URLs", () => {
  assert.equal(
    createPhysiqueInput.safeParse({
      day: "2026-11-24",
      pose: "front",
      cadence: "weekly",
      photoData: "https://example.com/photo.jpg",
    }).success,
    false,
  );
});

function buildSyntheticExifJpeg(exifDate: string, endian: "II" | "MM"): ArrayBuffer {
  const little = endian === "II";
  // TIFF block:
  // 0..7   : TIFF header (endian, 42, IFD0 offset = 8)
  // 8..21  : IFD0 (1 entry: tag 0x8769 ExifIFDPointer -> offset 22)
  // 22..35 : ExifIFD (1 entry: tag 0x9003 DateTimeOriginal ASCII[20] -> offset 36)
  // 36..55 : "YYYY:MM:DD HH:MM:SS\0"
  const tiffLen = 56;
  const totalLen = 2 + 4 + 6 + tiffLen; // SOI (2) + APP1 marker/len (4) + "Exif\0\0" (6) + TIFF
  const buf = new ArrayBuffer(totalLen);
  const u8 = new Uint8Array(buf);
  const view = new DataView(buf);

  // JPEG SOI + APP1
  view.setUint16(0, 0xffd8, false);
  view.setUint16(2, 0xffe1, false);
  view.setUint16(4, 2 + 6 + tiffLen, false);
  u8.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // "Exif\0\0"

  const tiffStart = 12;
  view.setUint16(tiffStart, little ? 0x4949 : 0x4d4d, false);
  view.setUint16(tiffStart + 2, 42, little);
  view.setUint32(tiffStart + 4, 8, little); // IFD0 offset

  // IFD0 at tiffStart + 8
  view.setUint16(tiffStart + 8, 1, little);
  view.setUint16(tiffStart + 10, 0x8769, little); // ExifIFDPointer
  view.setUint16(tiffStart + 12, 4, little); // LONG
  view.setUint32(tiffStart + 14, 1, little);
  view.setUint32(tiffStart + 18, 22, little); // ExifIFD relative offset

  // ExifIFD at tiffStart + 22
  view.setUint16(tiffStart + 22, 1, little);
  view.setUint16(tiffStart + 24, 0x9003, little); // DateTimeOriginal
  view.setUint16(tiffStart + 26, 2, little); // ASCII
  view.setUint32(tiffStart + 28, 20, little);
  view.setUint32(tiffStart + 32, 36, little); // String relative offset

  const padded = `${exifDate}\0`.slice(0, 20);
  for (let i = 0; i < padded.length; i++) {
    u8[tiffStart + 36 + i] = padded.charCodeAt(i);
  }
  return buf;
}

test("extractExifDateFromBuffer parses little-endian, big-endian, and XMP photo capture dates", () => {
  const le = buildSyntheticExifJpeg("2025:08:19 07:42:11", "II");
  const be = buildSyntheticExifJpeg("2024:12:03 18:05:44", "MM");
  assert.equal(extractExifDateFromBuffer(le), "2025-08-19");
  assert.equal(extractExifDateFromBuffer(be), "2024-12-03");

  const xmpBytes = new TextEncoder().encode('<x:xmpmeta xmp:CreateDate="2026-03-14T08:12:00Z" />');
  assert.equal(extractExifDateFromBuffer(xmpBytes.buffer), "2026-03-14");
});

test("orderPhysiqueFrames orders chronologically by photo day and collapses weekly frames cleanly", () => {
  const records = [
    // Uploaded out of chronological order
    { id: "c", day: "2026-11-20", pose: "front" as const, createdAt: "2026-11-25T01:00:00Z" },
    { id: "a", day: "2026-11-09", pose: "front" as const, createdAt: "2026-11-25T03:00:00Z" },
    { id: "b", day: "2026-11-16", pose: "front" as const, createdAt: "2026-11-25T02:00:00Z" },
    { id: "s1", day: "2026-11-18", pose: "side" as const, createdAt: "2026-11-25T00:00:00Z" },
  ];

  // 2026-11-16 (Mon) and 2026-11-20 (Fri) are in the same ISO week 2026-W47
  assert.equal(isoWeekKey("2026-11-16"), "2026-W47");
  assert.equal(isoWeekKey("2026-11-20"), "2026-W47");

  const daily = orderPhysiqueFrames(records, "front", "daily");
  assert.deepEqual(
    daily.map((r) => r.day),
    ["2026-11-09", "2026-11-16", "2026-11-20"],
  );

  const weekly = orderPhysiqueFrames(records, "front", "weekly");
  assert.deepEqual(
    weekly.map((r) => r.day),
    ["2026-11-09", "2026-11-20"],
  );
});
