import type { PhysiqueCadence, PhysiquePose } from "./physique-data";

export interface ExtractedPhotoDate {
  day: string;
  source: "exif" | "file";
}

function isValidDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dom = Number(m[3]);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || dom < 1 || dom > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, dom));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === dom
  );
}

function normalizeExifDateString(raw: string): string | null {
  const trimmed = raw.replace(/\0+$/, "").trim();
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})/.exec(trimmed);
  if (!m) return null;
  const candidate = `${m[1]}-${m[2]}-${m[3]}`;
  return isValidDay(candidate) ? candidate : null;
}

function readAscii(view: DataView, start: number, length: number): string {
  const end = Math.min(view.byteLength, start + length);
  let out = "";
  for (let i = start; i < end; i++) {
    const code = view.getUint8(i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function readIfdTags(
  view: DataView,
  tiffStart: number,
  ifdRelativeOffset: number,
  littleEndian: boolean,
): Map<number, { type: number; count: number; valueOffset: number; entryOffset: number }> {
  const tags = new Map<number, { type: number; count: number; valueOffset: number; entryOffset: number }>();
  const ifdPos = tiffStart + ifdRelativeOffset;
  if (ifdPos < tiffStart || ifdPos + 2 > view.byteLength) return tags;

  const entryCount = view.getUint16(ifdPos, littleEndian);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdPos + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
    tags.set(tag, { type, count, valueOffset, entryOffset });
  }
  return tags;
}

function readExifAsciiTag(
  view: DataView,
  tiffStart: number,
  entry: { type: number; count: number; valueOffset: number; entryOffset: number } | undefined,
): string | null {
  if (!entry || entry.type !== 2 || entry.count < 10 || entry.count > 64) return null;
  const strOffset = entry.count <= 4 ? entry.entryOffset + 8 : tiffStart + entry.valueOffset;
  if (strOffset < tiffStart || strOffset >= view.byteLength) return null;
  return normalizeExifDateString(readAscii(view, strOffset, entry.count));
}

function parseTiffExifDate(view: DataView, tiffStart: number): string | null {
  if (tiffStart + 8 > view.byteLength) return null;
  const endian = view.getUint16(tiffStart, false);
  const littleEndian = endian === 0x4949 ? true : endian === 0x4d4d ? false : null;
  if (littleEndian === null) return null;

  const magic = view.getUint16(tiffStart + 2, littleEndian);
  if (magic !== 42) return null;

  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  const ifd0 = readIfdTags(view, tiffStart, ifd0Offset, littleEndian);

  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) {
    const exifIfd = readIfdTags(view, tiffStart, exifPtr.valueOffset, littleEndian);
    const original = readExifAsciiTag(view, tiffStart, exifIfd.get(0x9003));
    if (original) return original;
    const digitized = readExifAsciiTag(view, tiffStart, exifIfd.get(0x9004));
    if (digitized) return digitized;
  }

  const modified = readExifAsciiTag(view, tiffStart, ifd0.get(0x0132));
  if (modified) return modified;

  return null;
}

function extractXmpDateFromBytes(bytes: Uint8Array): string | null {
  // Scan ASCII metadata headers (e.g. XMP CreateDate / DateCreated in PNG/JPEG/HEIC-converted blobs).
  const limit = Math.min(bytes.length, 262144);
  let text = "";
  for (let i = 0; i < limit; i++) {
    const c = bytes[i];
    text += c >= 32 && c <= 126 ? String.fromCharCode(c) : " ";
  }
  const patterns = [
    /(?:exif:DateTimeOriginal|photoshop:DateCreated|xmp:CreateDate)\s*[=>"]+\s*(\d{4}[:\-]\d{2}[:\-]\d{2})/i,
  ];
  for (const re of patterns) {
    const match = re.exec(text);
    if (match?.[1]) {
      const normalized = normalizeExifDateString(match[1]);
      if (normalized) return normalized;
    }
  }
  return null;
}

/**
 * Extracts the capture date (`YYYY-MM-DD`) from an image's EXIF/XMP header bytes.
 * Supports JPEG APP1 Exif (`II` little-endian and `MM` big-endian) and standalone TIFF blocks.
 */
export function extractExifDateFromBuffer(buf: ArrayBuffer): string | null {
  if (buf.byteLength < 12) return null;
  const view = new DataView(buf);

  // Standalone TIFF block
  const head = view.getUint16(0, false);
  if (head === 0x4949 || head === 0x4d4d) {
    return parseTiffExifDate(view, 0);
  }

  // JPEG container: walk markers up to SOS (0xFFDA) or EOI (0xFFD9)
  if (head === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      while (offset < view.byteLength && view.getUint8(offset) !== 0xff) {
        offset++;
      }
      while (offset < view.byteLength && view.getUint8(offset) === 0xff) {
        offset++;
      }
      if (offset >= view.byteLength) break;
      const marker = view.getUint8(offset);
      offset++;

      if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 2 > view.byteLength) break;
      const segLen = view.getUint16(offset, false);
      if (segLen < 2) break;

      if (marker === 0xe1 && offset + 8 <= view.byteLength) {
        const sig = readAscii(view, offset + 2, 6);
        if (sig === "Exif") {
          const parsed = parseTiffExifDate(view, offset + 8);
          if (parsed) return parsed;
        }
      }
      offset += segLen;
    }
  }

  return extractXmpDateFromBytes(new Uint8Array(buf));
}

function formatLocalDay(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const day = `${y}-${m}-${d}`;
  return isValidDay(day) ? day : null;
}

function clampMaxDay(day: string, maxDay?: string): string {
  if (maxDay && isValidDay(maxDay) && day > maxDay) {
    return maxDay;
  }
  return day;
}

/**
 * Extracts capture date from an uploaded image file: checks EXIF/XMP metadata first,
 * then falls back to `file.lastModified`.
 */
export async function extractPhotoDate(
  file: File,
  maxDay?: string,
): Promise<ExtractedPhotoDate | null> {
  try {
    const slice = file.slice(0, 262144);
    const buffer = await slice.arrayBuffer();
    const exifDay = extractExifDateFromBuffer(buffer);
    if (exifDay) {
      return { day: clampMaxDay(exifDay, maxDay), source: "exif" };
    }
  } catch {
    // Fall back to file.lastModified below
  }

  const fileDay = formatLocalDay(file.lastModified);
  if (fileDay) {
    return { day: clampMaxDay(fileDay, maxDay), source: "file" };
  }
  return null;
}

/**
 * Computes deterministic ISO 8601 week bucket key (`YYYY-Www`) from `YYYY-MM-DD`.
 */
export function isoWeekKey(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dayNum = dt.getUTCDay() || 7; // Mon=1 .. Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Sorts physique check-ins strictly chronologically (`day` ascending, tie-break `createdAt` ascending)
 * for the selected pose, collapsing multiple entries in the same ISO week to the latest shot
 * when `viewCadence === "weekly"`.
 */
export function orderPhysiqueFrames<T extends { day: string; pose: PhysiquePose; createdAt: string }>(
  records: T[],
  pose: PhysiquePose,
  viewCadence: PhysiqueCadence,
): T[] {
  const sorted = records
    .filter((r) => r.pose === pose)
    .sort((a, b) => a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt));

  if (viewCadence === "daily") return sorted;

  const byWeek = new Map<string, T>();
  for (const frame of sorted) {
    byWeek.set(isoWeekKey(frame.day), frame);
  }
  return Array.from(byWeek.values());
}
