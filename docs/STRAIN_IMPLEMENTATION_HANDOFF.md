# FitnessTrackr — Bevel-Style Strain, Load, Hevy & Mobile UX Implementation Handoff

## 1. Current State & Stage Status

- **Current Stage:** **Stage 1 — Mobile Usability Fixes (Complete)**
- **Next Stage:** **Stage 2 — Google Health Heart-Rate Ingestion & Parser Fixes**
- **Primary Branch:** `main` (direct-to-main workflow; no feature branches or PRs)
- **Baseline Commit Audited:** `781e529` (`Extend FitnessTrackr OAuth refresh tokens to 90 days`)
- **Stage 0 Commit:** `3d53773`
- **Latest Migrations Applied in Repo:** `001-auth.sql` through `015-google-assigned-references.sql`

---

## 2. Baseline Verification Results (Stage 0)

| Check | Command | Result | Notes |
|---|---|---|---|
| TypeScript | `npx tsc --noEmit` | **PASS (0 errors)** | Verified at `781e529` |
| Unit & Integration Tests | `npm test` | **PASS (53 / 53)** | `tsx --test tests/*.test.ts` |
| Production Build | `npm run build` | Verified in CI | `esbuild` SW/scripts + `next build` |
| Smoke & UI Suites | `npm run test:smoke`, `npm run test:ui` | Verified in prior push | PGlite socket + Playwright iPhone/Desktop |

---

## 3. Repository & Architecture Audit Findings

### 3.1 Existing Core Systems to Reuse
- **Database & Schema (`lib/schema.ts`, `migrations/001`–`015`):** PostgreSQL + Drizzle ORM. Already includes `daily_energy` (with `steps`, `active_zone_minutes`, `distance_meters`, `floors`, `total_kcal`, `active_kcal`, `weight_kg`), `daily_sleep` (with `stages_json`), `daily_recovery` (`resting_hr_bpm`, `hrv_rmssd_ms`, `spo2_pct`, `respiratory_rate`, `skin_temp_delta_c`, `vo2_max`, `body_fat_pct`), `daily_workout` (`session_id`, `source`, `day`, `title`, `exercise_type`, `start_time`, `end_time`, `duration_seconds`, `calories_kcal`, `distance_meters`, `avg_hr_bpm`, `active_zone_minutes`), `health_integration` (AES-256-GCM sealed OAuth tokens via `FITNESS_INTEGRATION_KEY`), and `nutrition_preference`.
- **Google Health v4 Integration (`lib/google-health.ts`):**
  - Currently uses `https://health.googleapis.com/v4/users/me` with scopes `activity_and_fitness.readonly`, `health_metrics_and_measurements.readonly`, `sleep.readonly`, plus optional write scopes.
  - **Verified Issues to Fix in Stage 2:**
    1. `parseGoogleWorkouts()` (`lib/google-health.ts:702-710`) checks `metrics.averageHeartRate?.beatsPerMinute`, `metrics.heartRate?.beatsPerMinuteAvg`, `metrics.averageHeartRateBpm`, etc., **but misses Google's documented `metricsSummary.averageHeartRateBeatsPerMinute` field**.
    2. `fetchRecoveryMetric()` (`lib/google-health.ts:510`) filters using `date >= "${from}" AND date < "${endExclusive}"`; needs verification against Google Health API v4 filter syntax per data type (`civil_start_time` / `interval` vs `date`), and `syncGoogle()` (`lib/google-health.ts:1053,1075,1079`) silently swallows errors with `.catch(() => null)` without surfacing structured sync diagnostics.
    3. Timestamped `heart-rate` (`dataTypes/heart-rate/dataPoints:reconcile`) and timestamped `steps` intervals are not yet ingested. Live API verification against the November 23, 2026 workout (~13:42–15:02 UTC) is scheduled for Stage 2 when authorised OAuth access is available, or documented if OAuth tokens reside only in production.
