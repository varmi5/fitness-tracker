import { notFound } from "next/navigation";
import { getAuthConfig } from "../../../lib/runtime";
import { Login } from "../../login";

export const dynamic = "force-dynamic";

export default function OAuthLogin() {
  const config = getAuthConfig();
  if (!config.mcpEnabled) notFound();
  return <Login signup={false} oauth />;
}
