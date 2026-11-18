import type { MacroPlan } from "./macro-targets";
import type { EstimationMethod, FoodQualityMeta, NutrientSummary } from "./nutrition-model";

export type ScoreGrade = "A" | "B" | "C" | "D" | "E";
export type NovaTier = 1 | 2 | 3 | 4;

export interface ScoreableItem {
  name: string;
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  fibreG?: number | null;
  gramWeight?: number | null;
  millilitreVolume?: number | null;
  estimationMethod?: EstimationMethod;
  cookingMethod?: string;
  ingredients?: string;
  foodSnapshot?: {
    brand?: string;
    foodType?: "food" | "drink";
    source?: string;
    basisAmount?: number;
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    fibreG?: number | null;
    qualityMeta?: FoodQualityMeta;
  } | null;
}

export interface ScoreableMeal {
  id?: string;
  name: string;
  category?: string;
  cookingMethod?: string;
  ingredients?: string;
  items: ScoreableItem[];
  totals?: NutrientSummary;
}

export interface ContributorDelta {
  key: string;
  label: string;
  impact: "positive" | "negative";
  points: number;
  maxPoints: number;
  detail: string;
}

export interface ItemQualityClassification {
  nova: NovaTier;
  itemScore: number;
  tags: string[];
  signals: {
    vegGrams: number;
    fruitGrams: number;
    legumeNutGrams: number;
    wholeGrainGrams: number;
    fishOmegaGrams: number;
    leanProteinGrams: number;
    healthyOilGrams: number;
    redMeatGrams: number;
    processedMeatGrams: number;
    upfCalories: number;
    sugarRiskCalories: number;
    alcoholCalories: number;
    satFatRiskPoints: number;
    sodiumRiskPoints: number;
  };
}

export interface MealQualityScore {
  score: number | null;
  grade: ScoreGrade | null;
  novaAvg: number | null;
  fibreG: number | null;
  unknownFibreCount: number;
  topTag: string | null;
  contributors: ContributorDelta[];
}

export interface DailyNutritionScore {
  score: number | null;
  grade: ScoreGrade | null;
  locked: boolean;
  coverage: "empty" | "early" | "confident";
  qualitySubscore: number | null;
  fibreSubscore: number | null;
  proteinSubscore: number | null;
  balanceSubscore: number | null;
  wholeFoodPct: number | null;
  ultraProcessedPct: number | null;
  fibreG: number | null;
  fibreTargetG: number;
  carbToFibreRatio: number | null;
  unknownFibreCount: number;
  contributors: ContributorDelta[];
}

export function scoreToGrade(score: number | null): ScoreGrade | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 82) return "A";
  if (score >= 68) return "B";
  if (score >= 52) return "C";
  if (score >= 36) return "D";
  return "E";
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function approxMassGrams(item: ScoreableItem): number {
  if (item.gramWeight != null && Number.isFinite(item.gramWeight) && item.gramWeight > 0) {
    return item.gramWeight;
  }
  if (item.millilitreVolume != null && Number.isFinite(item.millilitreVolume) && item.millilitreVolume > 0) {
    return item.millilitreVolume;
  }
  if (item.calories != null && item.calories > 0) {
    return Math.min(800, Math.max(25, item.calories * 0.75));
  }
  return 100;
}

function nutriScoreToUnitScore(grade?: "a" | "b" | "c" | "d" | "e" | null, rawScore?: number | null): number | null {
  if (rawScore != null && Number.isFinite(rawScore)) {
    // Nutri-Score (-15 best .. +40 worst) mapped smoothly to 18..96
    return clamp(Math.round(96 - ((rawScore + 15) / 55) * 78), 10, 98);
  }
  switch (grade) {
    case "a": return 90;
    case "b": return 76;
    case "c": return 58;
    case "d": return 40;
    case "e": return 22;
    default: return null;
  }
}

