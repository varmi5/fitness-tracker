export const MUSCLE_GROUPS = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Core",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface MuscleMapping {
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
}

const KEYWORD_RULES: { match: RegExp; mapping: MuscleMapping }[] = [
  // Chest
  { match: /\b(bench press|chest press|incline.*press|decline.*press|pec deck|chest fly|dumbbell fly|cable fly|push[\s-]?up|dip)\b/i, mapping: { primary: ["Chest"], secondary: ["Triceps", "Shoulders"] } },
  // Back
  { match: /\b(pull[\s-]?up|chin[\s-]?up|lat pulldown|pulldown|barbell row|dumbbell row|cable row|seated row|t-bar row|pendlay|face pull|shrug|back extension)\b/i, mapping: { primary: ["Back"], secondary: ["Biceps", "Shoulders"] } },
  { match: /\b(deadlift)\b/i, mapping: { primary: ["Back", "Hamstrings", "Glutes"], secondary: ["Quads", "Core"] } },
  // Shoulders
  { match: /\b(overhead press|shoulder press|military press|arnold press|lateral raise|front raise|rear delt|upright row|ohp)\b/i, mapping: { primary: ["Shoulders"], secondary: ["Triceps"] } },
  // Biceps
  { match: /\b(bicep|biceps|curl|hammer curl|preacher curl|concentration curl|ez bar curl)\b/i, mapping: { primary: ["Biceps"], secondary: ["Back"] } },
  // Triceps
  { match: /\b(tricep|triceps|pushdown|skullcrusher|skull crusher|overhead extension|close[\s-]?grip bench)\b/i, mapping: { primary: ["Triceps"], secondary: ["Chest", "Shoulders"] } },
  // Quads
  { match: /\b(squat|leg press|leg extension|lunge|split squat|bulgarian|hack squat|goblet|step[\s-]?up)\b/i, mapping: { primary: ["Quads", "Glutes"], secondary: ["Hamstrings", "Core"] } },
  // Hamstrings
  { match: /\b(romanian deadlift|rdl|stiff[\s-]?leg|leg curl|hamstring|good morning)\b/i, mapping: { primary: ["Hamstrings"], secondary: ["Glutes", "Back"] } },
  // Glutes
  { match: /\b(hip thrust|glute bridge|kickback|abductor|adductor)\b/i, mapping: { primary: ["Glutes"], secondary: ["Hamstrings", "Quads"] } },
  // Calves
  { match: /\b(calf|calves|calf raise|seated calf|standing calf)\b/i, mapping: { primary: ["Calves"], secondary: [] } },
  // Core
  { match: /\b(plank|crunch|sit[\s-]?up|leg raise|hanging knee|ab wheel|pallof|russian twist|cable crunch|core)\b/i, mapping: { primary: ["Core"], secondary: [] } },
];

export function resolveExerciseMuscles(
  exerciseTitle: string,
  overrides?: Record<string, MuscleMapping>,
): MuscleMapping {
  const key = exerciseTitle.trim().toLowerCase();
  if (overrides && overrides[key]) return overrides[key];
  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(exerciseTitle)) return rule.mapping;
  }
  // Conservative fallback for unrecognized strength exercises
  return { primary: ["Core"], secondary: [] };
}

export function distributeMuscleLoad(
  workload: number,
  mapping: MuscleMapping,
): Record<MuscleGroup, number> {
  const out = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;
  if (!(workload > 0)) return out;

  const entries: { group: MuscleGroup; weight: number }[] = [
    ...mapping.primary.map((group) => ({ group, weight: 1.0 })),
    ...mapping.secondary.map((group) => ({ group, weight: 0.5 })),
  ];
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight <= 0) return out;

  for (const e of entries) {
    out[e.group] += (workload * e.weight) / totalWeight;
  }
  return out;
}
