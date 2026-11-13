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

## Password recovery

In the Fitness application terminal, run `node scripts/set-password.mjs <email>`. Enter the new password at the hidden prompt. Existing sessions are revoked. For a source checkout, use `npx tsx scripts/set-password.ts <email>`.