- **Mobile UI & Notifications (`app/dashboard.tsx`, `app/style.css`):**
  - **Verified Sticky Notification Bug (Stage 1):** `.feedback` in `app/style.css:931-941` uses `position: sticky; bottom: calc(10.7rem + env(safe-area-inset-bottom));` and `message` state in `app/dashboard.tsx:87` has no auto-dismiss timer, no dismiss button, no error vs. success distinction, and persists across tab navigation.
  - **Navigation (`app/dashboard.tsx:31-36`):** Currently 4 tabs (`Home`, `Nutrition`, `Measurements`, `Settings`). In Stage 6, this will evolve to `Home`, `Training`, `Nutrition`, `More` (with `Measurements` and `Settings` accessible inside `More` without losing any existing functionality).
- **Barcode Lookup (`app/meal-composer.tsx`, `app/api/foods/route.ts`, `lib/branded-foods.ts`):**
  - Open Food Facts lookup (`barcodeFood`) is already implemented and cached in `food_provider_cache` with rate limiting in `food_provider_rate`.
  - Stage 1 will add live camera barcode scanning (native `BarcodeDetector` API with `@zxing/browser` / `@zxing/library` fallback) inside `MealComposer`, keeping manual barcode entry intact.
- **Deployment & Environment (`docs/coolify-setup.md`, `.github/workflows/build.yaml`):**
  - Pushing to `origin/main` triggers GitHub Actions (`Test, build and deploy`): `npm ci`, `npm test`, `npm run build`, `npm run test:smoke`, Docker build/push to GHCR, and Coolify webhook deploy.
  - Note: Production environment variables (`DATABASE_URL`, `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET`, `FITNESS_INTEGRATION_KEY`, `COOLIFY_*`) are stored in Coolify / GitHub Secrets and are not present in the local dev sandbox.

---

## 4. Stage Roadmap & Checkpoints

| Stage | Scope | Status |
|---|---|---|
| **Stage 0** | Audit codebase, verify baseline tests, create `STRAIN_IMPLEMENTATION_HANDOFF.md` & `STRAIN_ALGORITHM.md` | **Complete** (`3d53773`) |
| **Stage 1** | Fix sticky food-logging toast notifications + implement live camera barcode scanning + regression tests | **Complete** |
| **Stage 2** | Google Health timestamped HR & step-interval ingestion, fix `averageHeartRateBeatsPerMinute` & recovery/error diagnostics, verify Nov 23 workout | **Next** |
| **Stage 3** | Hevy integration (OAuth if supported for Free, or documented CSV/JSON export/import + sync workflow), workout matching & HR association | Pending |
| **Stage 4** | Core Strain Engine (Edwards TRIMP, Muscular Load, muscle mappings, nonlinear Overall Strain, walking threshold/cap, per-user settings, explainability, versioning) | Pending |
| **Stage 5** | Long-term Cardio Load & Muscular Load (7-day & 42-day EWMAs, muscle-group histories, progression, data-quality handling) | Pending |
| **Stage 6** | Training tab, Daily Strain Breakdown, activity/HR/walking detail views, redesigned Home cards, responsive UI tests | Pending |
| **Stage 7** | Recovery integration (sleep, RHR, HRV, completeness/confidence, separated from Strain) | Pending |
| **Stage 8** | Full verification (`npm test`, `npm run build`, `npm run test:ui`, `npm run test:smoke`), security & deployment check | Pending |

---

## 5. Environment & Coolify Notes

- **Existing Variables (Reused, Values Never Logged):**
  - `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `SIGNUP_MODE`, `FITNESS_MCP_ENABLED`
  - `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET`, `FITNESS_INTEGRATION_KEY`
- **Potential Future Variables (Only if needed in Stage 3+):**
  - `HEVY_CLIENT_ID`, `HEVY_CLIENT_SECRET`, `HEVY_WEBHOOK_SECRET` (only if Hevy developer OAuth/webhooks are supported for Hevy Free; otherwise per-user import/export requires zero new env vars).
  - All Strain, HR zone, and walking threshold settings will live in PostgreSQL per-user tables (`training_preference` / `strain_settings`), **not** environment variables.

---

## 6. Agent Takeover Instructions

1. `git fetch origin main && git status` — ensure local `main` is fast-forwarded to `origin/main`.
2. Read `docs/STRAIN_IMPLEMENTATION_HANDOFF.md` and `docs/STRAIN_ALGORITHM.md`.
3. Resume from the **Next Stage** listed in Section 1.
4. After completing each stage: run `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run test:smoke`, and `npm run test:ui`; update both docs; commit and push directly to `origin/main`.
