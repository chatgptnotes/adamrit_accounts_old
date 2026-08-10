/// <reference lib="webworker" />
// Hand-written service worker (vite-plugin-pwa `injectManifest` mode). It must
// reproduce exactly what the previous generateSW build did — precache the app
// shell, activate immediately so a deploy can never strand users on stale
// chunks (404s on new routes), and serve the SPA fallback for navigations —
// and then adds the one thing generateSW cannot: Web Push handlers, so the
// installed app can post system notifications while closed.
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";

declare let self: ServiceWorkerGlobalScope;

// skipWaiting + clientsClaim: the new worker takes over all tabs the moment a
// deploy ships. Pairs with registerType "autoUpdate" in vite.config.ts.
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigation fallback. Never serve the shell for API/auth requests.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//],
  }),
);

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

interface PushPayload {
  title?: string;
  body?: string;
  /** In-app path to open on tap, e.g. "/t/payments-due". */
  url?: string;
  /** Collapse key — a re-sent alert replaces the old banner instead of stacking. */
  tag?: string;
}

self.addEventListener("push", (event: PushEvent) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    // A non-JSON push (e.g. a bare test string) still shows something useful.
    payload = { body: event.data?.text() };
  }

  const title = payload.title || "Adamrit HMS";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: payload.tag,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data?.url as string) || "/";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Reuse an open Adamrit window if there is one; navigating it keeps the
      // logged-in session instead of spawning a second tab.
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await (client as WindowClient).navigate(url);
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