function cofidGroupBaseline(group?: string): {
  nova: NovaTier;
  category:
    | "veg"
    | "fruit"
    | "legume_nut"
    | "wholegrain"
    | "refined_grain"
    | "fish"
    | "lean_protein"
    | "dairy"
    | "red_meat"
    | "processed_meat"
    | "oil"
    | "sweets_upf"
    | "alcohol"
    | "other";
} | null {
  if (!group) return null;
  const g = group.toUpperCase();
  if (g.startsWith("DG") || g.startsWith("DF") || g.startsWith("DI")) return { nova: 1, category: "veg" };
  if (g === "DB") return { nova: 1, category: "legume_nut" };
  if (g === "DR") return { nova: 3, category: "veg" };
  if (g.startsWith("FA") || g === "F") return { nova: 1, category: "fruit" };
  if (g.startsWith("FC")) return { nova: 3, category: "sweets_upf" };
  if (g.startsWith("GA")) return { nova: 1, category: "legume_nut" };
  if (g.startsWith("JA") || g.startsWith("JC") || g.startsWith("JK")) return { nova: 1, category: "fish" };
  if (g.startsWith("MAC")) return { nova: 1, category: "red_meat" };
  if (g.startsWith("MA")) return { nova: 4, category: "processed_meat" };
  if (g.startsWith("MC") || g.startsWith("ME")) return { nova: 1, category: "lean_protein" };
  if (g.startsWith("CA")) return { nova: 1, category: "lean_protein" }; // Eggs
  if (g.startsWith("BA") || g.startsWith("BC") || g.startsWith("BL")) return { nova: 1, category: "dairy" };
  if (g.startsWith("BP")) return { nova: 4, category: "sweets_upf" };
  if (g.startsWith("OA") || g.startsWith("OB")) return { nova: 2, category: "oil" };
  if (g.startsWith("AA") || g.startsWith("AB") || g.startsWith("AC") || g.startsWith("AF") || g.startsWith("AK")) {
    return { nova: 1, category: "wholegrain" };
  }
  if (g.startsWith("AN") || g.startsWith("AS") || g.startsWith("SE") || g.startsWith("SN") || g.startsWith("P")) {
    if (g === "PE" || g === "PCC" || g.startsWith("AN") || g.startsWith("SE")) return { nova: 4, category: "sweets_upf" };
    return { nova: 1, category: "other" };
  }
  if (g.startsWith("Q")) return { nova: 3, category: "alcohol" };
  return null;
}

