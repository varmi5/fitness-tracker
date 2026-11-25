# FitnessTrackr metrics accuracy audit — 25 November 2026

Audited repository main `a8c1b6c`, including the new Pulse, training-load, Hevy,
muscle-map and healthspan features. This is a source audit with synthetic probes,
not a validation study against the user's wearable or clinical measurements.
No production formulas, production records or deployments were changed by this audit.

## Main conclusion

Recorded measurements and clearly labelled trends can be useful. The derived
percentages presently contain unsupported defaults and heuristic coefficients;
they must not be represented as measured recovery, muscle repair, illness
probability or biological age. Correct data availability and provenance before
tuning weights or improving the diagram. A realistic-looking body map will not
make its input scores more accurate.

## Confirmed reproductions

The current pure functions were executed with synthetic input:

| Probe | Actual output | Problem |
|---|---|---|
| No sleep, no baseline, RHR 60 only | Recovery 82% | No completed sleep or personal baseline required |
| Respiratory rate 18 only | Recovery 75% | Default subscore becomes a complete recovery score |
| Skin temperature deviation 0 only | Recovery 85% | Same missing-input problem |
| No sleep history | Debt 0h, need 8h | Unknown debt is displayed as no debt |
| 8h sleep, unknown awake time, no stages, one night | Efficiency 100%, sleep score 93 | Missing inputs become favourable defaults |
| One HR sample, no sleep or recovery score | Energy Bank 75%, charged | Invented starting reserve |
| Same exercise/reps/RPE at 10kg and 100kg | Muscular load 0.9 in both cases | Loaded weight is never used |
| Exercise title `Leg Curl` | Biceps primary, Back secondary | Generic curl rule shadows the hamstring rule |
| Unknown exercise | Core primary | Missing mapping invents anatomical attribution |
| Summer sleep ending 06:00 UTC | Recommended wake 06:00 | London would be 07:00; planner uses UTC |
| RHR 60 with no baseline | Nominal, within personal range | No personal range actually exists |

These prove implementation behaviour, not the accuracy of any replacement model.

## Recovery and daily attribution — critical

Code: `lib/pulse-engine.ts:159–300`, `lib/recovery-insights.ts:96–255`,
`lib/pulse-data.ts:154–244`, `app/home-view.tsx:197–206`.

There are two recovery algorithms. Pulse uses weights HRV .55, RHR .20,
sleep .15, respiratory rate .05 and temperature .05; the older algorithm uses
different weights and score thresholds. Missing components are removed and
remaining weights renormalized. A percentage is withheld only when there are
no usable components at all. Population-based fallbacks produce scores before
personal calibration. Baseline status does not gate score availability, and
stale baselines can still be used. Rejecting a hard baseline outlier also resets
the time-since-update counter, making freshness misleading.

Home accepts the older recovery fallback without verifying its day matches the
displayed day, unlike the Pulse path's explicit day check. Cached day switching
therefore deserves a regression test even though it was not reproduced live.
The daily recovery schema does not establish that HRV and RHR came from the same
completed sleep episode. A daily aggregate must not be called an overnight sample
unless the provider actually guarantees that measurement window.

Required behaviour:

- Bind readiness to a completed main sleep session and show its date/wake time.
- A previously completed night's score may remain visible before tonight's sleep,
  but must retain that attribution. Missing new sleep is not a new recovery score.
- Require suitable sleep, HRV and RHR observations and explicit baseline adequacy;
  expose waiting, partial, calibrating, stale and available states separately.
- Remove population defaults from the readiness percentage. Preserve the raw
  readings and say which inputs are missing.
- Use one versioned recovery service across Home, Training, trends and MCP.
- Match HRV method/window/source; do not compare RMSSD and SDNN as equivalent.
- Freeze a completed morning assessment unless its source session is corrected;
  keep tomorrow's scenario forecast separate.

