import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { eq } from "drizzle-orm";
import { nutritionData } from "../lib/nutrition-data";
import { getDatabase } from "../lib/runtime";
import { user } from "../lib/schema";

try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export async function seedExampleDay(userId: string) {
  const db = getDatabase();
  const data = nutritionData(db, userId);

  await data.setTarget({ effectiveFrom: "2026-11-01", calories: 1900 });
  await data.setPreferences({ timezone: "Europe/London", preferredEnergySource: "google" });

  await data.saveTemplate({
    kind: "recipe",
    name: "Homemade Red Lentil Dhal",
    defaultAmount: 250,
    defaultUnit: "g",
    batchCookedGrams: 1000,
    calories: 1120,
    proteinG: 64,
    carbsG: 168,
    fatG: 16,
    fibreG: 32,
    ingredients: "Red lentils, onion, garlic, ginger, tinned tomatoes, 1 tbsp rapeseed oil, turmeric, cumin",
    cookingMethod: "Simmered & tempered",
  });

  await data.log({
    day: "2026-11-17",
    time: "08:30",
    name: "Three large eggs & Cholula",
    category: "breakfast",
    cookingMethod: "Soft-scrambled, dry non-stick pan",
    ingredients: "Three large UK eggs, Cholula hot sauce",
    notes: "Synthetic example breakfast fixture",
    idempotencyKey: `seed-${userId}-2026-11-17-breakfast`,
    items: [
      {
        name: "Three large eggs",
        amount: 180,
        unit: "g",
        calories: 257,
        proteinG: 22.7,
        carbsG: 2.0,
        fatG: 17.5,
        fibreG: null,
        estimationMethod: "weighed",
      },
      {
        name: "Cholula hot sauce",
        amount: 15,
        unit: "ml",
        calories: 3,
        proteinG: 0.1,
        carbsG: 0.5,
        fatG: 0,
        fibreG: null,
        estimationMethod: "measured",
      },
    ],
  });

  await data.log({
    day: "2026-11-17",
    time: "13:15",
    name: "Grilled chicken & avocado",
    category: "lunch",
    cookingMethod: "Grilled",
    ingredients: "Chicken breast, olive oil drizzle, sea salt",
    idempotencyKey: `seed-${userId}-2026-11-17-lunch`,
    items: [
      {
        name: "Chicken breast, skinless, grilled",
        amount: 150,
        unit: "g",
        calories: 405,
        proteinG: 46.2,
        carbsG: 4.5,
        fatG: 22.5,
        fibreG: null,
        estimationMethod: "weighed",
      },
    ],
  });

  await data.saveEnergy({
    day: "2026-11-17",
    source: "manual",
    totalKcal: 2315,
    activeKcal: 520,
    steps: 9420,
    weightKg: 74.4,
    complete: true,
  });

  await data.markDay("2026-11-17", true);
  return data.daily("2026-11-17");
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx scripts/seed-nutrition.ts <owner-email>");
    process.exit(1);
  }
  const db = getDatabase();
  const [found] = await db.select().from(user).where(eq(user.email, email));
  if (!found) {
    console.error(`User not found for email: ${email} (${randomUUID().slice(0, 4)})`);
    process.exit(1);
  }
  const daily = await seedExampleDay(found.id);
  console.log("Seeded 2026-11-17:", {
    calories: daily.totals.calories,
    remaining: daily.remaining,
    proteinG: daily.totals.proteinG,
    carbsG: daily.totals.carbsG,
    fatG: daily.totals.fatG,
    fibreG: daily.totals.fibreG,
    deficit: daily.deficit,
  });
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
