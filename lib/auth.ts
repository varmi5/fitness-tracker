import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { allowedMcpCallback, mcpResource, scopes } from "./mcp-config";
import * as schema from "./schema";

export type AuthDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface AuthConfig {
  baseURL: string;
  secret: string;
  mode: string;
  mcpEnabled?: boolean;
  setupCode?: string;
  sendEmail?: (to: string, subject: string, text: string) => Promise<void>;
}

export function createAuth(db: AuthDatabase, config: AuthConfig, creatingOwner = false, allowMemberSignup = false) {
  const mcpActive = Boolean(config.mcpEnabled && !creatingOwner && !allowMemberSignup);
  const resource = mcpResource(config.baseURL);
  const oauthPlugins = [
    jwt({ jwt: { issuer: new URL(config.baseURL).origin } }),
    oauthProvider({
      loginPage: "/oauth/login",
      consentPage: "/oauth/consent",
      scopes: [...scopes, "offline_access"],
      resources: [{ identifier: resource, allowedScopes: scopes }],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultResources: [resource],
      clientRegistrationDefaultApplicationType: "infer",
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: 600,
      validateRedirectUri: (uri, _registered, valid) => valid && allowedMcpCallback(uri),
    }),
  ] as const;

  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, disableSignUp: !creatingOwner && !allowMemberSignup,
      requireEmailVerification: config.mode !== "closed",
      sendResetPassword: config.sendEmail ? ({ user, url }) => config.sendEmail!(user.email, "Reset your FitnessTrackr password", url) : undefined },
    emailVerification: config.sendEmail ? {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: ({ user, url }) => config.sendEmail!(user.email, "Verify your FitnessTrackr email", url),
    } : undefined,
    plugins: [
      passkey({ rpName: "FitnessTrackr", rpID: new URL(config.baseURL).hostname, origin: new URL(config.baseURL).origin }),
      ...(mcpActive ? oauthPlugins : []),
    ],
    session: { expiresIn: 90 * 86400, updateAge: 86400 },
    advanced: {
      useSecureCookies: new URL(config.baseURL).protocol === "https:",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
    },
    disabledPaths: ["/token", ...(config.mode === "closed" ? ["/request-password-reset", "/reset-password", "/send-verification-email"] : [])],
    rateLimit: {
      enabled: true,
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
        "/oauth2/register": { window: 60, max: 8 },
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
            // The one-time owner setup code is the credential for this account.
            return { data: { ...user, role: "owner", emailVerified: true } };
          },
        },
      },
    },
  });
}
