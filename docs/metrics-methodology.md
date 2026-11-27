# Metric definitions and limits

Updated 25 November 2026. This supersedes the pre-fix findings in
[metrics-accuracy-audit-2026-11-25.md](metrics-accuracy-audit-2026-11-25.md).
These changes improve implementation correctness and transparency; they are
not a clinical validation study or a reproduction of Bevel/WHOOP proprietary scores.

## Sleep and readiness

- `sleep_session` preserves individual main sleeps, naps, split sleeps, estimated
  deep/REM/light/awake totals, provider processing state and timestamped stage
  intervals when available. Stable provider IDs (or normalised intervals) make
  retries/corrections idempotent. `daily_sleep` is maintained as a compatible main
  session view; existing records are migrated additively, never discarded.
- Google stage summaries use `type`, not just legacy `stage`. Explicit provider
  main/nap flags take precedence. Without those flags, the longest eligible
  session per local wake date is the main-session heuristic; classification
  provenance is returned. Sessions below 90 minutes without a provider main flag
  remain secondary sessions. This threshold is not a physiological definition.
- Only completed, processed sessions with valid timestamps and plausible duration
  enter scoring. Overlapping observations are conservatively selected once,
  prioritising a main/longer session; raw overlapping observations remain available
  for inspection. Session presence does not prove full-day wear coverage.
- Stage totals remain provider estimates, not polysomnography. Unknown stages,
  awake time, latency or continuity stay unknown. A time interval alone does not
  establish time asleep. Inconsistent component totals are excluded from scores.
- `sleep-v2-experimental`: duration/goal capped at 100%; if valid awake time is
  available, the descriptive index is 80% duration and 20% sleep efficiency.
  Without awake time or full interval accounting (within two minutes of rounding), the index is duration only, with component coverage returned. Unclassified/restless/latency minutes never inflate efficiency.
  No universal ideal deep/REM ratio is assumed. The app does not fabricate an SRI
  from session endpoints that cannot establish sleep/wake epochs.
- Historical `sleep_goal` rows belong to each user and apply from their effective
  date. The initial planning default is 480 minutes, configurable from 240–720.
  This is a preference, not a measured physiological sleep requirement.
- Seven-day observed shortfall is max(0, sum(goal minus observed sleep per observed
  local date)), including non-overlapping naps once. Dates without a completed main sleep are excluded (a nap alone cannot establish an overnight shortfall);
  no observations means null. Coverage remains partial without explicit complete
  wear coverage. It is not an assertion of total physiological sleep debt.
- The planner uses circular local wake-time history and the user's IANA timezone,
  including Europe/London daylight saving changes. It does not mix UTC clock time
  with local time or use today's deficit to inflate the goal for grading that night.
- `readiness-v2-experimental` requires the selected date's completed main sleep,
  valid HRV and resting HR, and at least four qualifying prior nights for personal
  HRV/RHR baselines. Calibrating, stale and missing states are explicit. Historical
  baselines use only preceding dates. Legacy recovery consumers delegate to the
  same numeric engine. The composite weights remain an experimental app index,
  not measured recovery or a proven recommendation to train.
- Google daily vitals do not establish that every reading was collected during
  the same sleep interval. Overnight physiological standardisation remains a
  provider-data limitation. HRV comparisons should use a consistent method/device.

## Training, anatomy and other estimates

- `strain-v3.0-evidence` invalidates older cached strain values. Edwards-style HR
  load integrates adjacent observed samples only, excludes large telemetry gaps,
  deduplicates timestamps, and discloses estimated maximum HR. One reading does
  not establish elapsed activity. Custom 0–100 transformations remain heuristics.
- Strength estimates use exercise-specific prior-session strength references,
  relative effort, reps and set types. Maximum-rep extrapolation is withheld above
  ten reps. Unknown exercise names remain unmapped. Workout titles/duration alone
  never become invented sets, weights or muscle activation.
- Google/Hevy matched sessions are not summed twice. Walking exclusions use the
  union of workout intervals so overlapping workouts do not duplicate steps and
  disjoint workouts do not omit exclusions. Prorating sparse step intervals is
  still an estimate, not measured step-by-step activity.
- Missing workout days are not confirmed rest. Load comparisons describe recent
  versus longer-term observed load, not an injury/overtraining diagnosis.
- Anatomy displays observed per-muscle training history, exact elapsed hours and
  personally calibrated relative loads. Tissue-recovery percentages are unavailable:
  sets and timestamps cannot establish actual tissue repair. Unknown muscles never
  default to 100% recovered. Artwork provenance: [MIT licence](anatomy-asset-license.md).
- HR elevation and Energy Bank are explicitly estimates, with sparse/gapped,
  sleeping and workout samples handled conservatively. Missing inputs do not create
  a default 75% reserve. Health-monitor observations do not provide an illness
  probability. Biological age, pace of ageing and forecast confidence bands are
  withheld because their previous heuristic mappings were not validated.
- Food-quality scores are versioned heuristics with metadata coverage. Known calories alone provide a consistent weighting basis; missing kcal is never replaced by grams or an arbitrary minimum. Ingredient mass is never invented from calories or millilitres. Incomplete fibre/protein totals and their subscores remain null. Missing nutrition is not zero,
  unknown intake is not displayed as 0 kcal, historical calorie targets are dated,
  and chart axes distinguish weight kg, waist cm, fibre grams and score units.

## MCP and data lifecycle

`get_health_history` uses the existing `fitness:read` permission. It returns
sleep sessions, main/nap classification provenance, stage summaries, completeness,
source, sync time, historical goals, vitals and workouts. Use
`includeStageIntervals: true` for detailed stage timings for at most 31 days;
ordinary requests omit verbose intervals. Missing data does not establish no sleep
or no workout. The public MCP URL and OAuth configuration are unchanged:
`https://<your-domain>/mcp`.

Export includes raw sessions/goals. Account deletion cascades to owned rows;
Google disconnect removes only that user's Google-origin sessions. A successful
complete Google sync reconciles corrections and deleted provider sessions within
its date range; failed upstream reads retain previous good records. Previously
lost naps/stages require another successful Google historical sync to be recovered.

Migration 021 is additive. Normal deployment runs it through the existing migration
runner. For rollback, redeploy the prior image while retaining the new tables and
original daily_sleep data; do not drop data tables to roll code back. A database
backup exists in Coolify; restore testing remains separate work.

## Sources and validation boundaries

- [Google Health Sleep schemas](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints)
  define stagesSummary.type, metadata.mainSleep/nap/processed and stage intervals.
- [Bevel recovery requirements](https://help.bevel.health/en/articles/11258177)
  explain morning scoring and consistent overnight HRV; no public formula validates
  our weights or permits claims of equivalence.
- [Bevel metric definitions](https://help.bevel.health/en/articles/11251073)
  include naps in sleep-bank calculations and distinguish active from total energy.
- [Wearable sleep device evaluation against PSG](https://academic.oup.com/sleep/article/44/5/zsaa291/6055610)
  supports treating consumer sleep estimates and sleep-stage outputs with uncertainty.
- [ACWR methodological limitations](https://pubmed.ncbi.nlm.nih.gov/32502973/)
  preclude presenting a workload ratio as an individual injury prediction.

Synthetic tests cover calculation invariants, missingness, timezone/DST, completed
sleep requirements, source/user isolation, raw-session persistence and correction,
provider reconciliation, workload mapping and anatomy accessibility. They verify
software behaviour, not real-world clinical accuracy. Authenticated wearable
comparisons and expert validation remain unperformed.
