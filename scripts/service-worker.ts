import { CacheFirst, Serwist } from "serwist";

const serwist = new Serwist({
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [{
    matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({ cacheName: "fitness-build-assets" }),
  }],
});
serwist.addEventListeners();
