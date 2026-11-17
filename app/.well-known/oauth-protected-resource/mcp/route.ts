import { mcpResource, scopes } from "../../../../lib/mcp-config";
import { getAuthConfig } from "../../../../lib/runtime";

export function GET() {
  const config = getAuthConfig();
  if (!config.mcpEnabled) return new Response(null, { status: 404 });
  return Response.json({
    resource: mcpResource(config.baseURL),
    authorization_servers: [new URL(config.baseURL).origin],
    scopes_supported: scopes,
    bearer_methods_supported: ["header"],
  });
}