const RE_VEG = /\b(broccoli|spinach|kale|cabbage|carrot|peppers?|bell pepper|tomato|cucumber|courgette|aubergine|lettuce|rocket|salad|greens|cauliflower|asparagus|peas?|green beans?|runner beans?|onion|garlic|mushroom|celery|beetroot|leek|sweetcorn|edamame|kimchi|sauerkraut|stir[- ]?fry veg|mixed veg)\b/i;
const RE_FRUIT = /\b(apple|banana|berry|berries|blueberr|strawberr|raspberr|blackberr|orange|mandarin|clementine|kiwi|mango|pear|peach|plum|grapes?|pineapple|melon|watermelon|avocado|pomegranate|grapefruit|cherry|cherries|fig)\b/i;
const RE_JUICE = /\b(juice|smoothie|cordial|squash|nectar|concentrate)\b/i;
const RE_WHOLEGRAIN = /\b(oats?|oatmeal|porridge|wholemeal|wholewheat|whole[- ]?grain|brown rice|wild rice|quinoa|buckwheat|rye|barley|bulgur|spelt|weetabix|shredded wheat|seeded bread|sourdough)\b/i;
const RE_LEGUME_NUT = /\b(lentils?|chickpeas?|kidney beans?|black beans?|cannellini|butter beans?|haricot|baked beans|hummus|dhal|daal|dal|tofu|tempeh|edamame|almonds?|walnuts?|cashews?|pistachio|pecans?|hazelnuts?|peanuts?|chia|flax|linseed|pumpkin seeds?|sunflower seeds?|sesame|tahini)\b/i;
const RE_FISH_OMEGA = /\b(salmon|mackerel|sardines?|trout|herring|kippers?|anchov|tuna|cod|haddock|sea bass|prawns?|shrimp|mussels|fish)\b/i;
const RE_LEAN_PROTEIN = /\b(eggs?|omelette|chicken breast|turkey|cottage cheese|greek yog(?:h)?urt|skyr|kefir|quark|egg white|protein shake|whey)\b/i;
const RE_HEALTHY_OIL = /\b(olive oil|extra virgin|rapeseed oil|avocado oil|walnut oil|flax oil|pesto)\b/i;
const RE_RED_MEAT = /\b(beef|steak|mince|lamb|pork|venison|burger|meatball|brisket|sirloin|rib)\b/i;
const RE_PROCESSED_MEAT = /\b(bacon|sausage|ham|salami|pepperoni|chorizo|hot dog|frankfurter|gammon|corned beef|spam|pastrami|prosciutto|deli meat|nuggets?)\b/i;
const RE_ALCOHOL = /\b(beer|lager|ale|ipa|cider|wine|prosecco|champagne|whisky|whiskey|vodka|gin|rum|tequila|cocktail|pint|stout)\b/i;
const RE_DEEP_FRIED = /\b(deep[- ]?fried|battered|chips|fries|french fries|tempura|pakora|samosa|bhaji|fried chicken|doner|kebab)\b/i;
const RE_UPF_TOKENS = /\b(cola|pepsi|coke|fanta|sprite|soda|fizzy|energy drink|monster|red bull|milkshake|chocolate|biscuit|cookie|cake|brownie|donut|doughnut|pastry|croissant|muffin|crisps|doritos|pringles|chips|candy|sweets|haribo|ice cream|gelato|pizza|instant noodles?|pot noodle|mars|snickers|kitkat|oreo|granola bar|cereal bar|protein bar|ultra[- ]?processed|syrup|jam|nutella)\b/i;
const RE_UPF_INGREDIENTS = /\b(maltodextrin|high fructose|glucose syrup|inverted sugar|emulsifier|mono- and diglycerides|lecithin|carrageenan|xanthan|acesulfame|sucralose|aspartame|artificial flavour|flavoring|hydrogenated|palm oil)\b/i;

/**
 * Deterministic Open-Source Feature / Log-Odds Classifier blending:
 * 1) UK CoFID category priors + Open Food Facts Nutri-Score / NOVA / Additives metadata
 * 2) Macro & nutrient density heuristics (protein-to-kcal, fibre density, sugar/sat-fat/sodium)
 * 3) Weighted token signals (whole plant foods & omega-3 vs NOVA-4 & added sugars)
 */
