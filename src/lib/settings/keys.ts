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

/** Demo mode for the Overall view (`staff.ayeka.bar/?demo=1`) — the
 *  operational birds-eye deck showing waiter, bar and kitchen at once.
 *  2026-08-27: "leave a setting in the new portion for this view in the
 *  dashboard to toggle Demo on and off."
 *
 *  false (default) = PRODUCTION. The deck observes and cannot write: every
 *  non-GET is refused inside ayeka-staff's own transport, so the view can't
 *  nudge a live service no matter what gets tapped.
 *  true = the three panes are fully interactive, and whoever opened the deck
 *  acts as waiter, bar and cook at once for testing alongside a real waiter.
 *
 *  Defaults to false, and ayeka-staff also treats a missing/unreadable row
 *  as false — this is the one switch where guessing wrong during real
 *  service costs an actual order, so it fails CLOSED at every layer.
 *
 *  Public read (is_public=true), same as OMS_NOTIFY_ALL_WAITERS above and
 *  for the same reason: ayeka-staff has no other read path into
 *  app_settings. */
export const OMS_OVERALL_DEMO_MODE = 'oms_overall_demo_mode'
export const OMS_OVERALL_DEMO_MODE_DEFAULT = false

/** Where the Overall view lives. Its own constant so the dashboard link and
 *  any future reference can't drift; `?demo=1` rather than `/demo` because
 *  the query form needs no rewrite to resolve on any host. */
export const OVERALL_VIEW_URL = 'https://staff.ayeka.bar/?demo=1'

/** The public accessibility statement (הצהרת נגישות), required regardless
 *  of compliance route under Israel's Accessibility of Service Regulations
 *  — see PLAYBOOK.md §5. Every field is optional at the type level on
 *  purpose: the public page (`/accessibility`) renders only the fields
 *  that are actually filled in, never a "[TODO]" placeholder for a real
 *  visitor to see. What's genuinely missing surfaces instead as a
 *  dashboard signal (src/lib/owner/signals.ts) pointing the owner at
 *  /owner/accessibility — so the gap is tracked as an input to collect,
 *  not silently either invented or shown as broken. */
export const ACCESSIBILITY_STATEMENT = 'accessibility_statement'

export interface AccessibilityStatement {
  /** Physical entrance — step-free access, ramps, etc. */
  entranceAccess?: string
  /** Restroom accessibility — door width, grab bars, etc. */
  restroomAccess?: string
  /** Anything else about the physical venue not covered by the two fields
   *  above (seating, table height, general accommodations). */
  generalNote?: string
  /** Browsers/devices the WEBSITE itself was tested with. */
  browsersTested?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  /** Only rendered if the owner explicitly sets it — claiming an exemption
   *  is itself a decision, not a default, so an empty value here means
   *  "no exemption claimed," not "missing information." */
  exemptionNote?: string
}

export const ACCESSIBILITY_STATEMENT_DEFAULT: AccessibilityStatement = {}

/** Which fields the regulations actually require before the statement is
 *  complete — used both by the dashboard signal (what's still missing)
 *  and, implicitly, by nothing on the public page (it never blocks on
 *  this, it just renders what exists). Contact info needs at least ONE
 *  of phone/email, not literally both — see readDashboardSignals's own
 *  check rather than a flat list here. */
export const ACCESSIBILITY_REQUIRED_TEXT_FIELDS: (keyof AccessibilityStatement)[] = [
  'entranceAccess', 'restroomAccess', 'browsersTested',
]

/** The digital menu's order-building cart (PLAN_MENU_CART.md). Lets a
 *  customer collect items, split them between named diners, and read the
 *  result out to the waiter. Entirely client-side — nothing is transmitted —
 *  so this switch governs display, not access.
 *
 *  DEFAULTS TO **ON**, which is the opposite posture to `loyalty_enabled`,
 *  and deliberately so. That switch fails closed because guessing wrong
 *  exposes a club that isn't ready. This one guards a local, read-only
 *  convenience with no data path and no cost; failing closed here would mean
 *  a transient settings-read blip silently removes a feature the owner asked
 *  for from the menu, with nothing gained. The row is created public by
 *  migration 048 so the signed-out /menu page can read it. */
export const MENU_CART_ENABLED = 'menu_cart_enabled'
export const MENU_CART_ENABLED_DEFAULT = true

/** PHASE 2 — submitting a cart to the waiter's app after verifying a
 *  6-digit code the waiter reads out. Not built; see `lib/cart/otp.ts` and
 *  PLAN_MENU_CART.md §9. Present so the customer-facing button has something
 *  real to read instead of a hardcoded `false`, and so turning it on later is
 *  a flip rather than a deploy.
 *
 *  FAILS CLOSED, unlike the cart switch above, and for the mirror-image
 *  reason: this one gates a WRITE path into live service. */
export const TABLE_ORDERING_ENABLED = 'table_ordering_enabled'
export const TABLE_ORDERING_ENABLED_DEFAULT = false

/** PHASE 3 — "קריאה למלצר". Same posture, same reason. The owner has also
 *  floated staff smartwatches as the eventual receiving end; the event row
 *  drafted in migration 048 (`waiter_table_calls`) serves a phone and a watch
 *  identically, which is the only part of that idea this repo needs to not
 *  foreclose. */
export const WAITER_CALL_ENABLED = 'waiter_call_enabled'
export const WAITER_CALL_ENABLED_DEFAULT = false

/** How the Phase-2 code reaches the customer — 'handoff' | 'sms' | 'email'.
 *  Shape and the reasoning behind each value live in `lib/cart/otp.ts`;
 *  the key lives here so the owner API and any future reader agree on it. */
export const TABLE_CODE_CHANNEL = 'table_code_channel'

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
