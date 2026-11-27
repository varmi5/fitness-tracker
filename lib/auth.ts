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
  allowedOrigins?: string[];
  mcpBaseURL?: string;
  secret: string;
  mode: string;
  mcpEnabled?: boolean;
  setupCode?: string;
  sendEmail?: (to: string, subject: string, text: string) => Promise<void>;
}

export function createAuth(db: AuthDatabase, config: AuthConfig, creatingOwner = false, allowMemberSignup = false) {
  const mcpActive = Boolean(config.mcpEnabled && !creatingOwner && !allowMemberSignup);
  const primaryOrigin = new URL(config.baseURL).origin;
  const allowedOrigins = config.allowedOrigins?.length
    ? [...new Set([primaryOrigin, ...config.allowedOrigins])]
    : [primaryOrigin];
  const allowedHosts = [...new Set(allowedOrigins.map((o) => new URL(o).host))];
  const mcpOrigin = new URL(config.mcpBaseURL ?? config.baseURL).origin;
  const resource = mcpResource(mcpOrigin);
  const oauthPlugins = [
    jwt({ jwt: { issuer: mcpOrigin } }),
    oauthProvider({
      loginPage: "/oauth/login",
      consentPage: "/oauth/consent",
      scopes: [...scopes, "offline_access"],
      // Preserve offline access through resource-scoped refresh-token rotation.
      resources: [{ identifier: resource, allowedScopes: [...scopes, "offline_access"] }],
      resourceSeedMode: "merge",
      // Parallel host requests may retry the same rotated token briefly.
      refreshTokenReuseInterval: 30,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultResources: [resource],
      clientRegistrationDefaultApplicationType: "infer",
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: 600,
      refreshTokenExpiresIn: 90 * 86400,
      validateRedirectUri: (uri, _registered, valid) => valid && allowedMcpCallback(uri),
    }),
  ] as const;

  return betterAuth({
    baseURL:
      allowedOrigins.length > 1
        ? {
            allowedHosts,
            protocol: new URL(config.baseURL).protocol === "https:" ? "https" : "http",
            fallback: config.baseURL,
          }
        : config.baseURL,
    trustedOrigins: allowedOrigins,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, disableSignUp: !creatingOwner && !allowMemberSignup,
      revokeSessionsOnPasswordReset: true,
      requireEmailVerification: config.mode !== "closed",
      sendResetPassword: config.sendEmail ? ({ user, url }) => config.sendEmail!(user.email, "Reset your FitnessTrackr password", url) : undefined },
    emailVerification: config.sendEmail ? {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: ({ user, url }) => config.sendEmail!(user.email, "Verify your FitnessTrackr email", url),
    } : undefined,
    plugins: [
      allowedOrigins.length > 1
        ? passkey({ rpName: "FitnessTrackr" })
        : passkey({ rpName: "FitnessTrackr", rpID: new URL(config.baseURL).hostname, origin: primaryOrigin }),
      ...(mcpActive ? oauthPlugins : []),
    ],
    session: { expiresIn: 90 * 86400, updateAge: 86400 },
    advanced: {
      useSecureCookies: new URL(config.baseURL).protocol === "https:",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
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