export function classifyFoodQuality(item: ScoreableItem): ItemQualityClassification {
  const meta = item.foodSnapshot?.qualityMeta;
  const text = `${item.name} ${item.ingredients ?? ""} ${item.cookingMethod ?? ""} ${meta?.categoriesTags?.join(" ") ?? ""}`.toLowerCase();
  const mass = approxMassGrams(item);
  const kcal = item.calories ?? 0;
  const protein = item.proteinG ?? 0;
  const carbs = item.carbsG ?? 0;
  const fat = item.fatG ?? 0;
  const fibre = item.fibreG ?? null;
  const tags: string[] = [];

  const signals = {
    vegGrams: 0,
    fruitGrams: 0,
    legumeNutGrams: 0,
    wholeGrainGrams: 0,
    fishOmegaGrams: 0,
    leanProteinGrams: 0,
    healthyOilGrams: 0,
    redMeatGrams: 0,
    processedMeatGrams: 0,
    upfCalories: 0,
    sugarRiskCalories: 0,
    alcoholCalories: 0,
    satFatRiskPoints: 0,
    sodiumRiskPoints: 0,
  };

  const cofid = cofidGroupBaseline(meta?.cofidGroup);

  // Compute weighted log-odds score for NOVA processing tier (positive -> whole/unprocessed, negative -> UPF)
  let wholeScore = 0;
  if (cofid?.nova === 1) wholeScore += 2.2;
  else if (cofid?.nova === 3) wholeScore -= 0.4;
  else if (cofid?.nova === 4) wholeScore -= 2.4;

  if (item.foodSnapshot?.source === "UK CoFID") wholeScore += 0.6;
  if (item.foodSnapshot?.source === "Saved recipe" || item.estimationMethod === "recipe") wholeScore += 1.0;

  const isJuice = RE_JUICE.test(text);
  const isVeg = RE_VEG.test(text) || cofid?.category === "veg";
  const isFruit = !isJuice && (RE_FRUIT.test(text) || cofid?.category === "fruit");
  const isLegumeNut = RE_LEGUME_NUT.test(text) || cofid?.category === "legume_nut";
  const isWholeGrain = RE_WHOLEGRAIN.test(text);
  const isFish = RE_FISH_OMEGA.test(text) || cofid?.category === "fish";
  const isLeanProtein = RE_LEAN_PROTEIN.test(text) || cofid?.category === "lean_protein";
  const isHealthyOil = RE_HEALTHY_OIL.test(text) || (cofid?.category === "oil" && !/butter|lard|ghee|palm/i.test(text));
  const isProcessedMeat = RE_PROCESSED_MEAT.test(text) || cofid?.category === "processed_meat";
  const isRedMeat = !isProcessedMeat && (RE_RED_MEAT.test(text) || cofid?.category === "red_meat");
  const isAlcohol = RE_ALCOHOL.test(text) || cofid?.category === "alcohol";
  const isDeepFried = RE_DEEP_FRIED.test(text);
  const isUpfToken = RE_UPF_TOKENS.test(text);
  const hasUpfIngredients = Boolean(meta?.ingredientsText && RE_UPF_INGREDIENTS.test(meta.ingredientsText));

  if (isVeg) { wholeScore += 2.6; signals.vegGrams += mass; tags.push("Vegetables"); }
  if (isFruit) { wholeScore += 2.2; signals.fruitGrams += mass; tags.push("Whole fruit"); }
  if (isLegumeNut) { wholeScore += 2.2; signals.legumeNutGrams += mass; tags.push("Legumes / Nuts"); }
  if (isWholeGrain) { wholeScore += 2.0; signals.wholeGrainGrams += mass; tags.push("Whole grains"); }
  if (isFish) { wholeScore += 2.2; signals.fishOmegaGrams += mass; tags.push("Fish / Omega-3"); }
  if (isLeanProtein) { wholeScore += 1.6; signals.leanProteinGrams += mass; tags.push("Lean protein"); }
  if (isHealthyOil) { wholeScore += 1.4; signals.healthyOilGrams += mass; tags.push("Healthy fats"); }

  if (isProcessedMeat) { wholeScore -= 2.8; signals.processedMeatGrams += mass; tags.push("Processed meat"); }
  else if (isRedMeat) { wholeScore += 0.4; signals.redMeatGrams += mass; }

  if (isAlcohol) { wholeScore -= 2.0; signals.alcoholCalories += kcal; tags.push("Alcohol"); }
  if (isDeepFried) { wholeScore -= 1.8; tags.push("Deep fried"); }
  if (isUpfToken) { wholeScore -= 2.8; tags.push("Ultra-processed"); }
  if (hasUpfIngredients) { wholeScore -= 2.6; }

  // Nutrient density adjustments (per 100 kcal or 100 g)
  let macroQuality = 62;
  const offScore = nutriScoreToUnitScore(meta?.nutriScoreGrade, meta?.nutriScoreScore);
  if (offScore != null) macroQuality = offScore;

  if (fibre != null && kcal > 0) {
    const fibrePer100Kcal = (fibre / kcal) * 100;
    if (fibrePer100Kcal >= 3.0) { macroQuality += 14; wholeScore += 1.0; tags.push("High fibre"); }
    else if (fibrePer100Kcal >= 1.5) macroQuality += 7;
  }
  if (kcal > 0) {
    const proteinPct = (protein * 4) / kcal;
    if (proteinPct >= 0.30) macroQuality += 10;
    else if (proteinPct >= 0.18) macroQuality += 5;
  }

  // Sugar, saturated fat & sodium density when present in Open Food Facts or sugary liquid items
  const sugarPer100 = meta?.sugarsG ?? null;
  if (sugarPer100 != null) {
    const highSugar = item.foodSnapshot?.foodType === "drink" ? sugarPer100 >= 4.5 : sugarPer100 >= 15;
    if (highSugar) {
      macroQuality -= 18;
      wholeScore -= 1.4;
      signals.sugarRiskCalories += kcal;
      tags.push("High sugar");
    }
  } else if ((isJuice || /\bsoda\b|\bcola\b|\bcandy\b|\bsweets\b|\bchocolate\b|\bice cream\b|\bcake\b|\bsyrup\b/i.test(text)) && carbs > 6 && (fibre ?? 0) < 1.5) {
    macroQuality -= 16;
    signals.sugarRiskCalories += kcal;
    tags.push("Added / free sugar");
  }

  if (meta?.saturatedFatG != null && meta.saturatedFatG >= 6) {
    macroQuality -= clamp(Math.round((meta.saturatedFatG - 5) * 1.4), 2, 14);
    signals.satFatRiskPoints += 1;
  } else if (fat > 0 && isProcessedMeat) {
    signals.satFatRiskPoints += 1;
  }

  if (meta?.sodiumMg != null && meta.sodiumMg >= 600) {
    macroQuality -= clamp(Math.round((meta.sodiumMg - 500) / 150), 2, 12);
    signals.sodiumRiskPoints += 1;
  }

  // Final NOVA classification: explicit Open Food Facts NOVA takes precedence if available, else logistic sigmoid threshold
  let nova: NovaTier;
  if (meta?.novaGroup) {
    nova = meta.novaGroup;
  } else if (wholeScore >= 1.2) {
    nova = 1;
  } else if (isHealthyOil) {
    nova = 2;
  } else if (wholeScore >= -1.2) {
    nova = 3;
  } else {
    nova = 4;
  }

  if (nova === 4 || isUpfToken || hasUpfIngredients) {
    signals.upfCalories += kcal;
    macroQuality -= offScore != null ? 6 : 16;
  } else if (nova === 1) {
    macroQuality += 10;
  }

  if (isVeg || isFruit || isLegumeNut || isWholeGrain || isFish) {
    macroQuality += 8;
  }
  if (isDeepFried || isProcessedMeat || isAlcohol) {
    macroQuality -= 14;
  }

  return {
    nova,
    itemScore: clamp(Math.round(macroQuality), 5, 99),
    tags: [...new Set(tags)].slice(0, 4),
    signals,
  };
}

