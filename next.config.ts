import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Cache-Control", value: "no-store" },
      { key: "Content-Security-Policy", value: "default-src 'none'; connect-src 'self'; script-src 'self'" },
    ] }];
  },
};
export default config;
