import { analyzeHeartRateCoverage, getFreshGrant, parseGoogleHeartRate } from "../lib/google-health";
import { getDatabase } from "../lib/runtime";

/**
 * Read-only diagnostic script to verify Google Health timestamped HR access
 * for a workout window (e.g. 2026-11-23T13:42:00Z to 2026-11-23T15:02:00Z).
 * Does NOT log OAuth tokens or raw personal health records.
 *
 * Usage:
 *   npx tsx scripts/verify-google-hr.ts <userId> [startIso] [endIso]
 */
async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Usage: npx tsx scripts/verify-google-hr.ts <userId> [startIso] [endIso]");
    process.exit(1);
  }
  const startIso = process.argv[3] ?? "2026-11-23T13:42:00Z";
  const endIso = process.argv[4] ?? "2026-11-23T15:02:00Z";

  const db = getDatabase();
  const { grant } = await getFreshGrant(db, userId);

  const filter = `heart_rate.sample_time.physical_time >= "${startIso}" AND heart_rate.sample_time.physical_time <= "${endIso}"`;
  for (const family of ["google-wearables", "all-sources"] as const) {
    const url = new URL("https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints:reconcile");
    url.searchParams.set("filter", filter);
    url.searchParams.set("pageSize", "10000");
    url.searchParams.set("dataSourceFamily", `users/me/dataSourceFamilies/${family}`);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${grant.accessToken}` },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });

    if (!res.ok) {
      console.log(JSON.stringify({ family, status: res.status, error: "Request failed" }));
      continue;
    }

    const parsed = parseGoogleHeartRate(await res.json(), "Europe/London", family);
    const report = analyzeHeartRateCoverage(parsed.samples, startIso, endIso);
    console.log(
      JSON.stringify({
        family,
        status: res.status,
        window: { startIso, endIso },
        ...report,
      }),
    );
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Verification failed.");
  process.exit(1);
});
