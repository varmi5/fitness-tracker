import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mcpIdentity } from "../../lib/mcp-auth";
import { fitnessMcp } from "../../lib/mcp-tools";
import { authConfigured, getAuthConfig } from "../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  if (!authConfigured() || !getAuthConfig().mcpEnabled) return new Response(null, { status: 404 });

  const origin = request.headers.get("origin");
  if (origin && ![new URL(getAuthConfig().baseURL).origin, "https://chatgpt.com"].includes(origin)) {
    return new Response(null, { status: 403 });
  }

  const identity = await mcpIdentity(request);
  if (identity instanceof Response) return identity;

  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  // Ensure Accept includes application/json & text/event-stream for strict SDK header checks.
  const headers = new Headers(request.headers);
  if (!headers.get("accept")?.includes("application/json")) {
    headers.set("accept", "application/json, text/event-stream");
  }
  const normalizedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    // @ts-expect-error duplex required by Node Fetch when forwarding ReadableStream bodies
    duplex: "half",
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = fitnessMcp(identity.userId, identity.scopes);
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(normalizedRequest);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await server.close();
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
