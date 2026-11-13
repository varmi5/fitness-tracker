import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fitness", short_name: "Fitness", description: "Personal measurement tracker",
    start_url: "/", display: "standalone", background_color: "#0e1318", theme_color: "#0e1318",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
