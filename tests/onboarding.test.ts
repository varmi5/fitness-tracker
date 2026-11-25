import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { nutritionData } from "../lib/nutrition-data";
import { ACTIVITY_LEVELS, buildChatGptTdeePrompt, estimateMifflinTdee } from "../lib/onboarding";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  const migrations = (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await pg.exec(await readFile(`migrations/${migration}`, "utf8"));
  }
  await db.insert(schema.user).values(
    ["U1", "U2"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
});

after(async () => pg.close());

test("estimateMifflinTdee calculates accurate BMR and maintenance TDEE and rejects invalid inputs", () => {
  const male = estimateMifflinTdee({
    weightKg: 74,
    heightCm: 175,
    ageYears: 25,
    sex: "male",
    activityMultiplier: 1.55,
  });
  // BMR = 740 + 1093.75 - 125 + 5 = 1713.75 -> 1714; TDEE = 1713.75 * 1.55 = 2656.3125 -> 2656
  assert.deepEqual(male, { bmr: 1714, tdee: 2656 });

  const female = estimateMifflinTdee({
    weightKg: 60,
    heightCm: 165,
    ageYears: 28,
    sex: "female",
    activityMultiplier: ACTIVITY_LEVELS[1].multiplier,
  });
  // BMR = 600 + 1031.25 - 140 - 161 = 1330.25 -> 1330; TDEE = 1330.25 * 1.375 = 1829.09 -> 1829
  assert.deepEqual(female, { bmr: 1330, tdee: 1829 });

  const neutral = estimateMifflinTdee({
    weightKg: 70,
    heightCm: 170,
    ageYears: 30,
    sex: "other",
    activityMultiplier: 1.2,
  });
  assert.ok(neutral && neutral.tdee > neutral.bmr);

  assert.equal(
    estimateMifflinTdee({ weightKg: 10, heightCm: 175, ageYears: 25, sex: "male", activityMultiplier: 1.5 }),
    null,
  );
});

test("buildChatGptTdeePrompt formats user stats and wearable guidance cleanly", () => {
  const prompt = buildChatGptTdeePrompt({
    weightKg: "74",
    heightCm: "175",
    ageYears: "25",
    sex: "male",
    activityLabel: "Moderately active",
    goal: "cut",
    wearableNote: "Apple Watch 2250 kcal avg",
  });
  assert.match(prompt, /74 kg/);
  assert.match(prompt, /175 cm/);
  assert.match(prompt, /steady fat loss/);
  assert.match(prompt, /Apple Watch 2250 kcal avg/);
  assert.match(prompt, /Manual TDEE/);
});

test("onboarding flag starts true for new users, persists completion per user, and resets cleanly", async () => {
  const u1 = nutritionData(db, "U1");
  const u2 = nutritionData(db, "U2");

  const initialU1 = await u1.settings();
  const initialU2 = await u2.settings();
  assert.equal(initialU1.needsOnboarding, true);
  assert.equal(initialU1.onboardingCompletedAt, null);
  assert.equal(initialU2.needsOnboarding, true);

  const afterCompleteU1 = await u1.setPreferences({
    trackingMode: "manual",
    bulkMode: false,
    onboardingCompleted: true,
  });
  assert.equal(afterCompleteU1.needsOnboarding, false);
  assert.ok(afterCompleteU1.onboardingCompletedAt);

  // Isolated per user
  const stillNewU2 = await u2.settings();
  assert.equal(stillNewU2.needsOnboarding, true);
  assert.equal(stillNewU2.onboardingCompletedAt, null);

  // Saving a calorie target for U2 automatically suppresses forced first-run wizard
  await u2.setTarget({ effectiveFrom: "2026-11-25", calories: 2300 });
  const targetedU2 = await u2.settings();
  assert.equal(targetedU2.needsOnboarding, false);

  // Explicitly resetting onboardingCompleted clears timestamp
  const resetU1 = await u1.setPreferences({ onboardingCompleted: false });
  assert.equal(resetU1.onboardingCompletedAt, null);
  assert.equal(resetU1.needsOnboarding, true);
});
