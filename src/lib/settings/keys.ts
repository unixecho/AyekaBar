// Owner-controlled feature switches stored in public.app_settings.
// Shared by the server reader, the owner API and the toggle UI so the key
// string and the default live in exactly one place.

export const LOYALTY_ENABLED = 'loyalty_enabled'

/** Cache tag for the ISR-cached settings read (revalidated when the owner flips a switch). */
export const SETTINGS_TAG = 'app-settings'

/** Loyalty starts OFF: the bar launches with portal-only QR codes and the
 *  club advertised as "coming soon". */
export const LOYALTY_ENABLED_DEFAULT = false

/** Does the loyalty entry appear on the portal at all? Separate from
 *  LOYALTY_ENABLED, which controls access. Together they give three states:
 *  visible+enabled = live, visible+disabled = "בקרוב" teaser, hidden = no
 *  button on the portal. Hiding is portal-only — /loyalty itself still obeys
 *  LOYALTY_ENABLED, so a hidden club stays reachable by direct link or QR. */
export const LOYALTY_VISIBLE = 'loyalty_visible'

/** Defaults to visible, so the switch failing open leaves the portal looking
 *  exactly as LOYALTY_ENABLED alone used to make it. */
export const LOYALTY_VISIBLE_DEFAULT = true

/** The portal's external link buttons — owner-editable so a wrong Instagram
 *  handle or a moved Google review link doesn't need a code deploy. */
export const PORTAL_LINKS = 'portal_links'

/** Happy hour config blob (migration 013). Shape lives in lib/menu/variants. */
export const HAPPY_HOUR_KEY = 'happy_hour'

/** The portal's review wall (migration 018). Shape + seed live in lib/reviews. */
export const PORTAL_REVIEWS = 'portal_reviews'

/** "Lets make a way for the owner to choose if all waiters get
 *  notifications for all tables or table owned notifications so we can
 *  fit multiple businesses" — 2026-08-16, ayeka-staff's global ready-
 *  notification system (App.tsx). true = broadcast (every waiter sees
 *  every table's ready items, today's only behavior before this
 *  setting existed); false = scoped to tables the waiter is actually
 *  assigned to (held_by_staff_id, or the order's own waiter_staff_id).
 *  Public read (is_public=true, seeded by content update, not a
 *  migration) — same posture LOYALTY_ENABLED already takes, since
 *  ayeka-staff's own RLS has no other way to read app_settings than the
 *  public-read policy. */
export const OMS_NOTIFY_ALL_WAITERS = 'oms_notify_all_waiters'
export const OMS_NOTIFY_ALL_WAITERS_DEFAULT = true

export type PortalLinkKey = 'instagram' | 'facebook' | 'review' | 'gmaps' | 'waze' | 'amaps'

export const PORTAL_LINKS_DEFAULT: Record<PortalLinkKey, string> = {
  instagram: 'https://www.instagram.com/ayeka_bar/',
  facebook: 'https://www.facebook.com/p/%D7%90%D7%99%D7%99%D7%9B%D7%94-61568228073670/',
  // Addressed by CID (the listing's stable id) rather than the old
  // google.com/search URL, which carried a session-scoped `sca_esv` token that
  // would eventually rot. CID harvested from the Maps listing on 2026-08-10.
  review: 'https://maps.google.com/?cid=8772973758950612975',
  gmaps: 'https://maps.app.goo.gl/RkQKuohRE2WnxehDA',
  waze: 'https://waze.com/ul/hsvbbtt1nb',
  amaps: 'https://maps.apple/r/I8JK.APxMAXYhS',
}
