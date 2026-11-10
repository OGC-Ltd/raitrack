/*
 * Web Push service worker. Shows the notifications the server pushes (repair
 * ticket numbers to the operator and the security heads, 2026-10-27) and
 * brings the app forward when one is clicked. Nothing is cached here.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const FALLBACK_ICON = "/logo-icon.png";

/*
 * The organisation's logo, when the server named one (/org-marks/<code>.png,
 * operator 2026-11-10: a push should carry the logo of its organisation).
 * Checked before it is shown: nginx answers a missing file with the app's
 * index.html and a 200, which a notification would draw as a blank square,
 * so anything that is not an image falls back to the Rai mark.
 */
async function iconFor(src) {
  if (!src || src === FALLBACK_ICON) return FALLBACK_ICON;
  try {
    const res = await fetch(src, { cache: "force-cache" });
    return res.ok && (res.headers.get("content-type") || "").startsWith("image/") ? src : FALLBACK_ICON;
  } catch {
    return FALLBACK_ICON;
  }
}

self.addEventListener("push", (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { title: "Rai Operations", body: event.data?.text() ?? "" }; }
  event.waitUntil((async () => {
    const icon = await iconFor(p.icon);
    await self.registration.showNotification(p.title || "Rai Operations", {
      body: p.body || "",
      icon,
      badge: p.badge || FALLBACK_ICON,
      tag: p.tag,
      data: p.data || {},
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const here = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (here) return here.focus();
    return self.clients.openWindow(url);
  })());
});
