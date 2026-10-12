// Web Push plumbing shared by everything that pushes to a phone: one place that loads the VAPID
// keys. Without all three environment variables push is simply OFF — the in-app inbox keeps
// working, nothing throws, and the developer panel says plainly that keys are missing.
//
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY   the public key the browser subscribes with
//   VAPID_PRIVATE_KEY              the matching private key (server only)
//   VAPID_SUBJECT                  a mailto: or https: contact for the push service
//
// Generate a pair once with `npx web-push generate-vapid-keys`. Changing the pair later is safe:
// a browser holding a subscription made with the old public key re-subscribes by itself
// (lib/push/client.ts), it just has to open the app once.

import webpush from 'web-push'

let vapidReady: boolean | null = null

export function ensureVapidConfigured(): boolean {
  if (vapidReady !== null) return vapidReady

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) {
    console.error('Web Push not configured (missing VAPID env vars) — skipping send.')
    vapidReady = false
    return false
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    vapidReady = true
  } catch (err) {
    console.error('Invalid VAPID configuration:', err instanceof Error ? err.message : err)
    vapidReady = false
  }
  return vapidReady
}
