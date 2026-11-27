import { mcpResource } from "./mcp-config";
import { getMcpPublicOrigin, getPrimaryOrigin } from "./origins";

export interface InstanceConfig {
  publicOrigin: string;
  mcpUrl: string;
  operatorName: string;
  supportEmail: string;
  hostingLocation: string;
}

export function getInstanceConfig(): InstanceConfig {
  const publicOrigin = getPrimaryOrigin();
  return {
    publicOrigin,
    mcpUrl: mcpResource(getMcpPublicOrigin()),
    operatorName: process.env.APP_OPERATOR_NAME?.trim() || "the instance operator",
    supportEmail: process.env.APP_SUPPORT_EMAIL?.trim() || process.env.EMAIL_FROM?.trim() || "",
    hostingLocation: process.env.APP_HOSTING_LOCATION?.trim() || "a self-hosted server",
  };
}
