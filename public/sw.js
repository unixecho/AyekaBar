// Minimal Web Push service worker for the staff app — no offline caching/PWA shell (that is a
// separate, much bigger scope). Two jobs: show the notification a `push` event carries, and
// focus/open its page on click. A staff alert carries a `staff-…` tag: a repeat of the same tag
// REPLACES the earlier one in the tray instead of stacking.
//
// 2026-10-13 (remote ordering): an alert may also ask to BUZZ (`vibrate`, Android only — iOS ignores it) and to
// STAY until dealt with (`urgent`). Both are optional, validated here (the payload is data, not code), and a
// plain schedule alert carries neither, so it behaves exactly as before. The operating system owns the SOUND of
// a background notification; a page that is open plays its own ding (lib/staff/ding.ts) when this worker tells it
// an alert arrived.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title = data.title || 'אייכה בר'
  const url = data.url || '/staff'

  const options = {
    body: data.body || '',
    // A small dedicated icon (192x192) — never the full artwork. iOS has been reported to silently
    // drop a notification whose icon is slow or large to fetch.
    icon: '/assets/notification-icon.png',
    badge: '/assets/notification-icon.png',
    dir: 'rtl',
    lang: 'he',
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    data: { url },
  }
  if (Array.isArray(data.vibrate)) {
    options.vibrate = data.vibrate
      .filter((n) => typeof n === 'number' && Number.isFinite(n))
      .slice(0, 9)
      .map((n) => Math.max(0, Math.min(2000, Math.round(n))))
  }
  if (data.urgent === true) {
    // An order a customer is waiting on must not slide off the screen on its own. `renotify` is only legal
    // with a tag (it throws without one), so it is set only when there is one.
    options.requireInteraction = true
    if (typeof data.tag === 'string' && data.tag.length > 0) options.renotify = true
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Tell any open staff page, so it can refresh its list and ding without waiting for its next poll.
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) client.postMessage({ type: 'staff-alert', kind: typeof data.kind === 'string' ? data.kind : null })
      }),
    ])
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/staff'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus()
      }
      // A staff member with the app already open is taken to the page in that window,
      // not handed a second one.
      const open = clientList.find((client) => 'navigate' in client && 'focus' in client)
      if (open) {
        return open
          .navigate(url)
          .then((moved) => (moved || open).focus())
          .catch(() => (self.clients.openWindow ? self.clients.openWindow(url) : undefined))
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
      return undefined
    })
  )
})
