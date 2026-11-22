# Connect FitnessTrackr to ChatGPT

The private Streamable HTTP MCP endpoint is `https://fitness.hadamardsecurities.com/mcp`.
It uses OAuth authorization code flow with PKCE, dynamic client registration, user consent,
short-lived access tokens, and separate `fitness:read` and `fitness:write` permissions.
No password, setup code, API key or deployment secret belongs in the plugin package.

## Activate the server

Set the **application runtime variable** `FITNESS_MCP_ENABLED=true` in Coolify and deploy
through the existing GitHub Actions pipeline. Production activation requires the owner's approval.
Keep `BETTER_AUTH_URL=https://fitness.hadamardsecurities.com`.
The feature is deliberately unavailable (404) until enabled.

After deployment, check that these return 200 with public configuration only:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`

An unauthenticated `POST /mcp` must return 401 with a `WWW-Authenticate` challenge,
and must never return meal data. Normal website sessions do not replace MCP OAuth tokens.

## Add it to your account

Use ChatGPT web or desktop to install the private FitnessTrackr plugin or configure it manually:

1. Open **Plugins**, select **+**, then **Add custom MCP server**.
2. Name it **FitnessTrackr** and enter `https://fitness.hadamardsecurities.com/mcp`.
3. Choose **OAuth** with dynamic/automatic client registration. No pre-issued client secret is needed.
4. Request `fitness:read fitness:write offline_access` for meal logging. For read-only access,
   use `fitness:read` (and optionally `offline_access`). Review the connection warning and create the plugin.
5. Sign in to your existing FitnessTrackr account and review the consent screen.
6. Start a new chat and enable FitnessTrackr. Ask **“What have I eaten today?”** to test a read.
7. To test a write, explicitly request a real meal you want saved. The reply should contain the
   database meal ID and totals. Confirm it appears in your website diary.

Account/workspace policy determines whether custom plugins can be added. If **Add custom MCP server**
is missing, check your workspace permissions; installing a ZIP does not bypass those permissions.

## Use it on iPhone or Android

Use the same ChatGPT account/workspace as the installation. Open a new chat in the mobile app,
open the available plugins/tools, and enable **FitnessTrackr**. A plugin available to your account
can be used on mobile, but creating a raw custom MCP connection is currently web-only.
No separate native bridge, developer certificate or token pasted into your phone is needed.

If it is absent, check the selected account/workspace and update/restart the mobile app. Mobile
availability for this particular account has to be verified by the user; a local server test cannot prove it.

Suggested prompt:

> Use FitnessTrackr. Estimate this meal from my photo and the weights I provide. Search my saved
> recipes first. Include oil and sauces, show an uncertainty range, and log it only when I ask.
> After logging, report the saved meal ID and actual updated totals from the database.

The packaged skill includes retry-safe logging, updates to existing meals, null handling,
and confirmation before deletion. Read totals from the database rather than chat memory.

## Downloadable plugin and Codex

`plugins/mcp-logger/` contains the portable plugin manifest, OAuth MCP connection, skill and icon.
Zip that directory to export it. It contains no credentials or personal meal data.
Saving/installing the package does not activate the production endpoint or authenticate the user.

For Codex CLI, add and authenticate the existing endpoint:

```sh
codex mcp add mcp-logger --url https://fitness.hadamardsecurities.com/mcp
codex mcp login mcp-logger --scopes fitness:read,fitness:write,offline_access
```

## Revoke access

In FitnessTrackr **Settings → ChatGPT Server → Revoke MCP access**, revoke existing consents,
access tokens and refresh tokens. Remove the plugin from ChatGPT if no longer needed.

## Verification and maintenance

`npm run test:smoke` uses a temporary database to test registration, PKCE, consent, token exchange,
and authenticated Streamable HTTP tool discovery and diary retrieval. It never tests against
production health records. `npm test` covers scoped tools, isolated data and nutrition services.

For the mobile logging regressions after `npm run build`:

```sh
npx playwright install chromium webkit
npm run test:ui
```

These automate an iPhone viewport in WebKit and desktop Chrome. They cover suggestions,
portion scaling, 16px controls, dialog bounds, failed-save recovery and navigation overflow.
The physical iPhone keyboard and Safari focus behavior still need an on-device check.

Verified documentation (17 November 2026):

- [Plugins on supported ChatGPT surfaces](https://learn.chatgpt.com/docs/plugins)
- [Connect a custom MCP server](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)

## Version 1.1: personal settings and phone reminders

The server adds `search_foods`, `preview_nutrition_targets`, `get_logging_reminders`,
`set_nutrition_targets` and `set_logging_reminders`. The two settings writes require
**fitness:settings:write** plus **fitness:read** and explicit APPLY confirmation.
Existing tokens are not widened. Refresh/reconnect and grant that permission to use these writes;
ordinary diary reads/writes continue with existing scopes. Updated plugin instructions apply after
the host refreshes the plugin; use a new chat after updating. Each user signs in separately.

Phone reminders are delivered by the installed PWA, not the ChatGPT app. On iPhone, install
from Safari's Add to Home Screen, open the installed app, then enable notifications under Settings.
Installing the plugin alone does not create a ChatGPT scheduled task.

Public connection guide: https://fitness.hadamardsecurities.com/connect
Publisher: Varmisan S. Support: varmisan.work@gmail.com. Personal UK hosting; free service.
The downloadable package can be imported where supported. The account plugin remains private;
public directory approval requires the separate submission workflow and is not completed by hosting a ZIP.


## Repeated sign-in after token expiry

The resource policy must allow `offline_access` as well as fitness scopes, or Better Auth
can issue the initial refresh token but drop renewable access on its first rotation.
Resource seed mode `merge` updates existing deployments as well as new databases.
Refresh tokens are valid for 90 days from issuance or the most recent successful
rotation. Access tokens remain valid for 10 minutes, and the 30-second reuse
window tolerates immediate retries without disabling rotation.
The OAuth smoke test starts from the old persisted policy, refreshes twice, retries each
rotation, and uses the resulting token for authenticated MCP calls.

Users with previously issued broken refresh grants should reconnect their existing ChatGPT
connection once and approve offline access. No reinstall or new account plugin is needed.

## Health conversations (1.1.3)

`get_health_history` reads this user's stored sleep schedules/stages, recovery/vitals and
workouts for an inclusive local date range. It uses the existing `fitness:read` permission;
Home visibility and manual nutrition mode do not block this read. Sync, privacy, export and
deletion controls remain in effect. No provider refresh is performed by this read tool.
Returned sources, sync timestamps and missing-data flags distinguish absent/stale records
from no activity. Recovery/vitals are no longer displayed on Home.

The MCP initialize instructions and tool descriptions are served by the deployed server.
Refresh the existing connection's tools/start a new chat if the host caches them. The website
ZIP also includes the updated sleep/workout skill; update the existing website-installed
plugin to use those packaged instructions. No new plugin identity, client or OAuth scope
is needed for this feature, and no account plugin is created.

## Renewable food logging (1.1.4)

Meal read/write and offline_access are now baseScopes, requested on every connection and
scope-upgrade flow. Settings writes remain optional. Missing/invalid-token challenges
request that same minimum meal bundle rather than unrelated settings-write access.
Invalid credentials are identified as invalid_token so hosts can attempt refresh.

For an existing connection added by MCP URL, keep the URL and reconnect if
prompted. For a plugin installed from a package, use the current website ZIP
if the package still requests the old scopes. When granting access, check
that consent includes “Stay connected using renewable access”. An unexpired
refresh token receives the 90-day lifetime when it next rotates. A grant
without offline_access still requires consent before it can receive a
refresh token.
