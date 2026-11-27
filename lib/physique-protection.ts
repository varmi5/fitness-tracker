import { z } from "zod";

const encoded = (max: number) => z.string().max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const envelope = (maximum: number) => z.object({
  iv: encoded(16).length(16),
  data: encoded(maximum),
});
export const wrappedPhysiqueKey = envelope(64);
export const protectedPhysiquePhoto = envelope(1_210_000);
export const physiqueProtectionInput = z.object({
  image: protectedPhysiquePhoto,
  details: envelope(8192),
  wrappedKey: wrappedPhysiqueKey,
});
export const physiqueVaultInput = z.object({ salt: encoded(44).length(44), check: envelope(80) });
export const physiqueShareProtectionInput = z.object({
  ownerKey: wrappedPhysiqueKey,
  photos: z.record(z.uuid(), wrappedPhysiqueKey),
}).refine((value) => Object.keys(value.photos).length <= 300);

export type PhysiqueProtection = z.infer<typeof physiqueProtectionInput>;
export type PhysiqueVault = z.infer<typeof physiqueVaultInput>;
export type PhysiqueKey = z.infer<typeof wrappedPhysiqueKey>;
export type PhysiqueShareProtection = z.infer<typeof physiqueShareProtectionInput>;
