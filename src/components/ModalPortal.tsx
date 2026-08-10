'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Renders its children at the end of <body>, outside whatever page markup the
// caller happens to sit in.
//
// This is what lets a modal be a modal. A `position: fixed` element is only
// positioned against the viewport while NO ancestor has a transform, filter or
// perspective — any of those silently turn that ancestor into the element's
// containing block. Page transitions move the page, so a sheet left in the tree
// would anchor to the page instead of the screen and, on a long page like the
// editor, scroll away with the content.
//
// Reserved for true overlays. Page chrome that happens to be fixed — the
// editor's save bar, the floating language switch — deliberately stays in the
// tree, because during a page transition it SHOULD travel with its page.
//
// Renders nothing on the server: there is no document to portal into, and an
// overlay is opened by a tap, so it is never part of the first paint anyway.
//
// NOT named Portal: `components/Portal.tsx` is the bar's portal LANDING PAGE.

export default function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return createPortal(children, document.body)
}
