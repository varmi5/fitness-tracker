import { z } from "zod";
import { searchBrandedFoods, FoodProviderError, barcodeFood } from "../../../lib/branded-foods";
import { catalogueCount, searchCatalogue } from "../../../lib/food-catalogue";
import { nutritionData, NutritionError } from "../../../lib/nutrition-data";
import { templateInput } from "../../../lib/nutrition-model";
import { isSameAllowedOrigin } from "../../../lib/origins";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../lib/runtime";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
async function viewer(request: Request) { return authConfigured() ? (await getAuth().api.getSession({ headers: request.headers }))?.user : null; }
export async function GET(request: Request) {
  const user = await viewer(request);
  if (!user) return json({ message: "Please sign in." }, 401);
  const params = new URL(request.url).searchParams;
  const query = z.string().trim().max(100).safeParse(params.get("q") ?? "");
  if (!query.success) return json({ message: "Search is too long." }, 400);
  try {
    if (params.has("barcode")) {
      const code = z.string().regex(/^\d{8,14}$/).parse(params.get("barcode"));
      const food = await barcodeFood(getDatabase(), user.id, code);
      return food ? json({ food }) : json({ message: "No product found. You can create a custom food." }, 404);
    }
    let products = [] as Awaited<ReturnType<typeof searchBrandedFoods>>;
    let providerMessage: string | null = null;
    if (params.get("products") === "1") {
      try { products = await searchBrandedFoods(getDatabase(), user.id, query.data); }
      catch (error) { providerMessage = error instanceof FoodProviderError ? error.message : "Product search is unavailable. Your foods still work."; }
    }
    return json({ catalogue: searchCatalogue(query.data), products, catalogueCount, providerMessage });
  } catch (error) {
    return json({ message: error instanceof FoodProviderError ? error.message : "Could not look up that food." }, error instanceof FoodProviderError ? error.status : 400);
  }
}
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), food: templateInput }),
  z.object({ action: z.literal("favourite"), id: z.uuid(), isFavourite: z.boolean() }),
  z.object({ action: z.literal("delete"), id: z.uuid() }),
]);
export async function POST(request: Request) {
  if (!isSameAllowedOrigin(request, getAuthConfig())) return json({ message: "A same-origin request is required." }, 403);
  const user = await viewer(request);
  if (!user) return json({ message: "Please sign in." }, 401);
  try {
    const input = action.parse(await request.json());
    const data = nutritionData(getDatabase(), user.id);
    if (input.action === "save") return json({ food: await data.saveTemplate(input.food) });
    if (input.action === "favourite") return json({ food: await data.favourite(input.id, input.isFavourite) });
    return json(await data.removeTemplate(input.id));
  } catch (error) {
    return json({ message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof NutritionError ? error.message : "Could not update your food." }, error instanceof NutritionError ? error.status : 400);
  }
}
