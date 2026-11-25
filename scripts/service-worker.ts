import { CacheFirst, NetworkFirst, ExpirationPlugin, Serwist } from "serwist";

const serwist = new Serwist({
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [{
    matcher: ({ request, sameOrigin, url }) => sameOrigin && request.mode === "navigate" && url.pathname === "/",
    handler: new NetworkFirst({ cacheName: "fitness-public-shell-v1", networkTimeoutSeconds: 3, plugins: [new ExpirationPlugin({ maxEntries: 1, maxAgeSeconds: 7 * 86400 })] }),
  }, {
    matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({ cacheName: "fitness-build-assets", plugins: [new ExpirationPlugin({ maxEntries: 160, maxAgeSeconds: 30 * 86400 })] }),
  }],
});
serwist.addEventListeners();

interface PushMessageEvent extends Event { data?: { json(): { title?: string; body?: string; tag?: string } }; waitUntil(task: Promise<unknown>): void }
interface NotificationClickEvent extends Event { notification: { close(): void }; waitUntil(task: Promise<unknown>): void }
interface AppWindow { navigate(url: string): Promise<unknown>; focus(): Promise<unknown> }
const worker = self as unknown as { registration: { showNotification(title: string, options: NotificationOptions): Promise<void> }; clients: {
  matchAll(options: { type: string; includeUncontrolled: boolean }): Promise<AppWindow[]>; openWindow(url: string): Promise<unknown>;
} };
self.addEventListener("push", ((event: PushMessageEvent) => {
  let payload: { title?: string; body?: string; tag?: string } = {};
  try { payload = event.data?.json() ?? {}; } catch { /* Use a neutral fallback. */ }
  event.waitUntil(worker.registration.showNotification(payload.title ?? "FitnessTrackr", {
    body: payload.body ?? "Open your diary to log a meal.", icon: "/icon-192.png?v=2", badge: "/icon-192.png?v=2", tag: payload.tag ?? "meal-reminder",
    data: { url: "/?tab=Nutrition" },
  }));
}) as EventListener);
self.addEventListener("notificationclick", ((event: NotificationClickEvent) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = worker.clients;
    const existing = (await clients.matchAll({ type: "window", includeUncontrolled: true }))[0];
    if (existing) { await existing.navigate("/?tab=Nutrition"); await existing.focus(); }
    else await clients.openWindow("/?tab=Nutrition");
  })());
}) as EventListener);
