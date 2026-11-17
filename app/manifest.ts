import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MCP Logger", short_name: "MCP Logger", description: "Personal nutrition, energy balance, and measurement tracker",
    start_url: "/", display: "standalone", background_color: "#F5F7FA", theme_color: "#F5F7FA",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