export function scoreMealNutrition(meal: ScoreableMeal, macroTargets?: MacroPlan): MealQualityScore {
  const items = meal.items ?? [];
  if (!items.length) {
    return { score: null, grade: null, novaAvg: null, fibreG: null, unknownFibreCount: 0, topTag: null, contributors: [] };
  }

  let weightSum = 0;
  let scoreWeighted = 0;
  let novaWeighted = 0;
  let knownFibreSum = 0;
  let hasFibre = false;
  let unknownFibreCount = 0;
  const tagFreq = new Map<string, number>();

  for (const raw of items) {
    const item: ScoreableItem = {
      ...raw,
      cookingMethod: raw.cookingMethod ?? meal.cookingMethod,
      ingredients: raw.ingredients ?? meal.ingredients,
    };
    const cls = classifyFoodQuality(item);
    const weight = Math.max(25, item.calories ?? approxMassGrams(item));
    weightSum += weight;
    scoreWeighted += cls.itemScore * weight;
    novaWeighted += cls.nova * weight;
    for (const tag of cls.tags) tagFreq.set(tag, (tagFreq.get(tag) ?? 0) + weight);

    if (item.fibreG != null && Number.isFinite(item.fibreG)) {
      knownFibreSum += item.fibreG;
      hasFibre = true;
    } else {
      unknownFibreCount += 1;
    }
  }

  const baseScore = weightSum > 0 ? scoreWeighted / weightSum : 60;
  const proteinG = meal.totals?.proteinG ?? items.reduce((s, i) => s + (i.proteinG ?? 0), 0);
  const fibreG = hasFibre ? round1(knownFibreSum) : null;
  const proteinBoost = proteinG >= 25 ? 4 : proteinG >= 15 ? 2 : 0;
  const fibrePerMealTarget = (macroTargets?.fibreG ?? 30) / 3.5;
  const fibreBoost = fibreG != null && fibreG >= fibrePerMealTarget ? 5 : fibreG != null && fibreG >= 4 ? 2 : 0;

  const finalScore = clamp(Math.round(baseScore + proteinBoost + fibreBoost), 1, 100);
  const sortedTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]);

  return {
    score: finalScore,
    grade: scoreToGrade(finalScore),
    novaAvg: weightSum > 0 ? round1(novaWeighted / weightSum) : null,
    fibreG,
    unknownFibreCount,
    topTag: sortedTags[0]?.[0] ?? null,
    contributors: [],
  };
}

