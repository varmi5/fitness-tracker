# Contributing to FitnessTrackr

Thanks for checking out **FitnessTrackr**! Contributions, bug reports, documentation improvements, and ideas are very welcome — especially as we polish self-hosting and multi-wearable support.

## Where Help Is Most Needed

- **Non-UK food databases:** Currently bundled with UK CoFID + Open Food Facts search. Support for USDA FoodData Central or regional tables would help users outside the UK.
- **Wearable & device testing:** Testing real exports and sync edge cases across Google Health (Fitbit), Garmin, Oura, WHOOP, Apple Health (Open Wearables), and Hevy.
- **UI/UX & accessibility polish:** Mobile viewport testing, keyboard navigation, and localization improvements.
- **Self-hosting guides:** Reverse-proxy examples (Caddy, Nginx, Traefik) alongside Docker Compose & Cloudflare Tunnels.
- **Bug reports & docs:** Reproducible bug reports and clearer setup guides.

## Local Development Workflow

1. **Fork** this repository and create a branch from `main` (`git checkout -b fix/my-change`).
2. **Install dependencies** (requires **Node.js 24**):
   ```bash
   npm ci
   ```
3. **Run tests** (no external PostgreSQL needed — uses embedded PGlite):
   ```bash
   npm test
   ```
4. **Build & run the end-to-end smoke suite**:
   ```bash
   npx tsc --noEmit
   npm run build
   npm run test:smoke
   ```
5. If you run the dev server locally (`npm run dev`), copy `.env.example` to `.env`, configure a PostgreSQL `DATABASE_URL`, set `BETTER_AUTH_SECRET` (`>= 32` chars) and `SETUP_CODE` (`>= 24` chars), and run `npm run db:migrate`.

## Pull Request Expectations

- **No unapproved SQL or schema changes:** Do not modify `migrations/` or `lib/schema.ts` in pull requests without opening an Issue and discussing it with `@varmi5` first (automated PR checks block schema edits unless the maintainer applies the `allow-schema-change` label).
- Keep PRs focused and well-tested; add or update tests under `tests/` for behaviour changes.
- Preserve per-user data isolation, server-side input validation, and existing security headers/CSP rules in `proxy.ts` and `next.config.ts`.
- Never commit `.env*` files, personal domains, API keys, or private test fixtures.
- If your change modifies MCP tools in `lib/mcp-tools.ts`, skills, or plugin manifests, rebuild/verify the plugin package with `npm run plugin:build` and `npm run plugin:check`.
- See `AGENTS.md` for architecture notes and invariants.

All contributions are licensed under the repository's **GNU AGPL-3.0** license (`LICENSE`).
