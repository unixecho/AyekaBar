// Which addresses this server will POST a push notification to. PURE, tested by scripts/check-security.mjs.
//
// A subscription's endpoint is a URL a signed-in employee supplies, and the server later sends a request to it. Without
// this list any staff account could point the server at an address of their choosing. Enforced where a subscription is
// saved AND where a push is sent, because the POS registers through a SQL function that only checks for https.

const EXACT_HOSTS = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'web.push.apple.com'])
const HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com', '.push.services.mozilla.com']

export function isAllowedPushEndpoint(value: string): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
  const host = url.hostname.toLowerCase()
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}
