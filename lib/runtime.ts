import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createAuth, type AuthConfig } from "./auth";
import { sendEmail, signupMode } from "./signup-config";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDatabase() {
  if (!db) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
    db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), { schema });
  }
  return db;
}

export function getAuthConfig(): AuthConfig {
  const mode = signupMode();
  return {
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET ?? "",
    mode,
    sendEmail: mode === "closed" ? undefined : sendEmail,
    setupCode: process.env.SETUP_CODE,
  };
}

let auth: ReturnType<typeof createAuth> | undefined;
export function authConfigured() {
  const secret = process.env.BETTER_AUTH_SECRET;
  return Boolean(process.env.DATABASE_URL && secret && secret.length >= 32 && !/placeholder|changeme/i.test(secret));
}

export function getAuth() {
  return auth ??= createAuth(getDatabase(), getAuthConfig());
}
