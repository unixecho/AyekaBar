'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import ModalPortal from '@/components/ModalPortal'
import { haptic } from '@/lib/haptics'
import type { Lang } from '@/lib/menu/types'
import {
  ACK_KEY, COOKIES_PATH, INVENTORY_VERSION, NOTICE_COPY, parseAck, shouldShowNotice,
} from '@/lib/privacy/notice'
import { acknowledgeNotice } from '@/lib/privacy/browser'
import './privacy.css'

// The one-time notice about what the site keeps on a visitor's device — shown on
// the two pages people arrive at (the portal and the menu), once per device, and
// again only if the inventory it describes changes. Those are the most-visited
// pages on the site, so this file imports ONLY lib/privacy/notice.ts and browser.ts
// — never the registry or the page copy (the check enforces it).
//
// WHAT IT IS, AND IS NOT. A notice, not a consent gate. Everything this site
// stores is either needed for something the visitor is using or is a choice they
// made, and none of it is analytics or advertising, so Israeli law (which has no
// cookie-specific rule) asks for clear, findable information rather than an
// opt-in; the full reasoning and sources are in PLAYBOOK.md §3. So it has one
// honest button — "Got it" — and a way to the details, and nothing in it pretends
// that declining was ever on offer. The day an item that DOES need an opt-in
// (analytics, advertising) is added to the registry, scripts/check-privacy.mjs
// refuses until a real consent mechanism exists; this component is not it.
//
// HOW IT BEHAVES. Non-modal: it never takes focus, never traps it, and the page
// behind it stays fully usable. On `/` it waits for the portal intro to finish —
// it must never be on screen over the logo — and it gives up waiting after
// INTRO_WAIT_MAX_MS, so a stuck intro cannot hide it forever. Remembering is by
// the INVENTORY'S fingerprint (inventoryVersion), not a date: add or change a
// stored item and everyone sees it again; fix a typo and nobody is bothered.
// Following "Details" counts as having seen it — but that is recorded by the
// /cookies PAGE when it opens (CookiesView), not by an onClick on this link:
// PageTransitions takes every same-origin link click in the capture phase and
// stops it before React sees it, so a handler on a <Link> silently never runs
// (found 2026-10-04 — it is why that file says no link here carries its own
// onClick). Doing it on the page also covers the footer link, and anyone who
// arrives there from anywhere else: they have read the full declaration.
//
// Portalled to <body> (ModalPortal): this is `position: fixed` chrome, and the
// page template's transform would otherwise become its containing block
// (CLAUDE.md, "Any NEW position: fixed chrome must be portalled").

type Phase = 'waiting' | 'in' | 'out' | 'gone'

const VERSION = INVENTORY_VERSION
const SETTLE_MS = 700            // after the intro (or the page) has settled
const INTRO_WAIT_MAX_MS = 9000   // the welcome is ~5.5s; never wait longer than this
const LEAVE_MS = 260             // matches the exit animation in privacy.css

export default function StorageNotice({ lang }: { lang: Lang }) {
  const [phase, setPhase] = useState<Phase>('waiting')
  const leaveTimer = useRef<number | null>(null)

  useEffect(() => {
    let ack = null
    try { ack = parseAck(window.localStorage.getItem(ACK_KEY)) } catch { /* unreadable → not acknowledged */ }
    if (!shouldShowNotice(ack, VERSION)) { setPhase('gone'); return }

    const timers: number[] = []
    let observer: MutationObserver | null = null
    const show = () => { timers.push(window.setTimeout(() => setPhase('in'), SETTLE_MS)) }

    if (document.querySelector('.intro')) {
      // The intro is on screen. It removes itself from <body> when it ends.
      let armed = false
      const arm = () => {
        if (armed) return
        armed = true
        if (observer) observer.disconnect()
        show()
      }
      observer = new MutationObserver(() => { if (!document.querySelector('.intro')) arm() })
      observer.observe(document.body, { childList: true })
      timers.push(window.setTimeout(arm, INTRO_WAIT_MAX_MS))
    } else {
      show()
    }

    return () => {
      if (observer) observer.disconnect()
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  useEffect(() => () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
  }, [])

  const dismiss = () => {
    haptic()
    acknowledgeNotice()
    setPhase('out')
    leaveTimer.current = window.setTimeout(() => setPhase('gone'), LEAVE_MS)
  }

  if (phase === 'waiting' || phase === 'gone') return null
  const c = NOTICE_COPY

  return (
    <ModalPortal>
      <section
        className="storage-notice"
        role="region"
        aria-label={c.label[lang]}
        data-phase={phase === 'out' ? 'out' : 'in'}
        lang={lang}
        dir={lang === 'en' ? 'ltr' : 'rtl'}
      >
        <p className="storage-notice-text">{c.text[lang]}</p>
        <div className="storage-notice-actions">
          <button type="button" className="storage-notice-btn storage-notice-ok press" onClick={dismiss}>
            {c.ok[lang]}
          </button>
          <Link href={COOKIES_PATH} className="storage-notice-btn storage-notice-more press">
            {c.details[lang]}
          </Link>
        </div>
      </section>
    </ModalPortal>
  )
}