export function scoreDayNutrition(
  meals: ScoreableMeal[],
  totals: NutrientSummary,
  targetCalories: number,
  macroTargets: MacroPlan,
): DailyNutritionScore {
  const allItems = meals.flatMap((m) =>
    m.items.map((item) => ({
      ...item,
      cookingMethod: item.cookingMethod ?? m.cookingMethod,
      ingredients: item.ingredients ?? m.ingredients,
    })),
  );

  if (allItems.length === 0) {
    return {
      score: null,
      grade: null,
      locked: true,
      coverage: "empty",
      qualitySubscore: null,
      fibreSubscore: null,
      proteinSubscore: null,
      balanceSubscore: null,
      wholeFoodPct: null,
      ultraProcessedPct: null,
      fibreG: null,
      fibreTargetG: macroTargets.fibreG,
      carbToFibreRatio: null,
      unknownFibreCount: 0,
      contributors: [],
    };
  }

  let vegG = 0;
  let fruitG = 0;
  let legNutG = 0;
  let wholeGrainG = 0;
  let fishG = 0;
  let leanProtG = 0;
  let oilG = 0;
  let redMeatG = 0;
  let procMeatG = 0;
  let upfKcal = 0;
  let sugarKcal = 0;
  let alcoholKcal = 0;
  let satSodiumFlags = 0;
  let wholeNovaWeight = 0;
  let totalWeight = 0;
  let weightedItemScore = 0;
  let unknownFibreCount = 0;

  for (const item of allItems) {
    const cls = classifyFoodQuality(item);
    const w = Math.max(25, item.calories ?? approxMassGrams(item));
    totalWeight += w;
    weightedItemScore += cls.itemScore * w;
    if (cls.nova <= 2) wholeNovaWeight += w;

    vegG += cls.signals.vegGrams;
    fruitG += cls.signals.fruitGrams;
    legNutG += cls.signals.legumeNutGrams;
    wholeGrainG += cls.signals.wholeGrainGrams;
    fishG += cls.signals.fishOmegaGrams;
    leanProtG += cls.signals.leanProteinGrams;
    oilG += cls.signals.healthyOilGrams;
    redMeatG += cls.signals.redMeatGrams;
    procMeatG += cls.signals.processedMeatGrams;
    upfKcal += cls.signals.upfCalories;
    sugarKcal += cls.signals.sugarRiskCalories;
    alcoholKcal += cls.signals.alcoholCalories;
    satSodiumFlags += cls.signals.satFatRiskPoints + cls.signals.sodiumRiskPoints;

    if (item.fibreG == null) unknownFibreCount += 1;
  }

  const contributors: ContributorDelta[] = [];
  const addContrib = (
    key: string,
    label: string,
    impact: "positive" | "negative",
    points: number,
    maxPoints: number,
    detail: string,
  ) => {
    if (points === 0) return;
    contributors.push({ key, label, impact, points, maxPoints, detail });
  };

  // Positive Bevel / AHEI contributors
  const vegPts = Math.round(clamp(vegG / 200, 0, 1) * 12);
  addContrib("veg", "Vegetables & Greens", "positive", vegPts, 12, `~${Math.round(vegG)}g logged`);

  const fruitPts = Math.round(clamp(fruitG / 160, 0, 1) * 8);
  addContrib("fruit", "Whole Fruit", "positive", fruitPts, 8, `~${Math.round(fruitG)}g logged`);

  const grainPts = Math.round(clamp(wholeGrainG / 120, 0, 1) * 10);
  addContrib("wholegrains", "Whole Grains", "positive", grainPts, 10, `~${Math.round(wholeGrainG)}g logged`);

  const legPts = Math.round(clamp(legNutG / 80, 0, 1) * 10);
  addContrib("legumes_nuts", "Legumes, Nuts & Seeds", "positive", legPts, 10, `~${Math.round(legNutG)}g logged`);

  const protRichPts = Math.round(clamp((fishG * 1.4 + leanProtG * 0.7 + oilG * 1.2) / 140, 0, 1) * 10);
  addContrib("fish_lean", "Omega-3, Lean Protein & Oils", "positive", protRichPts, 10, "Whole protein & healthy fats");

  // Explicit Fibre Scoring (never penalizes null fibre as 0!)
  const kcal = totals.calories ?? 0;
  const fibreG = totals.fibreG;
  const fibreTargetG = macroTargets.fibreG;
  let fibreSubscore: number | null = null;
  if (fibreG != null) {
    // Scale expected fibre softly if early in the day, or against full daily target once >= 55% target kcal logged
    const progressFactor = targetCalories > 0 ? clamp(Math.max(0.45, kcal / targetCalories), 0.45, 1) : 1;
    const expectedFibre = Math.max(6, fibreTargetG * progressFactor);
    const targetPct = clamp(fibreG / expectedFibre, 0, 1.15);

    const carbsG = totals.carbsG;
    const carbToFibreRatio = carbsG != null && fibreG > 0 ? round1(carbsG / fibreG) : null;
    const ratioScore = carbToFibreRatio == null
      ? 72
      : carbToFibreRatio <= 5
        ? 100
        : carbToFibreRatio <= 8
          ? 85
          : carbToFibreRatio <= 12
            ? 65
            : 40;

    fibreSubscore = clamp(Math.round(targetPct * 72 + (ratioScore / 100) * 28), 10, 100);
    const fibreContribPts = Math.round((fibreSubscore / 100) * 15);
    addContrib(
      "fibre",
      "Fibre Intake",
      "positive",
      fibreContribPts,
      15,
      `${round1(fibreG)} / ${fibreTargetG}g${unknownFibreCount ? ` (${unknownFibreCount} item missing)` : ""}`,
    );
  }

  // Protein alignment score
  let proteinSubscore: number | null = null;
  if (totals.proteinG != null && macroTargets.proteinG > 0) {
    const pFactor = targetCalories > 0 ? clamp(Math.max(0.45, kcal / targetCalories), 0.45, 1) : 1;
    const expectedProt = Math.max(20, macroTargets.proteinG * pFactor);
    proteinSubscore = clamp(Math.round((totals.proteinG / expectedProt) * 90 + (protRichPts > 0 ? 10 : 0)), 15, 100);
    const protPts = Math.round((proteinSubscore / 100) * 10);
    addContrib("protein", "Protein Balance", "positive", protPts, 10, `${round1(totals.proteinG)} / ${macroTargets.proteinG}g`);
  }

  // Negative contributors
  const upfShare = kcal > 0 ? upfKcal / kcal : 0;
  const upfPenalty = Math.round(clamp(upfShare * 22, 0, 16));
  addContrib("upf", "Ultra-Processed (NOVA 4)", "negative", -upfPenalty, 16, `${Math.round(upfShare * 100)}% of kcal`);

  const sugarShare = kcal > 0 ? sugarKcal / kcal : 0;
  const sugarPenalty = Math.round(clamp(sugarShare * 25, 0, 15));
  addContrib("sugar", "Excess / Added Sugars", "negative", -sugarPenalty, 15, `${Math.round(sugarShare * 100)}% of kcal`);

  const meatRiskG = procMeatG * 1.8 + Math.max(0, redMeatG - 90) * 0.6;
  const meatPenalty = Math.round(clamp(meatRiskG / 120, 0, 1) * 10);
  addContrib("meat", "Processed / Excess Red Meat", "negative", -meatPenalty, 10, procMeatG > 0 ? `~${Math.round(procMeatG)}g processed` : `~${Math.round(redMeatG)}g red meat`);

  const alcoholShare = kcal > 0 ? alcoholKcal / kcal : 0;
  const alcoholPenalty = Math.round(clamp(alcoholShare * 28, 0, 10));
  addContrib("alcohol", "Alcohol", "negative", -alcoholPenalty, 10, `${Math.round(alcoholKcal)} kcal`);

  const satSodiumPenalty = Math.min(8, satSodiumFlags * 3);
  addContrib("sat_sodium", "Sat. Fat / Sodium", "negative", -satSodiumPenalty, 8, `${satSodiumFlags} dense item(s)`);

  // Blend into Bevel-style 0-100 Score
  const avgItemQuality = totalWeight > 0 ? weightedItemScore / totalWeight : 62;
  const aheiPoints = vegPts + fruitPts + grainPts + legPts + protRichPts - upfPenalty - sugarPenalty - meatPenalty - alcoholPenalty - satSodiumPenalty;
  const qualitySubscore = clamp(Math.round(avgItemQuality * 0.55 + (52 + aheiPoints) * 0.45), 5, 100);

  let balanceSubscore = 78;
  if (kcal > 0 && targetCalories > 0) {
    const calRatio = kcal / targetCalories;
    if (calRatio > 1.25) balanceSubscore -= Math.min(35, Math.round((calRatio - 1.25) * 80));
    if (totals.fatG != null && totals.fatG * 9 / Math.max(1, kcal) > 0.55) balanceSubscore -= 12;
  }
  balanceSubscore = clamp(balanceSubscore - Math.round(satSodiumPenalty * 1.5), 15, 100);

  // Weighted composite: Food Quality 45%, Fibre 25% (or redistributed if fibre unknown), Protein 20%, Balance 10%
  let wSum = 0.45 + 0.10;
  let weighted = qualitySubscore * 0.45 + balanceSubscore * 0.10;
  if (fibreSubscore != null) {
    wSum += 0.25;
    weighted += fibreSubscore * 0.25;
  }
  if (proteinSubscore != null) {
    wSum += 0.20;
    weighted += proteinSubscore * 0.20;
  }

  const finalScore = clamp(Math.round(weighted / wSum), 1, 100);
  const wholeFoodPct = totalWeight > 0 ? Math.round((wholeNovaWeight / totalWeight) * 100) : null;
  const ultraProcessedPct = kcal > 0 ? Math.round((upfKcal / kcal) * 100) : null;
  const unlockThreshold = Math.min(250, Math.round(targetCalories * 0.25));
  const locked = kcal < unlockThreshold;
  const carbToFibreRatio = totals.carbsG != null && fibreG != null && fibreG > 0 ? round1(totals.carbsG / fibreG) : null;

  contributors.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return {
    score: finalScore,
    grade: scoreToGrade(finalScore),
    locked,
    coverage: locked ? "early" : "confident",
    qualitySubscore,
    fibreSubscore,
    proteinSubscore,
    balanceSubscore,
    wholeFoodPct,
    ultraProcessedPct,
    fibreG,
    fibreTargetG,
    carbToFibreRatio,
    unknownFibreCount,
    contributors: contributors.slice(0, 6),
  };
}
