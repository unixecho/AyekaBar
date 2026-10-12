// Minimal Web Push service worker for the staff app — no offline caching/PWA shell (that is a
// separate, much bigger scope). Two jobs: show the notification a `push` event carries, and
// focus/open its page on click. A staff alert carries a `staff-…` tag: a repeat of the same tag
// REPLACES the earlier one in the tray instead of stacking.

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

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      // A small dedicated icon (192x192) — never the full artwork. iOS has been reported to silently
      // drop a notification whose icon is slow or large to fetch.
      icon: '/assets/notification-icon.png',
      badge: '/assets/notification-icon.png',
      dir: 'rtl',
      lang: 'he',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      data: { url },
    })
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
