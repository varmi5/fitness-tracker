# Apple Health Companion Architecture (HealthKit)

Browser JavaScript inside a mobile PWA cannot directly access Apple HealthKit (`HKHealthStore`). To support Apple Health alongside Google Health (Fitbit Air) and manual entry, Fitness treats `apple` as a first-class `daily_energy` provider (`source = 'apple'`) fed by a lightweight native Swift/SwiftUI iOS companion app.

## 1. Required HealthKit Permissions (Read-Only)
Request authorization for these four `HKQuantityType` identifiers:
- `HKQuantityTypeIdentifier.activeEnergyBurned` (kcal)
- `HKQuantityTypeIdentifier.basalEnergyBurned` (kcal)
- `HKQuantityTypeIdentifier.stepCount` (count)
- `HKQuantityTypeIdentifier.bodyMass` (kg)

## 2. Deduplication & Correct Calorie Accounting
Never sum raw `HKSample` records directly (multiple devices such as iPhone + Apple Watch write overlapping intervals). Instead:
1. Use `HKStatisticsCollectionQuery` anchored to midnight in the user's local calendar (`Calendar.current.startOfDay(for:)`), with `intervalComponents = DateComponents(day: 1)` and `.cumulativeSum` for energy and steps. HealthKit automatically deduplicates overlapping sources according to the user's Apple Health priority order.
2. Read daily `activeEnergyBurned` and `basalEnergyBurned` separately:
   - `totalKcal = basalEnergyBurned + activeEnergyBurned` (only when **both** are present for the day; if basal is missing, report `totalKcal = null` and send `activeKcal` alone so basal metabolism is never under-counted or fabricated).
   - Never add `basalEnergyBurned` onto a third-party `totalKcal` that already includes resting energy.
3. For `bodyMass`, query the latest `HKQuantitySample` per local calendar day in `HKUnit.gramUnit(with: .kilo)`.

## 3. Sync Endpoint & Payload Contract
Authenticate via a Better Auth session or scoped `fitness:write` OAuth token and post daily aggregates to `POST /api/nutrition` (`action: "energy"`) with:
```json
{
  "action": "energy",
  "data": {
    "source": "apple",
    "day": "2026-11-17",
    "totalKcal": 2240,
    "activeKcal": 490,
    "steps": 9420,
    "weightKg": 74.2,
    "complete": true
  }
}
```

## 4. Current Web / PWA Fallback
Until you build and sign the Swift companion app in Xcode with an Apple Developer provisioning profile:
- Use **Settings → Health Integrations → Manual Expenditure / Apple Health Fallback** in the Fitness web app to enter or JSON-import daily TDEE, active calories, steps, and weight.
- If you also use a Fitbit Air, **Google Health** is the primary automated integration and requires no iOS build.
