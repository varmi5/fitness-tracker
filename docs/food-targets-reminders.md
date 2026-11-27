# Food, target and reminder deployment

Migrations 007–010 add portions, private favourites/custom foods, provider caching, Google meal
outbox, historical macro targets and phone reminder settings. Existing meals and measurements stay intact.
CoFID provenance and the import command are in data/README.md. Public brand search uses the
Open Food Facts Search-a-licious service with debounce, caching, quotas and local fallback.

Runtime environment:
- VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY: generated Web Push keypair. Keep stable after subscriptions exist.
- VAPID_SUBJECT: mailto:support@fitnesstrackr.example.
- BETTER_AUTH_SECRET: also derives the push-subscription encryption key; rotation requires re-enrolling devices.
- GOOGLE_HEALTH_CLIENT_ID / GOOGLE_HEALTH_CLIENT_SECRET / FITNESS_INTEGRATION_KEY (64 hex characters):
  required before Google Health can connect. Redirect URI: https://fitnesstrackr.example/api/integrations/google/callback.
- FITNESS_BACKGROUND_WORKER=false disables the 15-second outbox/reminder worker; default enabled.

Google integration uses current Google Health v4, never legacy Fitbit/Fit REST. Each user must
connect their eligible Google account. Read-only scopes are requested initially; explicit write
consent adds nutrition.writeonly and health_metrics_and_measurements.writeonly. Turn on two-way
sync in that user's Settings to queue website and MCP meal writes. Pending is not a successful
Google save. Replacements confirm the new record before deleting the old record; deterministic
IDs and persistent retry references prevent duplicate retry writes. Disconnect clears queued
writes and local Google-derived energy; already-written Google records are managed in Google.

Macro energy uses 4 kcal/g protein, 4 carbs and 9 fat. Rebalance preserves protein and fibre,
allocates the remaining calorie budget between carbs/fat and saves all targets under an effective
date. Historical views resolve the target for that date. These are configurable estimates.

Deploy via push to main and the existing GitHub Actions/Coolify pipeline. Migrations run before
app start. For rollback, redeploy the previous image; additive tables/nullable columns can remain.
Do not remove production tables or data to roll back UI changes.

Checks: unit/integration tests, production build, OAuth HTTP smoke test, mobile/desktop UI smoke.
Real Google credentials/account eligibility and actual iPhone notification permission/delivery
require external verification. Test fixtures never enter production.
