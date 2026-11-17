# Deploy Fitness

Deploy by pushing to `main` or running **Test, build and deploy** in GitHub Actions. The workflow tests the code, publishes the commit and latest tags to GHCR, and calls the Coolify API. The Cloudflare Access headers in this workflow apply solely to the Coolify management hostname. The Fitness hostname uses Fitness sessions.

## Before the first deployment

Confirm that Cloudflare uses Full (strict) for the Fitness hostname and that the tunnel origin supports it. Set the database URL and both authentication values in Coolify before running the workflow.

## Coolify resources

Use the `fitness-tracker` project and its production environment. In that project, keep the `fitness-postgres` database private. The Docker Image application pulls `ghcr.io/varmi5/fitness-tracker:latest`, exposes port 3000, and uses the HTTPS Fitness domain with HTTP-to-HTTPS redirect disabled, a 1 CPU limit, and a 1g memory limit.

Set these in the application’s **Environment Variables** as runtime variables.

| Name | Where it comes from |
|---|---|
| `DATABASE_URL` | The database’s **General → Internal URL** field |
| `BETTER_AUTH_URL` | The public HTTPS Fitness origin |
| `BETTER_AUTH_SECRET` | A securely generated, private value of at least 32 characters |
| `SIGNUP_MODE` | Closed for owner-only use |
| `SETUP_CODE` | A separate random value of at least 24 characters |

After reaching the setup page on HTTPS, create the owner and remove `SETUP_CODE` from Coolify. Fitness permanently retires the code on successful owner creation. The container applies pending database migrations on start when `DATABASE_URL` is configured.

Configure Actions repository secrets named `COOLIFY_WEBHOOK`, `COOLIFY_TOKEN`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET`.

## Optional ChatGPT MCP & Google Health (Fitbit Air) variables

Add these runtime variables in Coolify when ready to enable the private ChatGPT MCP connector and Google Health sync:

| Name | Purpose |
|---|---|
| `FITNESS_MCP_ENABLED` | Set to `true` to expose `/mcp` and OAuth 2.1 endpoints |
| `GOOGLE_HEALTH_CLIENT_ID` | OAuth Client ID from Google Cloud with Google Health API enabled |
| `GOOGLE_HEALTH_CLIENT_SECRET` | OAuth Client Secret from Google Cloud |
| `FITNESS_INTEGRATION_KEY` | 64-hex-character key (`openssl rand -hex 32`) for AES-256-GCM token encryption |

Authorized Google OAuth redirect URI: `https://<your-fitness-domain>/api/integrations/google/callback`.

## Password recovery

In the Fitness application terminal, run `node scripts/set-password.mjs <email>`. Enter the new password at the hidden prompt. Existing sessions are revoked. For a source checkout, use `npx tsx scripts/set-password.ts <email>`.
