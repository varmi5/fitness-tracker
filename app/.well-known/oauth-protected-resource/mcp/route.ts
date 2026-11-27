import { mcpResource, scopes } from "../../../../lib/mcp-config";
import { getAuthConfig } from "../../../../lib/runtime";

export function GET() {
  const config = getAuthConfig();
  if (!config.mcpEnabled) return new Response(null, { status: 404 });
  const mcpOrigin = config.mcpBaseURL ?? config.baseURL;
  return Response.json({
    resource: mcpResource(mcpOrigin),
    authorization_servers: [new URL(mcpOrigin).origin],
    scopes_supported: scopes,
    bearer_methods_supported: ["header"],
  });
}
