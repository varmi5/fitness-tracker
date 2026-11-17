import { z } from "zod";
import { parseOpenFoodFactsProduct } from "../../../../lib/uk-foods";
import { authConfigured, getAuth } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);

  const rawCode = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  const parsed = z.string().regex(/^\d{8,14}$/, "Enter an 8 to 14 digit barcode.").safeParse(rawCode);
  if (!parsed.success) return json({ message: parsed.error.issues[0].message }, 400);

  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${parsed.data}.json?fields=product_name,generic_name,brands,quantity,serving_size,nutriments`,
      {
        headers: { "User-Agent": "FitnessTracker/1.0 (personal-nutrition-app)" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!response.ok) return json({ message: "Barcode lookup is temporarily unavailable." }, 502);
    const product = parseOpenFoodFactsProduct(parsed.data, await response.json());
    if (!product) return json({ message: "No product found for that barcode. Enter details manually." }, 404);
    return json({ product });
  } catch {
    return json({ message: "Could not look up that barcode right now." }, 502);
  }
}
