'use client'

import { Suspense } from 'react'
import { Analytics } from '@vercel/analytics/next'
import { countingRefused, sanitizeVisitEvent } from '@/lib/analytics'

// Counts page views with Vercel Web Analytics — cookieless, nothing stored on the device. Mounted once in
// the root layout, as a sibling of #a11y-scope (it renders nothing visible). The rules for WHAT is counted
// live in lib/analytics.ts and are held by scripts/check-privacy.mjs; /privacy and /cookies describe them.
// It only reports from a real Vercel deployment: in `next dev` the script is never loaded.
export default function SiteAnalytics() {
  return (
    <Suspense fallback={null}>
      <Analytics
        beforeSend={(event) => sanitizeVisitEvent(event, countingRefused({
          doNotTrack: navigator.doNotTrack,
          globalPrivacyControl: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl,
        }))}
      />
    </Suspense>
  )
}
