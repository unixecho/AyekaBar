'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { A11yWidget, ALL_A11Y_HTML_CLASSES, type A11yWidgetConfig } from 'a11y-widget'
import { a11yDisabledOn } from '@/lib/a11y-scope'

// The accessibility widget is a CUSTOMER-FACING feature (owner, 2026-10-13:
// "the accessibility widget should work only for Customer Facing pages … it is
// disabled in the dashboard for all users"). The portal, the menu, the loyalty
// club, the customer's own pages, the sign-in door and the statements keep it;
// everything behind the staff and owner doors does not — the dashboards are
// working tools used by a small known team on devices the bar controls, and a
// floating button over the POS hand-off, the schedule grid or the Z-report
// camera flow is in the way rather than a help.
//
// The rule itself (which routes) lives in lib/a11y-scope.ts, where a harness can
// check it; this file is only the React half.

// Module-level: the widget memoises its resolved config on object identity.
// `storageKey` is this app's PRE-EXISTING localStorage key — passed through
// deliberately so visitors' already-saved settings survived the move onto the
// shared package. Keep it.
const CONFIG: A11yWidgetConfig = {
  storageKey: 'ayeka.a11y.prefs.v1',
  statementHref: '/accessibility',
  // The menu's back arrow: named outright so the launcher keeps clear of it even
  // if the header around it is ever not sticky. (The cart, the globe and anything
  // else fixed or sticky are found by the widget itself.)
  avoid: ['.menu-back'],
}

/** The CSS custom properties the widget's provider writes to <html>. */
const ROOT_VARS = [
  '--a11y-font-scale', '--a11y-letter-spacing', '--a11y-word-spacing',
  '--a11y-line-height', '--a11y-accent',
]

/** Mounts the shared widget on customer-facing routes only.
 *
 *  ── The teardown is the part that matters ─────────────────────────────
 *  Unmounting the widget does NOT undo what it applied: the package writes
 *  classes and custom properties onto <html> and a `filter` onto #a11y-scope,
 *  and only ever rewrites them from inside its provider. Client navigation
 *  from /menu (with, say, high contrast on) to /owner/dashboard would
 *  therefore leave the owner's back office filtered and enlarged by a button
 *  that is no longer there — which reads as a broken dashboard. So on a
 *  disabled route this strips every trace; when the visitor returns to a
 *  customer page the widget remounts and re-applies their saved settings from
 *  localStorage on its own. Nothing is lost, only paused.
 */
export default function A11yGate() {
  const pathname = usePathname()
  const off = a11yDisabledOn(pathname)

  useEffect(() => {
    if (!off) return
    const html = document.documentElement
    html.classList.remove(...ALL_A11Y_HTML_CLASSES)
    for (const v of ROOT_VARS) html.style.removeProperty(v)
    const scope = document.getElementById('a11y-scope')
    if (scope) scope.style.filter = ''
  }, [off])

  if (off) return null
  return <A11yWidget config={CONFIG} />
}
