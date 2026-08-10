/* eslint-disable no-undef */

/**
 * The service worker that renders a push notification and deep-links from it
 * (build spec section 11.4).
 *
 * It does nothing else. In particular it does not cache or intercept fetches:
 * a console whose pages could be served stale from a service worker would show
 * a gate as open after it closed, which is worse than being offline.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Boom-Busters', body: event.data.text(), href: '/' }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Boom-Busters', {
      body: payload.body ?? '',
      tag: payload.kind ?? 'boom-busters',
      data: { href: payload.href ?? '/' },
      // The whole point is to be actioned, so replacing a stale notification
      // for the same kind is right; stacking five "gate open" alerts is not.
      renotify: Boolean(payload.kind),
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const href = event.notification.data?.href ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(href)
          return client.focus()
        }
      }
      return self.clients.openWindow(href)
    }),
  )
})
