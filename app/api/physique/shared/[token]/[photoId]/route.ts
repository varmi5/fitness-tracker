import { sharedPhysiquePhoto } from "../../../../../../lib/physique-share";
import { authConfigured, getDatabase } from "../../../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; photoId: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!authConfigured()) return new Response(null, { status: 404, headers });
  const { token, photoId } = await params;
  const photo = await sharedPhysiquePhoto(getDatabase(), token, photoId);
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(photo ?? "");
  if (!match) return new Response(null, { status: 404, headers });
  const format = match[1].toLowerCase();
  return new Response(new Uint8Array(Buffer.from(match[2], "base64")), {
    headers: { ...headers, "Content-Type": `image/${format === "jpg" ? "jpeg" : format}`, "X-Content-Type-Options": "nosniff" },
  });
}
