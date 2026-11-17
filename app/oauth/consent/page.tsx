import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { scopes } from "../../../lib/mcp-config";
import { getAuth, getAuthConfig, getDatabase } from "../../../lib/runtime";
import { oauthClient } from "../../../lib/schema";
import { ConsentForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Consent({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  if (!getAuthConfig().mcpEnabled) notFound();
  const viewer = await getAuth().api.getSession({ headers: await headers() });
  const query = await searchParams;
  if (!viewer || typeof query.client_id !== "string" || typeof query.scope !== "string" || typeof query.sig !== "string") {
    notFound();
  }
  const [client] = await getDatabase().select({ name: oauthClient.name }).from(oauthClient)
    .where(eq(oauthClient.clientId, query.client_id));
  if (!client) notFound();
  const requested = query.scope.split(" ").filter((entry) => scopes.includes(entry));
  return <main className="auth-card">
    <h1>Connect MCP Logger</h1>
    <p>Signed in as {viewer.user.email}</p>
    <p>{client.name || "The connected app"} is requesting access to MCP Logger:</p>
    <ul>
      {requested.includes("fitness:read") && <li>Read your food diary, energy expenditure, and body measurements.</li>}
      {requested.includes("fitness:write") && <li>Log, edit, and delete meals.</li>}
    </ul>
    <p>Data read by the connected app is shared with that app. You can revoke access anytime in MCP Logger settings.</p>
    <ConsentForm />
  </main>;
}
