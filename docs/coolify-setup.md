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

## Open Wearables beta pairing

Set these runtime variables on the FitnessTrackr application in Coolify.

| Name | Purpose |
|---|---|
| `OPEN_WEARABLES_API_URL` | HTTPS API origin for your Open Wearables instance |
| `OPEN_WEARABLES_API_KEY` | API key from the same instance for user provisioning and syncing |
| `OPEN_WEARABLES_DEVELOPER_EMAIL` | Email for a dedicated Open Wearables developer account on that instance |
| `OPEN_WEARABLES_DEVELOPER_PASSWORD` | Password for that account, stored as a server-side secret |

The last two variables let FitnessTrackr authenticate at the invitation endpoint, which expects a developer session. Create the account on your own Open Wearables instance. Keep both credentials in Coolify. Restart or redeploy FitnessTrackr after changing the runtime variables, then generate a code from **Settings → Wearables → Get code**. Confirm an iPhone can redeem it with the Host URL shown.

## Password recovery

In the Fitness application terminal, run `node scripts/set-password.mjs <email>`. Enter the new password at the hidden prompt. Existing sessions are revoked. For a source checkout, use `npx tsx scripts/set-password.ts <email>`.

## Backups and recovery

Coolify manages two database backups. The FitnessTrackr PostgreSQL dump contains application data. The Coolify instance dump contains Coolify projects, settings, and saved credentials. Code and build images are available through GitHub and GHCR.

Use these settings for the two schedules.

| Backup | Where to manage it | Schedule | Retention |
|---|---|---|---|
| FitnessTrackr data | `fitness-postgres` → **Backups** | Daily at 02:00 (`0 2 * * *`) | 14 local copies and up to 30 remote copies or 1 GB |
| Coolify instance settings | **Settings → Backup** | Daily at midnight (`0 0 * * *`) | Keep local copies and up to 30 remote copies or 1 GB |

Times follow the timezone shown in each schedule. The remote destination is **Cloudflare R2 backups** in Coolify **Storage**, backed by a private R2 Standard bucket. In each schedule, enable S3, select that destination, and keep the local copy. Configure the instance schedule through **Settings → Backup → Configure backup** if it has not been created yet. Coolify prunes remote copies when either retention threshold is reached. [Coolify backup settings](https://coolify.io/docs/databases/backups) · [R2 connection settings](https://coolify.io/docs/core/s3-storage/r2)

After creating or changing either schedule, select **Back up now**, check that the execution succeeds, and verify the new object in R2. Coolify retention runs after uploads. R2 Standard's free allowance is shared across the Cloudflare account, and budget alerts notify you about spending. [R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)

### Save the recovery keys

On the Ubuntu VM that hosts Coolify, run:

```bash
sudo grep '^APP_KEY=' /data/coolify/source/.env
```

Store the full line in a password manager outside the NAS. Coolify needs the original key to decrypt credentials in its restored instance database. Keep a separate secure backup of Coolify's SSH keys under `/data/coolify/ssh/keys/` and the applicable `~/.ssh/authorized_keys` for recovery to a replacement server. Keep these values and files out of Git. [Coolify instance backup](https://coolify.io/docs/core/backup-and-recovery/instance-backup) · [Coolify instance recovery](https://coolify.io/docs/core/backup-and-recovery/instance-restore)

### Recover after losing the NAS or VM

1. Download both database dumps directly from R2. Have the saved Coolify `APP_KEY`, SSH keys, and the original Coolify version ready.
2. Follow the [Coolify instance restore guide](https://coolify.io/docs/core/backup-and-recovery/instance-restore) on the replacement host. Verify that Coolify can decrypt its settings and validate the server connection.
3. Follow the [database restore guide](https://coolify.io/docs/databases/restore) to import the FitnessTrackr dump into a PostgreSQL target. Confirm the application's database URL and original runtime secrets, then redeploy and verify sign-in and existing data.

Test the FitnessTrackr restore from an R2 copy into a disposable database before relying on it for recovery. Back up any other app databases or persistent volumes separately.