[WHOOP Recovery](https://support.whoop.com/s/article/WHOOP-Recovery?language=en_US)
describes a recovery assessment based on overnight observations.
[Bevel's requirements](https://help.bevel.health/en/articles/11257601) specify
sleep score, HRV, RHR and enough baseline information. These sources do not
provide an exact implementation to copy or validate FitnessTrackr's coefficients.

## Sleep, sleep debt, need and regularity — high priority

Code: `lib/pulse-engine.ts:327–444`, `lib/google-health.ts:1266–1318`.

- Debt is an unweighted sum of `8h - sleepHours` over recorded nights in seven
  calendar days, clipped to 0–6h. Surplus sleep cancels deficits. Missing nights
  disappear; no observations yields 0h. Coverage is not reported alongside debt.
- Need is fixed at 8h plus a strain bump up to .6h plus up to 1h debt allowance.
  The current night's deficit increases the need against which that same night is
  graded. Separate need planned before sleep from debt/need updated after sleep.
- Unknown awake minutes become zero, producing perfect sleep efficiency.
  Missing stage quality gets score 78; missing regularity gets score 75.
- Regularity paints the entire sleep interval as asleep, including awakenings;
  neighbouring-day coverage is inferred from session endpoints. This is not
  sufficient evidence for a fully observed 24-hour sleep/wake SRI.
- The planner reads UTC hours rather than the user's timezone. It lacks explicit
  DST and circular-median handling for night/shift workers.
- The import currently excludes sleeps under 90 minutes and keeps the longest
  session per wake date; naps and split sleep cannot be faithfully credited.

Implement a configurable, historical sleep goal; retain main sleep and naps as
individual sessions; distinguish missing device coverage from confirmed waking;
return debt unknown/partial when appropriate. Reweight a sleep score over known
components with visible confidence instead of filling in favourable values.
Use user-local dates and true timezone conversion. Rename schedule variability
if the data cannot support a real SRI.

[Bevel Sleep Bank](https://help.bevel.health/en/articles/11251073) includes naps,
compares against the user's goal and weights recent days more heavily.
[Bevel Sleep Needed](https://www.bevel.health/blog/the-basics-sleep-needed)
also describes sleep efficiency and recent load. Matching these concepts does
not establish that an independently implemented formula has their accuracy.

## Muscle workload and freshness — critical

Code: `lib/strain-engine.ts:209–272`, `lib/muscle-map.ts`,
`lib/strain-data.ts:127–157`, `lib/training-load.ts:335–375`,
`components/muscle-map-svg.tsx:10–94`.

The implementation is approximately:

```
set load = effortWeight(RPE) × repetitionWeight(reps) × setTypeWeight
muscle load = set load distributed using primary:secondary weights 1:0.5
residual = sum(muscle load × exp(-whole_days_since_training / 1.8))
freshness = round(100 × exp(-residual / 8.5)), bounded to 5–100
```

Only loads within seven days contribute residual fatigue. Unobserved muscles
become 100% fresh, including synthesized frontend entries. No personal training
calibration, soreness, performance, actual elapsed hours or baseline training
tolerance is used. Whole calendar-day decay produces midnight changes rather
than continuous recovery. The constants 1.8 and 8.5 have no validation evidence
in the implementation.

Generic title matching shadows more specific movements: leg curls match biceps,
Romanian deadlifts match the generic deadlift rule, and close-grip bench can match
the generic chest press rule. Unknown movements become Core. Google strength
fallback invents an approximate set count from duration and spreads it over guessed
muscle groups, even assigning a default 45-minute session when duration is missing.
Recorded and inferred loads must be separated in the display.

Weight alone is not a universal fatigue measure: identical RPE at different
absolute weights can represent similar relative effort. But a formula that never
uses weight cannot claim it models `load × reps × RPE`. Use exercise-specific
relative intensity, actual working sets, reps, effort/RIR and available load,
with honest handling of bodyweight, assistance and equipment. Do not replace the
current error with a naive tonnage-only recovery formula.

Use stable exercise IDs and explicit primary/secondary muscle metadata, with
user overrides and an unmapped state. Track muscle groups separately, calibrate
from recorded training exposures, and decay based on actual workout timestamps.
Allow soreness/readiness feedback and show uncertainty. Unknown is not recovered;
an estimate of training fatigue is not a measurement of muscle tissue repair.

[Bevel Muscle Freshness](https://www.bevel.health/vi/blog/the-basics-muscle-freshness)
uses accumulated workload, recovery over time and personal training history. It
describes calibration per muscle with three training days and re-calibration
after an extended gap. It expressly calls freshness an estimate rather than a
direct repair measurement. Its full numerical model is not supplied in the public
explanation reviewed.

## Remaining metrics

| Metric | Finding | Improvement |
|---|---|---|
| Cardio strain/TRIMP | Zone-weighted duration is interpretable, but isolated HR samples get artificial coverage and long gaps are bridged up to three minutes. A single sample marks HR as measured. | Minimum valid coverage, gap-aware integration, duplicates removed, observed vs estimated status. |
| Active Zone Minutes fallback | Converts AZM to raw minutes in zone 2, although weighted activity minutes do not uniquely specify elapsed zone durations. | Keep a separate estimated-load fallback; do not present invented HR zone times. |
| Composite strain | Fixed references 220/18 and nonlinear exponent 1.3 are product choices, not validated WHOOP/Bevel equivalents. | Version and calibrate the heuristic; show coverage and contributors. |
| Walking contribution | Excludes uncertain workout steps conservatively, a good safeguard. Defaults include a 10,500-step threshold. | Explain withheld contribution and distinguish missing wear coverage from rest. |
| Training load/ACWR | Missing/incomplete zero-load days enter the EWMA after initialization. The chronic window adapts from 14 to 42 days and Pulse requests only 28 days of history. | Separate missing from confirmed rest, request adequate history, expose warm-up. Remove diagnostic Overtraining/guaranteed Optimal labels. |
| Strain targets | Arbitrary recovery thresholds and ACWR adjustments inherit upstream score errors. | Withhold personalized prescription when readiness/load is inadequate; label generic guidance clearly. |
| Health monitor | No baseline can still mean in range; an unavailable record has illness risk 0. | Calibrating/unassessed states and deviation descriptions; avoid an illness probability without validated calibration. |
| Energy Bank | Defaults to a 75% peak without sleep or readiness when HR is present. No overnight reset/recharge model and no validation of drain constants. | Null until initialized; separate wake/sleep and wear gaps; identify it as an experimental index. |
| Daytime Stress | HR-only logistic transform; excludes workouts but not sleep or all activity. Duplicated/high-frequency samples accrue a minimum .25 minutes each. | Deduplicate/time-weight real intervals, exclude sleep/activity and quantify coverage. Call HR elevation what it is; do not imply measured psychological stress. |
| Recovery forecast | Hand-tuned sleep/strain adjustments with fixed ±9/14 bands. Caller passes achieved sleep, not a stated plan. Historical baseline slicing is misaligned. | Explicit future scenario input; correctly anchored past-only baselines; no statistical confidence claim before backtesting. |
| Fitness/VO2 percentile | Age/sex reference comparison can be useful; measurement source and exercise protocol affect comparability. | State reference cohort and provider, method and freshness; never manufacture VO2 from no input. |
| Biological age / pace | Custom risk-to-years curves, arbitrary shrink/clamps, incomplete-data “active days”; current SRI copied into historical days. Google and Hevy workouts can be counted twice here despite dedup elsewhere. | Retire the age/pace claim pending validation, or clearly name a nonclinical experimental fitness index. Canonicalize sessions across all features. |
| Habit impact | As few as three observations in each group, shared final-window baseline creates look-ahead for older observations, unknown macros become zero and missing workouts become false. | Complete-observation eligibility, past-only baselines, sample size/uncertainty and association language, not causal improvement claims. |
| Estimated 1RM | Epley estimates include high-rep sets by clipping repetitions to 20 and use broad previous-best logic. | Eligible set/rep limits, effort/context, clear estimated labels and chronological prior-session comparisons. |
| Nutrition Quality Score | Name/ingredient heuristics infer food processing and risk factors; calorie weights fall back to gram quantities. | Explicit classification uncertainty and consistent weighting units; do not present this as a validated dietary-health score. |
| Intake / deficit / measurements | Keep underlying measurements, provenance, unknown nutrients and incomplete-day handling separate from scores. | Audit provider dedup and TDEE-vs-active distinctions wherever new features reuse these records. |

ACWR is not a diagnosis or an individually validated injury predictor; see the
[methodological critique](https://pubmed.ncbi.nlm.nih.gov/32502973/) and
[analysis of modeling limitations](https://pubmed.ncbi.nlm.nih.gov/32125672/).
Consumer sleep-stage uncertainty also limits derived precision; see
[device validation against PSG](https://academic.oup.com/sleep/article/44/5/zsaa291/6055610).

## Muscle diagram

The current component is a hand-authored SVG with ten broad muscle groups. I found
no public evidence identifying Bevel's actual artwork supplier or licence; do
not assume its assets can be extracted or reused.

Candidates for evaluation:

- [Plexapro/react-body-highlighter](https://github.com/Plexapro/react-body-highlighter):
  browser React/SVG, more granular selectable regions; inspect exact asset licensing
  and paths before adoption.
- [HichamELBSI/react-native-body-highlighter](https://github.com/HichamELBSI/react-native-body-highlighter):
  richer SVG anatomy data with a verified MIT licence. For this Next.js PWA, adapt
  permissible path data to browser SVG and preserve attribution, rather than adding
  a native-only component dependency.

Use front/back views, bilateral paths, richer deltoid/back/leg subdivisions and
keyboard/touch-accessible selection. Keep unknown areas neutral. Extra anatomical
detail must not imply the backend distinguishes muscles that the workout mapping
does not actually identify. Prefer lightweight SVG to unnecessary 3D dependencies.

## Implementation order and acceptance criteria

1. **Availability and provenance:** one recovery pipeline, correct completed-sleep
   attribution, no synthetic scores from missing inputs, no uncalibrated “ready”
   muscles, no illness/age certainty. Show source, measured window and freshness.
2. **Sleep:** configurable goal history, session storage including naps, DST/local
   day boundaries, coverage-aware debt and regularity, known-component scoring.
3. **Workouts and muscles:** stable mappings, canonical Google/Hevy sessions,
   qualified load, individual calibration, continuous decay and uncertainty.
4. **Secondary scores:** backtest forecasts and associations; use past-only data;
   remove unsupported medical/biological interpretations.
5. **Anatomy artwork:** integrate licensed browser SVG once the underlying
   states and muscle resolution are correct.

Required regressions: no sleep; incomplete/future sleep; missing HRV/RHR; stale
baseline; unrelated daytime vitals; late sync and corrected sessions; cached day
switching; London DST/travel; naps and split sleep; confirmed rest vs non-wear;
unknown exercise; leg curl/RDL/close-grip bench; bodyweight/assistance; missing
RPE; overlapping Google/Hevy records; sparse/duplicate HR samples; workout end
near midnight; untrained muscle; historical queries without future-data leakage.

Passing existing implementation tests is not evidence that the physiological
model is accurate. Validate calibrated indices prospectively, record algorithm
versions and show the uncertainty of both sensors and derived models.
