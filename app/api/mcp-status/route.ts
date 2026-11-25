import { mcpMealLoggingAuthorised } from "../../../lib/mcp-connection-status";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../lib/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!authConfigured()) return Response.json({ connected: false }, { status: 503, headers });
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return Response.json({ connected: false }, { status: 401, headers });
  return Response.json({ connected: getAuthConfig().mcpEnabled && await mcpMealLoggingAuthorised(getDatabase(), session.user.id) }, { headers });
}
