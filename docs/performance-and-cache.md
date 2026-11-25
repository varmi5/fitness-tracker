# Startup, diary caching and deployments

The root document is a generic shell. Health data comes from the authenticated,
private, no-store `/api/bootstrap` endpoint. On reopening, the client first checks
the Better Auth session, then displays that account's saved snapshot while
refreshing it. A network connection is still needed to verify identity on a cold
launch: this is not unrestricted offline sign-in. Transient bootstrap failures
leave saved data visible with a retry action.

IndexedDB holds up to 180 visited dates plus the startup snapshot, with a 12 MiB
JSON content budget. Dates can be arbitrarily old; the 180-entry limit is not a
server-side history cutoff. Least recently used dates are evicted first; entries
unused for 30 days expire. Browser storage eviction or private browsing can remove
local copies. Server records remain the source of truth. The cache stores no
passwords, OAuth tokens or provider credentials. It is cleared on sign-out,
authentication failure and account deletion; switching accounts removes other
accounts' cached copies. A failed startup refresh is shown with a retry action.

After startup, the dashboard warms today and the previous seven dates. It
reads saved snapshots first, fetches any missing or stale diaries, then fetches
health metrics separately. Revisiting a loaded date uses its snapshot
immediately. Fresh results are reused for one minute for today and five minutes
for older dates. Stale results refresh in the background. Confirmed writes
and remote updates expire the relevant snapshots.
Mutations still require an online confirmed server write. A cached date is never
presented as confirmation of a new write.

Quick Log uses Radix Dialog for focus containment and dismissal. The compact
picker contains actions, not a nested form. Food search opens its own full-height
composer; saved foods, workout actions and measurements use full-height screens.
VisualViewport changes resize the active screen above the keyboard. Only the
ChatGPT control uses connection colours; the central plus remains neutral.
Connection status checks live consent, scopes, revocation, session validity and
client status. It reports server authorisation, not ChatGPT service availability.

GitHub Actions tests and builds once, then `Dockerfile.release` packages the tested
Next.js standalone output. The original Dockerfile is retained for source-based
builds. Release packaging omits a second `npm ci` and Next.js build. npm, Next.js
and Docker Buildx caches are reused between runs. Source edits still produce a new
immutable image and run required validation; they do not require rebuilding all
unchanged dependencies.

The inspected Coolify server already had daily cleanup enabled, deletion of unused
volumes/networks disabled, retained-image protection enabled, and the FitnessTrackr
application configured to retain two images. These server-wide settings were not
changed. A busy deployment day can still accumulate images before midnight. If
needed, the owner can change **Servers → localhost → Docker Cleanup** to an hourly
schedule (`0 * * * *`), keeping volume/network deletion off and retained-image
protection on. Do not disable rollback protection or prune volumes to solve image
growth. Monitor actual disk usage after deployments.
