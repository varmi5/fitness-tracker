import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { authConfigured, getAuth, getAuthConfig } from "../../../lib/runtime";

export function GET(request: Request) {
  if (!authConfigured() || !getAuthConfig().mcpEnabled) return new Response(null, { status: 404 });
  return oauthProviderAuthServerMetadata(
    getAuth() as unknown as Parameters<typeof oauthProviderAuthServerMetadata>[0],
  )(request);
}
