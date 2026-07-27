// Owner-controlled feature switches stored in public.app_settings.
// Shared by the server reader, the owner API and the toggle UI so the key
// string and the default live in exactly one place.

export const LOYALTY_ENABLED = 'loyalty_enabled'

/** Cache tag for the ISR-cached settings read (revalidated when the owner flips a switch). */
export const SETTINGS_TAG = 'app-settings'

/** Loyalty starts OFF: the bar launches with portal-only QR codes and the
 *  club advertised as "coming soon". */
export const LOYALTY_ENABLED_DEFAULT = false

/** The portal's external link buttons — owner-editable so a wrong Instagram
 *  handle or a moved Google review link doesn't need a code deploy. */
export const PORTAL_LINKS = 'portal_links'

export type PortalLinkKey = 'instagram' | 'review' | 'gmaps' | 'waze' | 'amaps'

export const PORTAL_LINKS_DEFAULT: Record<PortalLinkKey, string> = {
  instagram: 'https://www.instagram.com/ayeka_bar/',
  review: 'https://www.google.com/search?sca_esv=bf5b70d178609590&si=APenkKm7iecQ4G6P-TsbSMFKIQtv3EFIqRAFw-i8uEbk55Z-_7KuVymh7UmzzptLxAMIed7ULsObX2FBkuw7nT2KAF8MiqFu6xqzwWnw0NKO515Um1Z0Z8-i9F5axbTKJbSaHBIaHv9J&q=%D7%90%D7%99%D7%99%D7%9B%D7%94+Reviews&sa=X#',
  gmaps: 'https://maps.app.goo.gl/RkQKuohRE2WnxehDA',
  waze: 'https://waze.com/ul/hsvbbtt1nb',
  amaps: 'https://maps.apple/r/I8JK.APxMAXYhS',
}
