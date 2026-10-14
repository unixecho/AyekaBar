import type { Lang } from '@/lib/menu/types'

// The LIGHT half of the privacy module: everything the portal and the menu need to
// decide whether to show the one-time notice, and the words of the notice itself.
//
// It is deliberately tiny and imports nothing heavy. The registry
// (registry.ts — eleven entries in three languages) and the /cookies page's copy
// (copy.ts) are large, and they are needed by exactly one route; the portal and the
// menu are the two most-visited pages on the site and are not allowed to carry them.
// The first version imported the registry just to compute a fingerprint and added
// 13 kB to both pages (found 2026-10-04, in the build output). So the fingerprint is
// a literal here, and scripts/check-privacy.mjs fails — printing the exact value to
// paste — whenever it stops matching the registry. That makes changing what the site
// stores a deliberate, reviewed act, and re-showing the notice to everybody the
// intended consequence of it. It also asserts that nothing the two pages load imports
// registry.ts or copy.ts, so this cannot quietly grow back.

type Text = Record<Lang, string>
const t = (he: string, en: string, ar: string): Text => ({ he, en, ar })

export const COOKIES_PATH = '/cookies'

/** The footer link — one string, used by the portal and by the menu. */
export const COOKIES_LINK_LABEL: Text = t(
  'עוגיות ואחסון',
  'Cookies & storage',
  'ملفات تعريف الارتباط والتخزين',
)

export const NOTICE_COPY = {
  label: t('הודעה על אחסון במכשיר', 'Notice about on-device storage', 'إشعار حول التخزين على الجهاز'),
  text: t(
    'האתר שומר במכשיר שלכם רק מה שנחוץ כדי שיעבוד כמו שביקשתם — השפה, הגדרות הנגישות ורשימת ההזמנה. בלי מעקב ובלי פרסום.',
    'This site keeps only what it needs on your device to work the way you asked — your language, accessibility settings and order list. No tracking, no advertising.',
    'يحفظ هذا الموقع على جهازكم ما يلزمه فقط ليعمل كما طلبتم — اللغة وإعدادات إمكانية الوصول وقائمة الطلب. بلا تتبّع وبلا إعلانات.'),
  ok: t('הבנתי', 'Got it', 'فهمت'),
  details: t('פרטים', 'Details', 'التفاصيل'),
}

/** localStorage key remembering which inventory this device has been told about. */
export const ACK_KEY = 'ayeka.privacy.ack.v1'

/** The fingerprint of lib/privacy/registry.ts's inventory (`inventoryVersion()`).
 *  Change what the site stores and the harness fails until this is updated — and
 *  every visitor who had acknowledged the old inventory sees the notice again. */
export const INVENTORY_VERSION = 'e37ef61c'

// ── the notice's memory ───────────────────────────────────────────────────
export interface PrivacyAck { v: string; at: number }

/** Whatever is in storage is the DEVICE's, not ours: validate it like input. */
export function parseAck(raw: string | null | undefined): PrivacyAck | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return null
  try {
    const o = JSON.parse(raw) as Partial<PrivacyAck> | null
    if (!o || typeof o !== 'object') return null
    if (typeof o.v !== 'string' || o.v.length === 0 || o.v.length > 32) return null
    if (typeof o.at !== 'number' || !isFinite(o.at)) return null
    return { v: o.v, at: o.at }
  } catch {
    return null
  }
}

export const serializeAck = (version: string, now: number): string =>
  JSON.stringify({ v: version, at: now })

/** Show the notice unless this exact inventory has been acknowledged. */
export const shouldShowNotice = (ack: PrivacyAck | null, version: string): boolean =>
  !ack || ack.v !== version
