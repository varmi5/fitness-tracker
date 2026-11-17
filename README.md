# MCP Logger

A private, mobile-first nutrition, energy balance, and body measurement tracker. Log meals and body measurements, connect two-way Google Health (Fitbit Air) for TDEE, steps, and weight sync, and connect ChatGPT via an OAuth-protected MCP endpoint at `/mcp` for photo meal logging. Start with an owner account in closed signup mode.

## Run locally

1. Install Node.js 24 and make a PostgreSQL database available.
2. Run `npm ci` and copy `.env.example` to `.env`. Set the database URL and use separate random values for the auth secret and setup code. Use at least 24 printable ASCII characters for the setup code without outer whitespace.
3. Run `npm run db:migrate` and `npm run dev`. Open `http://localhost:3000/setup`.

`npm test` runs the signup, data isolation, nutrition, MCP, and Google Health tests using an embedded PostgreSQL engine. `npm run build` produces the production app and service worker. Run `npm run test:smoke` after building to exercise the production server and migrations.

- [Coolify setup](docs/coolify-setup.md)
- [Apple Health companion architecture](docs/apple-health-companion.md)
- [ChatGPT MCP skill](skills/fitness-nutrition-mcp/SKILL.md)
- [Checklist for opening to others](docs/open-to-others.md)
