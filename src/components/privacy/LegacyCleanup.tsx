'use client'

import { useEffect } from 'react'
import { cleanupLegacy } from '@/lib/privacy/housekeeping'
import { browserEnv } from '@/lib/privacy/browser'

// Renders nothing. On the first page of any visit it tidies away what older
// versions of the site left in the browser — chiefly the cookie and storage keys
// of Negishot, the accessibility overlay removed 2026-09-12, which are still on
// every browser that ever saw it (found 2026-10-04 by reading the live site's
// storage). See LEGACY_* in lib/privacy/registry.ts.
//
// Mounted in the root layout rather than on the portal alone: a visitor can land
// on any page first, and a leftover cookie should not wait for them to find the
// right one. In an effect, never during render — storage and cookies do not exist
// on the server — and idempotent: with nothing to remove (nearly every visit) it
// does nothing at all.

export default function LegacyCleanup() {
  useEffect(() => {
    try { cleanupLegacy(browserEnv()) } catch { /* storage unavailable — nothing to tidy */ }
  }, [])
  return null
}
