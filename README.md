# FitnessTrackr

A self-hosted, mobile-first **nutrition, energy balance, recovery, workout, and body measurement tracker** built with Next.js, PostgreSQL, Better Auth, and an OAuth-protected **ChatGPT MCP server**.

Designed to run in a single Linux Docker container on your own hardware alongside PostgreSQL, with no cloud SaaS subscriptions or telemetry SDKs.

## Features

- **Nutrition & Food Logging:** Daily calorie, protein, carb, fat, and fibre tracking with dated targets, homemade batch recipes, reusable meals, barcode scanning, **2,887 UK CoFID reference foods**, and optional **Open Food Facts** branded search.
- **ChatGPT AI Meal & Health Coach (`/mcp`):** OAuth 2.1 Streamable HTTP MCP server so you can estimate meals from photos, log or edit meals, and ask about nutrition, trends, sleep, and workouts directly in ChatGPT.
- **Wearable Sync & Readiness / Strain:** Connects to **Google Health (Fitbit / Fitbit Air)**, **Hevy** (OAuth or CSV/JSON import), and **Open Wearables** (beta companion for Apple Health, Health Connect, Garmin, Oura, WHOOP) to track TDEE, steps, sleep sessions/stages, HRV, resting HR, and an anatomical muscle workload map.
- **End-to-End Encrypted Physique Check-ins:** Browser-encrypted progress photos, pose comparisons, notes, and time-lapse share links (server only stores ciphertext).
- **Privacy & Control:** Per-user data isolation, Passkey + email/password auth, JSON/CSV full account export, account deletion, and opt-in PWA Web Push meal/weigh-in reminders.

---

## How I Run It

My personal production setup runs in a **Linux Docker container** on a home NAS:

1. **Docker + PostgreSQL** managed by **Coolify** on an Ubuntu VM.
2. **Cloudflare Tunnel (`cloudflared`)** exposing the app over HTTPS with zero router port-forwarding.
3. **GitHub Actions** running tests, building the Linux Docker image to **GHCR**, and triggering a Coolify webhook on every push to `main`.
4. **Closed signup mode** (`SIGNUP_MODE=closed`) so only the owner account exists unless explicitly opened.

---

## Quick Start (Linux / Docker Compose)

Runs on any Linux host or VPS with Docker and Docker Compose v2:

```bash
git clone https://github.com/varmi5/fitness-tracker.git
cd fitness-tracker
cp .env.example .env
```

Edit `.env` and fill in at least these values:

```bash
# Generate random secrets on Linux:
openssl rand -hex 24   # -> POSTGRES_PASSWORD (or choose a strong password)
openssl rand -hex 32   # -> BETTER_AUTH_SECRET (must be >= 32 chars)
openssl rand -hex 24   # -> SETUP_CODE (must be >= 24 chars, temporary)
```

Also set in `.env`:
- `POSTGRES_PASSWORD=...`
- `BETTER_AUTH_SECRET=...`
- `SETUP_CODE=...`
- `BETTER_AUTH_URL=https://fitness.example.com` *(or `http://localhost:3000` for local-only testing)*

Start PostgreSQL and FitnessTrackr (database migrations run automatically on startup):

```bash
docker compose up -d
```

Open `http://localhost:3000/setup` (or your `BETTER_AUTH_URL`), create the initial owner account using your `SETUP_CODE`, and then **remove `SETUP_CODE` from `.env`** and recreate the container:

```bash
docker compose up -d
```

> **Production HTTPS note:** Passkeys, PWA push notifications, and ChatGPT OAuth/MCP require HTTPS in production (see the Cloudflare Tunnel section below or use Caddy / Nginx / Traefik in front of port `3000`).

### Updating & Backups

**Update to the latest image** (pending SQL migrations apply automatically before the server starts):

```bash
docker compose pull && docker compose up -d
```

**Back up your PostgreSQL database:**

```bash
docker compose exec postgres pg_dump -U fitness fitness > fitness-backup-$(date +%F).sql
```

---

## How Integrations & Hosting Work

### ChatGPT MCP (`/mcp`)
FitnessTrackr exposes a **Streamable HTTP MCP server** at `https://<your-domain>/mcp` using OAuth 2.1 with Dynamic Client Registration (Better Auth OAuth Provider) and `/.well-known` discovery metadata.
- Set `FITNESS_MCP_ENABLED=true` and `BETTER_AUTH_URL=https://<your-domain>` in `.env`.
- Supported scopes: `fitness:read`, `fitness:write`, `fitness:settings:write`, and `offline_access`.
- Connect from ChatGPT via **Apps / Connectors → Add custom MCP server** (see [docs/chatgpt-connector.md](docs/chatgpt-connector.md) and `skills/fitness-nutrition-mcp/SKILL.md`).
- If submitting to the public OpenAI Plugin Directory, set `OPENAI_APPS_CHALLENGE` to the verification token OpenAI gives you so `/.well-known/openai-apps-challenge` serves it cleanly.

