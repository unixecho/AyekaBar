'use client'

import { useState } from 'react'
import A11yProvider, { useA11y } from './A11yProvider'
import A11yLauncher from './A11yLauncher'
import A11yPanel from './A11yPanel'
import ReadingGuide from './ReadingGuide'
import { DEFAULT_A11Y_CONFIG, type A11yWidgetConfig } from '@/lib/a11y/types'

// The one import a host page needs. PLAN_ACCESSIBILITY.md §3, Phase 1
// ("build, internal-only") — mounted alongside Negishot for now, NOT yet
// replacing it (§3.8's Phase 3/4 are still ahead, gated on §2's exit
// criteria). See layout.tsx for the integration.

export default function A11yWidget({ config = {} }: { config?: A11yWidgetConfig }) {
  return (
    <A11yProvider>
      <A11yWidgetInner config={config} />
    </A11yProvider>
  )
}

function A11yWidgetInner({ config }: { config: A11yWidgetConfig }) {
  const { prefs } = useA11y()
  const [open, setOpen] = useState(false)
  const corner = config.corner ?? DEFAULT_A11Y_CONFIG.corner

  return (
    <>
      <A11yLauncher corner={corner} open={open} onOpen={() => setOpen(true)} />
      <A11yPanel open={open} onClose={() => setOpen(false)} />
      {prefs.readingGuide && <ReadingGuide />}
    </>
  )
}
