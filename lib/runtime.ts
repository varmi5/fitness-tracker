import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createAuth, type AuthConfig } from "./auth";
import { sendEmail, signupMode } from "./signup-config";
import * as schema from "./schema";

const globalRuntime = globalThis as typeof globalThis & {
  __fitnessDb?: ReturnType<typeof drizzle<typeof schema>>;
  __fitnessAuth?: ReturnType<typeof createAuth>;
};

export function getDatabase() {
  if (!globalRuntime.__fitnessDb) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
    const max = Number(process.env.PG_POOL_MAX ?? 10);
    globalRuntime.__fitnessDb = drizzle(
      new Pool({
        connectionString: process.env.DATABASE_URL,
        max: Number.isFinite(max) && max > 0 ? max : 10,
      }),
      { schema },
    );
  }
  return globalRuntime.__fitnessDb;
}

export function getAuthConfig(): AuthConfig {
  const mode = signupMode();
  return {
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET ?? "",
    mode,
    mcpEnabled: process.env.FITNESS_MCP_ENABLED === "true",
    sendEmail: mode === "closed" ? undefined : sendEmail,
    setupCode: process.env.SETUP_CODE,
  };
}

export function authConfigured() {
  const secret = process.env.BETTER_AUTH_SECRET;
  return Boolean(process.env.DATABASE_URL && secret && secret.length >= 32 && !/placeholder|changeme/i.test(secret));
}

export function getAuth() {
  return (globalRuntime.__fitnessAuth ??= createAuth(getDatabase(), getAuthConfig()));
}
