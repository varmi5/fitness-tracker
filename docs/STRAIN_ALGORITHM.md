# FitnessTrackr — Strain, Cardio Load, Muscular Load & Walking Algorithm Specification

> Historical specification. The current `strain-v3.0-evidence` and sleep/readiness changes are documented in [metrics-methodology.md](metrics-methodology.md). Superseded percentages, statuses and fallback assumptions below are not the current implementation.

**Algorithm Version:** `strain-v1.0-provisional`  
**Status:** Implemented (`lib/strain-engine.ts`, `lib/training-load.ts`, `lib/recovery-insights.ts`, `app/training-view.tsx`)

> **Disclaimer:** Overall Strain, Cardio Load, Muscular Load, and Recovery insights are transparent exertion and training-load estimates designed for personal trend tracking. They are **not** medically validated measures of physiological fatigue, readiness, or injury risk.

---

## 1. Design Principles

1. **Explainable & Deterministic:** Every 0–100 Overall Strain score stores its algorithm version, user settings snapshot, raw component workloads (`C_raw`, `M_raw`, `walkingPoints`), normalized inputs (`c`, `m`, `c_walk`), and data completeness status.
2. **Missing Data ≠ Zero Exertion:** Unrecorded HR, missing Hevy workouts, or unavailable step-interval attribution are tracked explicitly as `incomplete` / `unavailable` rather than silently treated as `0`.
3. **No Double-Counting:**
   - Verified exercise steps (from matched Google Health / Hevy workout windows) are subtracted before evaluating daily walking excess.
   - Strain and calorie expenditure (`daily_energy.total_kcal`) remain strictly separate; exercise calories are never double-counted in energy balance.
4. **Recovery Independence:** Recovery metrics (sleep, RHR, HRV) never artificially penalise or inflate the Strain score for performing a given workout.

---

## 2. Cardiovascular Exertion (`C_raw` — Edwards TRIMP)

Using 5 personalised heart-rate zones based on configurable `maxHrBpm` (or custom zone thresholds; age-based `220 - age` estimates are explicitly labelled as estimates when used):

| Zone | % of Max HR | Weight (`w_z`) |
|---|---|---|
| Zone 1 | 50% – <60% | `1` |
| Zone 2 | 60% – <70% | `2` |
| Zone 3 | 70% – <80% | `3` |
| Zone 4 | 80% – <90% | `4` |
| Zone 5 | ≥90% | `5` |

$$C_{\text{raw}} = \sum_{z=1}^{5} \left( w_z \times \text{minutes\_in\_zone}_z \right)$$

- Durations are computed from timestamped Google Health `heart-rate` samples (capped per-sample delta to avoid inflating across telemetry gaps).
- When timestamped HR samples are unavailable, trustworthy HR-zone duration summaries are used if present; otherwise Cardio Strain is marked `incomplete` / `unavailable`.

---

## 3. Muscular Exertion (`M_raw` — Resistance Training)

Computed from Hevy working sets (warm-up sets contribute `0` or negligible load):

$$M_{\text{raw}} = \sum_{\text{sets}} \left( \text{effort\_weight} \times \text{repetition\_weight} \times \text{set\_type\_weight} \right)$$

- **Set-type weights (configurable, provisional defaults):**
  - `warmup`: `0.0`
  - `normal`: `1.0`
  - `failure`: `1.15` (effort adjustment)
  - `dropset`: `0.75` (discounted weight)
- **Missing RPE:** Uses an explicit provisional assumption (e.g., RPE 7.5 / `effort_weight = 0.85`), flagged in activity explainability.
- **Muscle-group attribution:** Each exercise maps to primary (`1.0`) and secondary (`0.5`) muscle groups across:
  `Chest`, `Back`, `Shoulders`, `Biceps`, `Triceps`, `Quads`, `Hamstrings`, `Glutes`, `Calves`, `Core`.

---

## 4. Daily Walking Contribution (Configurable Free-Step Threshold)

- **Default threshold:** `10,500` eligible steps/day (range `0–25,000`, step `500`).
- **Default cap:** `5` Overall Strain points (configurable; sensitivity `Low` / `Normal` / `High`).
- **Workout step exclusion:**
  $$\text{eligibleSteps} = \max(0, \text{totalSteps} - \text{verifiedWorkoutStepsAlreadyCounted})$$
  $$\text{excessSteps} = \max(0, \text{eligibleSteps} - \text{threshold})$$
  $$\text{walkingPoints} = \min\left(\text{maxCap}, \text{maxCap} \times \frac{\text{excessSteps}}{5000}\right)$$
  (Sensitivity scales the `5000` denominator: e.g. Low `7500`, Normal `5000`, High `3500`.)
- **Conversion to normalised cardio input:**
  $$c_{\text{walk}} = -\ln\left(1 - \frac{\text{walkingPoints}}{100}\right)$$
  $$c_{\text{total}} = c + c_{\text{walk}}$$
- When workout-window step attribution is unavailable on a workout day, the walking contribution follows a documented conservative policy (marked `incomplete` / `unavailable` rather than guessing workout steps).

---

## 5. Composite Overall Strain (0–100)

Provisional reference workloads:
- $c = C_{\text{raw}} / 100$
- $m = M_{\text{raw}} / 12$

Combined workload with walking adjustment:
$$W = \left(c_{\text{total}}^{1.3} + m^{1.3}\right)^{1 / 1.3}$$
$$\text{Strain} = 100 \times \left(1 - e^{-W}\right)$$

### Mathematical Guarantees
1. **Bounded:** $\text{Strain} \in [0, 100)$.
2. **Zero baseline:** $C_{\text{raw}} = 0, M_{\text{raw}} = 0, \text{excessSteps} = 0 \implies \text{Strain} = 0$.
3. **Monotonic:** Increasing $C_{\text{raw}}$, $M_{\text{raw}}$, or $\text{excessSteps}$ never decreases $\text{Strain}$.
4. **Diminishing returns:** Approaches 100 asymptotically; higher scores require progressively larger workloads.
5. **Additive attribution for UI explainability:** Using Shapley / proportional log-hazard attribution on $W$ so displayed component point contributions sum cleanly to the displayed Overall Strain.

---

## 6. Long-Term Training Loads (Separate from Capped Strain)

Computed directly from **raw** daily workloads ($C_{\text{raw}}$ and $M_{\text{raw}}$), **not** capped 0–100 Strain:
- **Acute Load (7-day EWMA):** $\lambda_7 = \frac{2}{7 + 1} = 0.25$
- **Chronic Load (42-day EWMA):** $\lambda_{42} = \frac{2}{42 + 1} \approx 0.04651$
- **Cold-start handling:** Initialised cleanly from the first recorded day without treating pre-history days as zero-exertion.