### Cloudflare (Tunnels, Access & Turnstile)
- **Cloudflare Tunnel (`cloudflared`):** Maps your public HTTPS hostname (`fitness.example.com`) straight to `http://localhost:3000` inside your Linux host/VM so you never open inbound firewall ports. Set Cloudflare SSL/TLS mode to **Full (strict)** if your proxy terminates TLS, or terminate TLS at Cloudflare Tunnel → container port `3000` with HTTP-to-HTTPS redirect handled cleanly at the edge.
- **Cloudflare Access:** Put Coolify and internal admin dashboards behind Cloudflare Access (service tokens or identity rules) rather than exposing them publicly; CI can pass `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` when calling the Coolify deploy webhook.
- **Cloudflare Turnstile (optional):** Only needed if you switch `SIGNUP_MODE` to `open` (alongside `RESEND_API_KEY` and `EMAIL_FROM`). Keep `SIGNUP_MODE=closed` for single-user / family self-hosting (`docs/open-to-others.md`).

### Coolify & Linux Container Deploys
The app ships two Dockerfiles:
- [`Dockerfile`](Dockerfile) — builds from source inside Docker (uncomment `build: .` in `docker-compose.yml` if you fork and customize locally).
- [`Dockerfile.release`](Dockerfile.release) — packages the pre-built `.next/standalone` bundle validated in GitHub Actions (used by `.github/workflows/build.yaml`).

On every push to `main`, `.github/workflows/build.yaml` runs plugin checks, tests, TypeScript checks, Next.js build, and the standalone server smoke test, then pushes the Linux image to GHCR and calls the Coolify webhook. Full Coolify setup, environment variables, and R2 backup/restore instructions live in [docs/coolify-setup.md](docs/coolify-setup.md).

### Google Health (Fitbit / Fitbit Air)
Connects two-way nutrition logging, body weight sync, TDEE/steps, sleep sessions (including naps and sleep stages), HRV, resting HR, SpO2, skin temperature, and workouts via Google Health APIs.
1. Set `FITNESS_INTEGRATION_KEY` (`openssl rand -hex 32`) — OAuth tokens are encrypted per-user with **AES-256-GCM**.
2. Create a Google Cloud OAuth Client and add the authorized redirect URI:
   `https://<your-domain>/api/integrations/google/callback`
3. Set `GOOGLE_HEALTH_CLIENT_ID` and `GOOGLE_HEALTH_CLIENT_SECRET` in `.env`.

### Hevy API
Syncs resistance-training workouts (exercises, sets, reps, weights, RPE) and pairs them with wearable heart-rate samples to drive the muscle workload & strain views:
- **Hevy Free users:** Export CSV or JSON from Hevy and upload it directly in **Settings → Hevy Strength Integration** (zero API keys needed).
- **OAuth / webhooks:** Optionally configure `HEVY_CLIENT_ID`, `HEVY_CLIENT_SECRET`, and `HEVY_WEBHOOK_SECRET` in `.env`.

### Open Wearables (Beta)
Integrates with a self-hosted [Open Wearables](https://openwearables.io) companion instance for **Apple Health, Android Health Connect, Garmin, Oura, WHOOP, and Strava** via pairing codes (`OPEN_WEARABLES_API_URL`, `OPEN_WEARABLES_API_KEY`, `OPEN_WEARABLES_DEVELOPER_EMAIL`, `OPEN_WEARABLES_DEVELOPER_PASSWORD`). Leave those blank if you don't run Open Wearables.

---

## Local Development, Making Changes & Testing

Requires **Node.js 24** and `npm`. Tests run against an embedded PostgreSQL engine (`@electric-sql/pglite`), so you don't even need a running Postgres server just to hack and test!

```bash
npm ci
npm test            # runs all tests/*.test.ts with embedded PGlite
npx tsc --noEmit    # strict TypeScript check
npm run build       # builds service worker, helper scripts & Next.js standalone app
npm run test:smoke  # boots production build & tests auth, APIs, and OAuth/MCP end-to-end
```

For interactive local development with a PostgreSQL database:
```bash
cp .env.example .env   # set DATABASE_URL, BETTER_AUTH_SECRET, SETUP_CODE
npm run db:migrate
npm run dev
```

See [AGENTS.md](AGENTS.md) for the codebase map and architectural invariants before making larger changes.

---

## Community & Contributing

Contributions and feedback are very welcome! Areas where community help would have the biggest impact:
- Adding non-UK nutrition datasets (e.g., USDA FoodData Central, EU/regional tables) alongside UK CoFID
- Real-world testing & fixes for wearable exports and sync edge cases (Garmin, Oura, WHOOP, Apple Health, Fitbit)
- Reverse-proxy recipes (Caddy, Nginx, Traefik) and multi-arch ARM64 container verification
- UI/UX accessibility, mobile polish, and documentation improvements

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR, and please report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Documentation Index

- [Architecture & Engineering Guide (for contributors & AI agents)](AGENTS.md)
- [Coolify Deployment, Backups & Recovery](docs/coolify-setup.md)
- [ChatGPT MCP Connector Setup](docs/chatgpt-connector.md)
- [Checklist Before Opening Registration to Other Users](docs/open-to-others.md)
- [Metrics & Strain Methodology](docs/metrics-methodology.md)
- [Feedback Inbox Integrations](docs/feedback.md)
- [Anatomy SVG Licensing Note](docs/anatomy-asset-license.md)

## License

Released under the **GNU Affero General Public License v3.0 (AGPL-3.0)** — see [LICENSE](LICENSE). Notice attribution for third-party anatomy SVG paths in [docs/anatomy-asset-license.md](docs/anatomy-asset-license.md).
