import type { PhysiqueCheckinRecord } from "../lib/physique-data";
import type { PhysiqueKey, PhysiqueProtection, PhysiqueVault } from "../lib/physique-protection";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeSecret(bytes: Uint8Array): string {
  let output = "";
  for (let i = 0; i < bytes.length; i += 16384) output += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(output);
}

export function decodeSecret(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function importPhysiqueKey(raw: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(key: CryptoKey, input: Uint8Array<ArrayBuffer>, purpose: string): Promise<PhysiqueKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const output = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) }, key, input);
  return { iv: encodeSecret(iv), data: encodeSecret(new Uint8Array(output)) };
}

async function decrypt(key: CryptoKey, input: PhysiqueKey, purpose: string) {
  return new Uint8Array(await crypto.subtle.decrypt({
    name: "AES-GCM", iv: decodeSecret(input.iv), additionalData: encoder.encode(purpose),
  }, key, decodeSecret(input.data)));
}

async function deriveVaultKey(passphrase: string, salt: string) {
  const secret = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: decodeSecret(salt), iterations: 600000 }, secret, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function makeVault(passphrase: string) {
  const salt = encodeSecret(crypto.getRandomValues(new Uint8Array(32)));
  const key = await deriveVaultKey(passphrase, salt);
  return { salt, check: await encrypt(key, encoder.encode("FitnessTrackr Physique"), "vault") };
}

export async function openVault(passphrase: string, vault: PhysiqueVault) {
  const key = await deriveVaultKey(passphrase, vault.salt);
  try {
    if (decoder.decode(await decrypt(key, vault.check, "vault")) === "FitnessTrackr Physique") return key;
  } catch {
    throw new Error("That passphrase couldn’t unlock your photos.");
  }
  throw new Error("That passphrase couldn’t unlock your photos.");
}

type PrivateDetails = Pick<PhysiqueCheckinRecord, "weightKg" | "bodyFatPct" | "note">;

export function protectDetails(key: CryptoKey, details: PrivateDetails, wrappedKey: PhysiqueKey) {
  return encrypt(key, encoder.encode(JSON.stringify(details)), `details:${wrappedKey.iv}`);
}

export async function protectCheckin(key: CryptoKey, checkin: PrivateDetails & { photoData: string }): Promise<PhysiqueProtection> {
  const rawPhotoKey = crypto.getRandomValues(new Uint8Array(32));
  const photoKey = await importPhysiqueKey(rawPhotoKey);
  const wrappedKey = await encrypt(key, rawPhotoKey, "private photo key");
  return {
    wrappedKey,
    image: await encrypt(photoKey, encoder.encode(checkin.photoData), "photo"),
    details: await protectDetails(key, { weightKg: checkin.weightKg, bodyFatPct: checkin.bodyFatPct, note: checkin.note }, wrappedKey),
  };
}

export async function readProtectedCheckin(key: CryptoKey, checkin: PhysiqueCheckinRecord) {
  if (!checkin.protection) return checkin;
  const { image, details, wrappedKey } = checkin.protection;
  const photoKey = await importPhysiqueKey(await decrypt(key, wrappedKey, "private photo key"));
  const privateDetails = JSON.parse(decoder.decode(await decrypt(key, details, `details:${wrappedKey.iv}`))) as PrivateDetails;
  return { ...checkin, ...privateDetails, photoData: decoder.decode(await decrypt(photoKey, image, "photo")) };
}

export async function protectShare(vaultKey: CryptoKey, photos: PhysiqueCheckinRecord[]) {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const shareKey = await importPhysiqueKey(secret);
  const protectedPhotos: Record<string, PhysiqueKey> = {};
  for (const photo of photos) {
    if (!photo.protection) throw new Error("Unlock and protect the selected photos first.");
    const raw = await decrypt(vaultKey, photo.protection.wrappedKey, "private photo key");
    protectedPhotos[photo.id] = await encrypt(shareKey, raw, `share:${photo.id}`);
  }
  return { protection: { ownerKey: await encrypt(vaultKey, secret, "share link key"), photos: protectedPhotos }, secret: encodeSecret(secret) };
}

export async function reopenShare(vaultKey: CryptoKey, ownerKey: PhysiqueKey) {
  return encodeSecret(await decrypt(vaultKey, ownerKey, "share link key"));
}

export async function readSharedPhoto(secret: string, wrappedPhotoKey: PhysiqueKey, id: string, photo: PhysiqueKey) {
  const shareKey = await importPhysiqueKey(decodeSecret(secret));
  const key = await importPhysiqueKey(await decrypt(shareKey, wrappedPhotoKey, `share:${id}`));
  return decoder.decode(await decrypt(key, photo, "photo"));
}
