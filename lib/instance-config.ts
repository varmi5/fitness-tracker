export interface InstanceConfig {
  publicOrigin: string;
  mcpUrl: string;
  operatorName: string;
  supportEmail: string;
  hostingLocation: string;
}

function resolveOrigin(raw?: string): string {
  const value = raw?.trim();
  if (!value) return "http://localhost:3000";
  try {
    return new URL(value).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export function getInstanceConfig(): InstanceConfig {
  const publicOrigin = resolveOrigin(process.env.BETTER_AUTH_URL);
  return {
    publicOrigin,
    mcpUrl: `${publicOrigin}/mcp`,
    operatorName: process.env.APP_OPERATOR_NAME?.trim() || "the instance operator",
    supportEmail: process.env.APP_SUPPORT_EMAIL?.trim() || process.env.EMAIL_FROM?.trim() || "",
    hostingLocation: process.env.APP_HOSTING_LOCATION?.trim() || "a self-hosted server",
  };
}
