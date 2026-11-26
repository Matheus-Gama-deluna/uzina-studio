const CACHE_NAME = "uzina-static-v1";
const OFFLINE_URL = "/offline";
const PRECACHE_ASSETS = [OFFLINE_URL, "/icons/icon-192.png", "/icons/badge-72.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Nunca intercepta nem cacheia APIs autenticadas, login ou MSW
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/login") ||
    url.pathname === "/mockServiceWorker.js" ||
    url.pathname === "/sw.js"
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedOffline = await caches.match(OFFLINE_URL);
        if (cachedOffline) return cachedOffline;
        return new Response("Offline", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })
    );
    return;
  }

  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/static/")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, copy))
                .catch(() => undefined);
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Uzina Studio",
    body: "Nova atualização na fábrica de software.",
    url: "/app/decisions",
    tag: "uzina-notification",
    badgeCount: undefined,
    actions: [{ action: "open", title: "Abrir" }],
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        ...payload,
        ...parsed,
      };
    } catch {
      const text = event.data.text();
      if (text) payload.body = text;
    }
  }

  const showPromise = self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: payload.tag || "uzina-notification",
    renotify: true,
    data: {
      url: payload.url || "/app/decisions",
    },
    actions: Array.isArray(payload.actions) ? payload.actions : undefined,
  });

  const badgePromise =
    typeof payload.badgeCount === "number" &&
    self.navigator &&
    typeof self.navigator.setAppBadge === "function"
      ? payload.badgeCount > 0
        ? self.navigator.setAppBadge(payload.badgeCount).catch(() => undefined)
        : typeof self.navigator.clearAppBadge === "function"
          ? self.navigator.clearAppBadge().catch(() => undefined)
          : Promise.resolve()
      : Promise.resolve();

  event.waitUntil(Promise.all([showPromise, badgePromise]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl =
    (event.notification.data && event.notification.data.url) || "/app";
  let targetUrl = "/app";
  try {
    const parsedTarget = new URL(rawUrl, self.location.origin);
    if (parsedTarget.origin === self.location.origin) {
      targetUrl = `${parsedTarget.pathname}${parsedTarget.search}${parsedTarget.hash}`;
    }
  } catch {
    targetUrl = "/app";
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin && "focus" in client) {
            if ("navigate" in client && typeof client.navigate === "function") {
              return client.navigate(targetUrl).then(() => client.focus());
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
