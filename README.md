# Fitness

A private, mobile-first measurement tracker. Log measurements and notes, compare weekly changes, chart trends, and export or delete your data. Start with an owner account in closed signup mode.

## Run locally

1. Install Node.js 24 and make a PostgreSQL database available.
2. Run `npm ci` and copy `.env.example` to `.env`. Set the database URL and use separate random values for the auth secret and setup code. Use at least 24 printable ASCII characters for the setup code without outer whitespace.
3. Run `npm run db:migrate` and `npm run dev`. Open `http://localhost:3000/setup`.

`npm test` runs the signup, data isolation, and calculation tests using an embedded PostgreSQL engine. `npm run build` produces the production app and service worker. Run `npm run test:smoke` after building to exercise the production server and migrations. The worker caches static build assets. Measurements and authenticated responses require a connection.

- [Coolify setup](docs/coolify-setup.md)
- [Checklist for opening to others](docs/open-to-others.md)
