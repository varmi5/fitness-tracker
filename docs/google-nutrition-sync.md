# Google Health meal sync

Each account uses its own encrypted Google grant. Reconnect with write permissions only
if Settings says **Write Meals needs reconnect**. Required scope:
`https://www.googleapis.com/auth/googlehealth.nutrition.writeonly`.
That permission supports reading back the app's own nutrition records; no broader access
is needed for upload verification.

In Settings → Google Health, **Sync Now** retries pending/failed writes and queues local
meals from the last 14 days. **Backfill all meals** includes all local history up to today,
in pages of 100. Neither exports imported health records. Explicit requests work even in
manual tracking mode; automatic writes still require the user's Google/two-way settings.
The background worker checks every 15 seconds and retries failed writes with backoff.
Do not disable `FITNESS_BACKGROUND_WORKER` on the deployed web process.

“Queued” means accepted locally, not uploaded. A meal is **verified in Google** only after
a GET returns the expected time, category, name, calories and known macronutrients/fibre.
Settings refreshes outstanding sync status every five seconds while visible. Errors name
the failing operation, HTTP status and safe Google field names; provider response bodies,
food descriptions and tokens are not put in server logs.

Anonymous logs omit `serving`: Google rejects `{amount: 1}` without its required catalogue
food measurement unit. Calories use `energy.kcal`; carbohydrate and fat use their dedicated
gram fields; protein and available fibre use `PROTEIN` and `DIETARY_FIBER`. Unknown values
remain absent, never fabricated as zero. Values retain one decimal place.

IDs contain the local meal UUID and a content/wire-format hash. Retries reuse the same ID.
Anonymous Google logs cannot be edited in place, so edits create and read back a replacement
before deleting the previous record. Delete jobs survive local meal deletion, remove only
record IDs tracked for that meal/account, and verify Google returns 404 afterward.
Failed or uncertain operations retain their references for retries rather than dropping
the job or blindly creating another record.

For an authorised operator inside the app container, `node scripts/google-meals.mjs
--account=GOOGLE_ACCOUNT_EMAIL` is a read-only, uniquely-account-scoped dry run. Add `--apply`
to backfill/retry that account, or `--verify` to GET and compare every synced nutrition record.
It prints counts/status only and never grants account privileges or prints credentials.

Migration `014-google-nutrition-verification.sql` adds provenance and verification timestamps.
Existing `import:` records are marked imported and their upsert jobs paused; no meal, item,
or health history is removed. Imports retain Google source IDs and skip known local exports.
Exports and account deletion continue to use existing per-user services.

Deploy using the existing main-branch GitHub Actions pipeline. Migrations run transactionally
on container startup. Roll back the image if necessary and leave these additive columns in
place; do not reverse migrations or delete historical records. Reverting to an older image
also restores the original invalid serving payload and retry bug.

Tests: `tests/google-nutrition-sync.test.ts` plus `tests/user-features.test.ts` exercise
read-back, all five nutrients, errors, retries, consent, user isolation, backfill, import-loop
prevention, stable IDs, lost responses, replacements and deletion. Live provider verification
is separate from synthetic tests. Delivery from Google into Apple Health/Bevel depends on
the user's existing third-party integration and is not verified by a Google API read-back.

Google references: [Nutrition guide](https://developers.google.com/health/data-types/nutrition),
[create](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/create),
[DataPoint](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints).
