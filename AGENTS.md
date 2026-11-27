# Agents & Contributors Engineering Guide

This file documents the architecture, invariants, and verification commands for **FitnessTrackr** so AI coding agents and human contributors can safely navigate and modify the repository.

## Stack

- **Framework:** Next.js 16 (App Router, `output: "standalone"`) + React 19 + TypeScript (`strict`) + Tailwind CSS 4
- **Database:** PostgreSQL + Drizzle ORM (`lib/schema.ts`, `migrations/*.sql`)
- **Auth:** Better Auth + `@better-auth/oauth-provider` + `@better-auth/passkey` (`lib/auth.ts`, `lib/runtime.ts`)
- **AI Integration:** Streamable HTTP MCP server (`@modelcontextprotocol/sdk`) at `app/mcp/route.ts` backed by `lib/mcp-tools.ts`
- **Testing:** Node built-in test runner via `tsx --test` + in-memory/embedded PostgreSQL (`@electric-sql/pglite`) + end-to-end standalone server smoke tests (`tests/smoke.mjs`, `tests/mobile-smoke.mjs`)

## Repository Map

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router pages, client views (`dashboard.tsx`, `home-view.tsx`, `nutrition-view.tsx`, `training-view.tsx`, `measurements-view.tsx`, `physique-checkin-view.tsx`, `data-sources-view.tsx`, `settings-view.tsx`, `onboarding-wizard.tsx`) and API routes (`app/api/**`, `app/mcp/`, `app/oauth/`, `app/.well-known/`) |
| `components/` | Shared UI primitives, Lucide/custom icons, Bevel-style cards, and SVG muscle map (`anatomy-paths.ts`, `muscle-map-svg.tsx`) |
| `lib/` | Core domain engines (`nutrition-data.ts`, `nutrition-model.ts`, `nutrition-score.ts`, `pulse-engine.ts`, `pulse-data.ts`, `strain-engine.ts`, `strain-data.ts`, `training-load.ts`, `muscle-map.ts`, `source-priority.ts`), integrations (`google-health.ts`, `hevy.ts`, `open-wearables.ts`), auth/security (`auth.ts`, `oauth-state.ts`, `mcp-config.ts`, `mcp-tools.ts`, `instance-config.ts`), and `schema.ts` |
| `migrations/` | Numbered additive SQL migrations (`000-*.sql` .. `027-*.sql`), applied cleanly and idempotently on startup via `scripts/migrate.mjs` |
| `data/` | Bundled UK CoFID reference food dataset |
| `plugins/mcp-logger/` & `skills/` | Bundled ChatGPT / agent plugin package (`scripts/build-plugin.py --check` validates sync against `lib/mcp-tools.ts` and `public/icon-512.png`) |
| `scripts/` | Build/runtime scripts (`migrate.mjs`, `service-worker.ts`, `set-password.ts`, `google-meals.ts`, `build-plugin.py`) |
| `tests/` | PGlite unit/integration tests (`*.test.ts`), full standalone smoke suite (`tests/smoke.mjs`), and headless mobile UI smoke suite (`tests/mobile-smoke.mjs`) |
| `docs/` | Deployment, integration, architecture, and audit notes |

## Architectural & Security Invariants

1. **Strict per-user isolation:** Every database read, write, deletion, MCP call, webhook, and IndexedDB cache key must be scoped strictly to the authenticated `userId`.
2. **Server-authoritative checks:** Validate every API body, OAuth callback state (`lib/oauth-state.ts`), webhook signature, and MCP tool argument (`zod`) on the server.
3. **Encrypted integration credentials:** Third-party OAuth tokens and web-push subscriptions are sealed per-user with AES-256-GCM (`FITNESS_INTEGRATION_KEY`). Never log or expose tokens.
4. **End-to-end encrypted Physique check-ins:** Physique photos, notes, and check-in measurements are encrypted client-side in `app/physique-crypto.ts` before upload; the server stores ciphertext and non-sensitive sorting metadata only.
5. **No invented health numbers:** Missing sleep stages, missing days, or absent HR intervals remain `unknown` / excluded rather than being backfilled with `0`.
6. **Env-driven instance identity:** Never hardcode personal domains, personal emails, or verification tokens in application code. Read them from `lib/instance-config.ts` or dedicated env vars.
7. **Database migrations:** Never rewrite already-merged SQL files in `migrations/`; always add the next numbered `0xx-*.sql` file cleanly and keep migrations idempotent where practical.
8. **Plugin package sync:** If you add/remove MCP tools in `lib/mcp-tools.ts`, change plugin skills/manifests, or change `public/icon-512.png`, run `npm run plugin:build` and verify `npm run plugin:check` passes.

## Required Verification Commands

Run these before opening a pull request:

```bash
npm run plugin:check   # validates plugins/mcp-logger/, skills/, and public/fitnesstrackr-plugin.zip (Linux/macOS python3)
npm test               # runs all tests/*.test.ts against embedded PGlite (no external Postgres needed)
npx tsc --noEmit       # TypeScript type check
npm run build          # builds SW, worker scripts, and Next.js standalone bundle
npm run test:smoke     # boots .next/standalone server against PGlite and exercises signup, auth, APIs & OAuth/MCP
```
