import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type AuthDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface AuthConfig {
  baseURL: string;
  secret: string;
  mode: string;
  setupCode?: string;
  sendEmail?: (to: string, subject: string, text: string) => Promise<void>;
}

export function createAuth(db: AuthDatabase, config: AuthConfig, creatingOwner = false, allowMemberSignup = false) {
  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, disableSignUp: !creatingOwner && !allowMemberSignup,
      requireEmailVerification: config.mode !== "closed",
      sendResetPassword: config.sendEmail ? ({ user, url }) => config.sendEmail!(user.email, "Reset your Fitness password", url) : undefined },
    emailVerification: config.sendEmail ? {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: ({ user, url }) => config.sendEmail!(user.email, "Verify your Fitness email", url),
    } : undefined,
    plugins: [passkey({ rpName: "Fitness", rpID: new URL(config.baseURL).hostname, origin: new URL(config.baseURL).origin })],
    session: { expiresIn: 90 * 86400, updateAge: 86400 },
    advanced: {
      useSecureCookies: new URL(config.baseURL).protocol === "https:",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
    },
    disabledPaths: config.mode === "closed" ? ["/request-password-reset", "/reset-password", "/send-verification-email"] : [],
    rateLimit: {
      enabled: true,
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
      },
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "member", input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!creatingOwner) return allowMemberSignup ? { data: { ...user, role: "member" } } : false;
            return { data: { ...user, role: "owner" } };
          },
        },
      },
    },
  });
}
