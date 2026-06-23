// Minimal service worker — required for "Add to Home Screen" as a real PWA.
// We intentionally do NOT cache API calls (predictions must be fresh).
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => self.clients.claim());
self.addEventListener("fetch", (e) => {
  // network-first; just pass through. Static assets are served by the host.
});
