// Client-side Web Push mechanics for the staff app: service-worker registration, VAPID key
// conversion, subscribe / unsubscribe / test requests. Kept separate from the card's UI so the
// "how" is readable independent of the "when do we ask" policy.

/** iOS/iPadOS Safari is the one browser where Web Push exists ONLY inside
 *  a home-screen-installed (standalone) PWA — not in a regular tab, even
 *  on iOS 16.4+ which otherwise supports the Push API. Detecting this
 *  explicitly (rather than only feature-detecting PushManager, which can
 *  be falsely absent OR present-but-non-functional depending on iOS
 *  version) is what makes the onboarding actually correct on iPhone
 *  instead of silently failing after a confident-looking "Enable"
 *  button. iPadOS 13+ reports as "Macintosh" in its UA unless "Request
 *  Desktop Website" is off, so touch support is the tell there. */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isIphoneOrIpod = /iPhone|iPod/.test(ua)
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)
  return isIphoneOrIpod || isIpad
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** VAPID applicationServerKey must be a Uint8Array, but the key is
 *  distributed (and env-configured) as a URL-safe base64 string — this
 *  is the standard conversion every Web Push guide includes verbatim. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch (err) {
    console.error('Service worker registration failed:', err)
    return null
  }
}

/** A PushSubscription's applicationServerKey is fixed for the life of the
 *  subscription — it's whatever key was passed to subscribe() at creation
 *  time, regardless of what the server is configured with today. If the
 *  server's VAPID key ever changes (rotated, or fixing a corrupted key
 *  that was pasted in wrong), a browser that subscribed against the OLD
 *  key keeps silently failing forever: getSubscription() still returns a
 *  live-looking subscription, so naive code never re-subscribes. This is
 *  what lets a single bad key produce a permanent "granted but nothing
 *  ever arrives" state that no amount of toggling permission fixes. */
function subscriptionMatchesKey(subscription: PushSubscription, desiredKey: Uint8Array): boolean {
  const existing = subscription.options.applicationServerKey
  if (!existing) return false
  const existingBytes = new Uint8Array(existing)
  if (existingBytes.length !== desiredKey.length) return false
  return existingBytes.every((byte, i) => byte === desiredKey[i])
}

/** The browser-level push subscription for this origin, created if needed. A browser has ONE per
 *  service worker; the server records which person it belongs to. Returns null when push cannot
 *  be set up (no key configured, worker failed, permission not granted). Never throws. */
async function getBrowserSubscription(): Promise<PushSubscription | null> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publicKey) return null

  try {
    const registration = await registerServiceWorker()
    if (!registration) return null

    const desiredKey = urlBase64ToUint8Array(publicKey)
    let subscription = await registration.pushManager.getSubscription()

    // Self-heal a subscription tied to a stale/mismatched key (see
    // subscriptionMatchesKey's header) instead of reusing it as-is —
    // otherwise a server-side VAPID key fix never reaches browsers that
    // already "succeeded" against the old one.
    if (subscription && !subscriptionMatchesKey(subscription, desiredKey)) {
      await subscription.unsubscribe()
      subscription = null
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: TS's lib.dom BufferSource type and Uint8Array's own
        // generic ArrayBufferLike parameter disagree under current
        // TypeScript/lib versions even though this is exactly the shape
        // every browser's subscribe() expects at runtime.
        applicationServerKey: desiredKey as BufferSource,
      })
    }
    return subscription
  } catch (err) {
    console.error('Push subscribe failed:', err)
    return null
  }
}


// ---------------------------------------------------------------------------------------------
// Staff app: subscriptions are reported against the signed-in PERSON.
// ---------------------------------------------------------------------------------------------

async function staffPushRequest(payload: Record<string, unknown>): Promise<Response | null> {
  try {
    return await fetch('/api/staff/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  } catch {
    return null
  }
}

/** Subscribes this phone to the signed-in person's alerts. Call only after permission is granted. */
export async function subscribeStaffPush(): Promise<boolean> {
  const subscription = await getBrowserSubscription()
  if (!subscription) return false
  const res = await staffPushRequest({ action: 'subscribe', subscription: subscription.toJSON() })
  return res?.ok === true
}

/** True only when this browser holds a subscription AND the server has it filed under the signed-in person. */
export async function isStaffPushActive(): Promise<boolean> {
  try {
    if (!isPushSupported() || Notification.permission !== 'granted') return false
    const registration = await navigator.serviceWorker.getRegistration('/sw.js')
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return false
    const res = await staffPushRequest({ action: 'status', endpoint: subscription.endpoint })
    if (!res?.ok) return false
    return ((await res.json()) as { subscribed?: boolean }).subscribed === true
  } catch {
    return false
  }
}

/** Stops alerts to this phone for the signed-in person. */
export async function unsubscribeStaffPush(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js')
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return
    await staffPushRequest({ action: 'unsubscribe', endpoint: subscription.endpoint })
  } catch (err) {
    console.error('Staff push unsubscribe failed:', err)
  }
}

export type StaffPushTest = { configured: boolean; subscriptions: number; sent: number; error: { statusCode: number | null; detail: string } | null }

export async function sendStaffPushTest(): Promise<StaffPushTest | null> {
  const res = await staffPushRequest({ action: 'test' })
  if (!res?.ok) return null
  return (await res.json()) as StaffPushTest
}
