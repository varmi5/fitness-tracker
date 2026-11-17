export const readScope = "fitness:read";
export const writeScope = "fitness:write";
export const settingsScope = "fitness:settings:write";
export const scopes = [readScope, writeScope, settingsScope];

export const mcpResource = (baseURL: string) => new URL("/mcp", baseURL).href;
export const metadataURL = (baseURL: string) => new URL("/.well-known/oauth-protected-resource/mcp", baseURL).href;

export function allowedMcpCallback(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:" && url.origin === "https://chatgpt.com") {
      return (
        url.pathname === "/connector_platform_oauth_redirect" ||
        /^\/connector\/oauth\/[\w-]+$/.test(url.pathname) ||
        /^\/oauth\/callback(?:\/[\w-]+)?$/.test(url.pathname)
      );
    }
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
      Boolean(url.port) &&
      url.pathname === "/callback"
    );
  } catch {
    return false;
  }
}
