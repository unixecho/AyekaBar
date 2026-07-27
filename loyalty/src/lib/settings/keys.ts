// Owner-controlled feature switches stored in public.app_settings.
// Shared by the server reader, the owner API and the toggle UI so the key
// string and the default live in exactly one place.

export const LOYALTY_ENABLED = 'loyalty_enabled'

/** Cache tag for the ISR-cached settings read (revalidated when the owner flips a switch). */
export const SETTINGS_TAG = 'app-settings'

/** Loyalty starts OFF: the bar launches with portal-only QR codes and the
 *  club advertised as "coming soon". */
export const LOYALTY_ENABLED_DEFAULT = false
