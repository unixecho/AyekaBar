'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  directionFor, navigateWithTransition, recordNavigation, settleNavigation,
} from '@/lib/nav/viewTransition'

// Gives the whole app the iOS push, without touching a single link.
//
// It listens for clicks on the way DOWN (capture phase) and takes over any
// in-app anchor before Next's own handler sees it. That is the reason there is
// no custom <Link> to remember to import: every link that exists — and every
// link added later — is animated by being a link.

export default function PageTransitions() {
  const router = useRouter()
  const pathname = usePathname()

  // The transition holds the outgoing screenshot on screen until this fires,
  // which is how the browser knows the new page is ready to be captured.
  useEffect(() => {
    settleNavigation()
    // Also keeps the stack honest after a full page load or an external entry
    // (a QR code straight into /menu), where no click of ours was involved.
    // Idempotent — a click-driven navigation already recorded itself.
    recordNavigation(pathname)
  }, [pathname])

  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Leave modified clicks alone — they mean "new tab", "download", "paste".
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as Element | null)?.closest?.('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return
      if (anchor.hasAttribute('download')) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.dataset.noTransition !== undefined) return

      let url: URL
      try { url = new URL(anchor.href, location.href) } catch { return }

      if (url.origin !== location.origin) return
      // Route handlers are downloads and redirects, not pages — the customers
      // CSV export is one. Animating a navigation to it would freeze the app on
      // a screenshot of a page it never leaves.
      if (url.pathname.startsWith('/api/')) return

      const path = url.pathname + url.search
      if (path === location.pathname + location.search) return

      // Taking over: preventDefault stops the browser, stopPropagation stops
      // Next's Link handler from navigating a second time outside the
      // transition. Safe here because no link in this app carries its own
      // onClick — `data-no-transition` is the escape hatch if one ever does.
      event.preventDefault()
      event.stopPropagation()

      navigateWithTransition(path, directionFor(path), () => router.push(path))
    }

    document.addEventListener('click', onClick, true)

    // Browser back/forward navigates before we get a say, so it can't be
    // wrapped in a transition. It still gets a direction, which the CSS
    // entrance in template.tsx uses to slide the right way.
    function onPopState() {
      document.documentElement.dataset.nav = 'back'
      recordNavigation(location.pathname + location.search)
    }
    window.addEventListener('popstate', onPopState)

    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
    }
  }, [router])

  return null
}
