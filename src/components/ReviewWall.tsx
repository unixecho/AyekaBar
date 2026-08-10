'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Lang } from '@/components/LanguageSwitch'
import { visibleReviews, type PortalReview, type PortalReviewsBlock } from '@/lib/reviews/types'

// The portal's "wall of love" — oversized customer quotes that drift sideways
// on their own and can be grabbed like a native iOS carousel.
//
// WHY A REAL SCROLLER AND NOT A CSS MARQUEE
// A transform-based marquee loops beautifully and cannot be touched: on a
// phone — which is how nearly everyone reaches this portal, via a QR code on
// the table — a quote slides away and you can't hold it to finish reading.
// So the track is a genuine `overflow-x: auto` scroller whose scrollLeft is
// nudged forward each frame instead, which keeps native momentum, native
// overscroll and native scrollbars, and lets any touch take over instantly.
//
// THREE THINGS THAT LOOK LIKE BUGS AND ARE NOT
// 1. The track is forced to `direction: ltr` even on the Hebrew (RTL) portal.
//    In an RTL scroller, scrollLeft runs from 0 down to negative, so every
//    wrap calculation would need a per-direction branch. The card ORDER is
//    decorative here — it's a marquee, not a reading sequence — so pinning
//    the track to LTR buys one code path in every browser. Each card still
//    sets its own `dir` from the language it was written in.
// 2. The list is rendered twice. That is what makes the loop seamless: once
//    scrollLeft passes one copy's width we subtract that width, and since the
//    content at both points is identical the jump is invisible. The second
//    copy is aria-hidden so a screen reader hears each quote once.
// 3. Scroll snapping is toggled, not set once. With `scroll-snap-type` on
//    while we drive scrollLeft from rAF, the browser yanks the scroller back
//    to the nearest snap point every frame and the whole wall stutters. Snap
//    is therefore OFF while drifting and ON while the user is in control.

/** Drift speed. Slow enough to read a quote as it passes. */
const SPEED_PX_S = 26
/** How long after the last interaction the drift picks back up. */
const IDLE_MS = 2500

// Every card is attributed the same generic way, regardless of whether the
// stored review carries a real name — the wall never surfaces a reviewer's
// identity. `PortalReview.author` still exists in the data model (a future
// owner-side editor may want it for its own reference) but nothing here reads
// it for display.
const I18N: Record<Lang, {
  eyebrow: string; anonymous: string; region: string; onGoogle: string
}> = {
  he: {
    eyebrow: 'מה אומרים עלינו',
    anonymous: 'ביקורת מגוגל',
    region: 'ביקורות לקוחות',
    onGoogle: 'לצפייה בכל הביקורות',
  },
  en: {
    eyebrow: 'What people say',
    anonymous: 'Google review',
    region: 'Customer reviews',
    onGoogle: 'See all reviews',
  },
  ar: {
    eyebrow: 'ماذا يقولون عنا',
    anonymous: 'مراجعة من جوجل',
    region: 'تقييمات العملاء',
    onGoogle: 'عرض كل التقييمات',
  },
}

// Month names are spelled out rather than run through Intl.DateTimeFormat:
// the wall renders on the server too, and any ICU difference between the build
// and the browser would surface as a hydration mismatch on a purely decorative
// date. Matches how the rest of the app handles i18n anyway.
const MONTHS: Record<Lang, string[]> = {
  he: ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
}

function formatMonth(ym: string, lang: Lang): string {
  if (!ym) return ''
  const [year, month] = ym.split('-')
  const name = MONTHS[lang][Number(month) - 1]
  return name ? `${name} ${year}` : ''
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
      <path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L4.3 9.4l6-.9z" />
    </svg>
  )
}

function Stars({ n }: { n: number }) {
  return (
    <span className="rw-stars" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} filled={i <= n} />)}
    </span>
  )
}

function Card({ review, lang }: { review: PortalReview; lang: Lang }) {
  const t = I18N[lang]
  const when = formatMonth(review.date, lang)

  return (
    <figure className="rw-card" dir={review.lang === 'en' ? 'ltr' : 'rtl'} lang={review.lang}>
      <span className="rw-mark" aria-hidden>&ldquo;</span>
      <blockquote className="rw-text">{review.text}</blockquote>
      <figcaption className="rw-foot">
        <span className="rw-avatar" aria-hidden><Star filled /></span>
        <span className="rw-who">
          <span className="rw-name">{t.anonymous}</span>
          <span className="rw-meta">
            <Stars n={review.stars} />
            {when && <span className="rw-when">{when}</span>}
          </span>
        </span>
      </figcaption>
    </figure>
  )
}

export default function ReviewWall({ block, lang }: { block: PortalReviewsBlock; lang: Lang }) {
  const items = visibleReviews(block)
  const t = I18N[lang]

  const sectionRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  /** Timestamp before which the drift stays out of the user's way. */
  const resumeAtRef = useRef(0)
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Distance from a card to its own copy — the exact loop period. */
  const periodRef = useRef(0)

  const [inView, setInView] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [snap, setSnap] = useState(false)

  const count = items.length

  // Measured from the DOM, NOT computed as scrollWidth / 2. The track carries
  // horizontal padding, which scrollWidth counts once across the whole track
  // while the repeat period contains none of it, and the two copies are
  // separated by one flex gap that likewise belongs to neither half. Halving
  // scrollWidth is therefore off by (2 * padding - gap) / 2 — 8px here, 10px
  // at mobile widths — and the wall visibly jerks once per loop. The distance
  // between a card and its own copy is the period by definition.
  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const first = track.children[0] as HTMLElement | undefined
    const copy = track.children[count] as HTMLElement | undefined
    periodRef.current = first && copy ? copy.offsetLeft - first.offsetLeft : 0
  }, [count])

  /** Keep scrollLeft inside the first copy, so the loop never reaches an end. */
  const wrap = useCallback(() => {
    const el = scrollerRef.current
    const period = periodRef.current
    if (!el || period <= 0) return
    if (el.scrollLeft >= period) el.scrollLeft -= period
    else if (el.scrollLeft < 0.5) el.scrollLeft += period
  }, [])

  /** Any real input wins: stop drifting, hand snapping back to the browser. */
  const yieldToUser = useCallback(() => {
    resumeAtRef.current = performance.now() + IDLE_MS
    setSnap(true)
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
    snapTimerRef.current = setTimeout(() => setSnap(false), IDLE_MS)
  }, [])

  useEffect(() => () => { if (snapTimerRef.current) clearTimeout(snapTimerRef.current) }, [])

  // Reveal + drift both wait until the wall is actually on screen — the portal
  // is the QR-code landing page, and nothing below the fold should cost
  // anything before it's looked at.
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return

    // Already on screen at mount (a tall desktop viewport): reveal now rather
    // than sit at opacity 0 waiting for a scroll that already happened.
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight && rect.bottom > 0) { setInView(true); return }

    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }

    let delivered = false
    const io = new IntersectionObserver(([entry]) => {
      delivered = true
      if (entry.isIntersecting) { setInView(true); io.disconnect() }
    }, { rootMargin: '0px 0px -12% 0px' })
    io.observe(el)

    // Fail visible. The cards start at opacity 0 so they can animate in, which
    // means anything that stops the observer from ever delivering would erase
    // the wall entirely. A healthy tab delivers an initial callback within a
    // frame or two, so this only ever fires when observation is genuinely
    // broken — never in the normal below-the-fold case.
    const failsafe = setTimeout(() => { if (!delivered) setInView(true) }, 2000)

    return () => { clearTimeout(failsafe); io.disconnect() }
  }, [])

  // The card width is viewport-relative (`min(78vw, 320px)`), so the period
  // changes on rotate/resize and has to be re-measured, not measured once.
  useEffect(() => {
    measure()
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(track)
    return () => ro.disconnect()
  }, [measure])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!inView || reduced) return
    let raf = 0
    let last = performance.now()

    const step = (now: number) => {
      // Cap the delta so a backgrounded tab doesn't return and lurch forward.
      const dt = Math.min(now - last, 50)
      last = now
      const el = scrollerRef.current
      if (el && !document.hidden && now >= resumeAtRef.current) {
        el.scrollLeft += (SPEED_PX_S * dt) / 1000
      }
      wrap()
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [inView, reduced, wrap])

  // Nothing to brag about yet — render nothing rather than an empty heading.
  if (!items.length) return null

  const doubled = [
    ...items.map((r) => ({ r, key: `a-${r.id}`, ghost: false })),
    ...items.map((r) => ({ r, key: `b-${r.id}`, ghost: true })),
  ]

  return (
    <section ref={sectionRef} className={`rw${inView ? ' in' : ''}`} aria-label={t.region}>
      <header className="rw-head">
        <p className="rw-eyebrow">{t.eyebrow}</p>
        <div className="rw-score">
          <span className="rw-rating">{block.rating.toFixed(1)}</span>
          <Stars n={Math.round(block.rating)} />
        </div>
        {/* Rating stays; the review COUNT deliberately does not — how many
            reviews exist is not something the wall discloses. `block.count`
            still round-trips through the settings API for a future editor,
            it just isn't rendered here. */}
        <a className="rw-count" href={block.url} target="_blank" rel="noopener noreferrer">
          {t.onGoogle}
        </a>
      </header>

      <div
        ref={scrollerRef}
        className="rw-scroller"
        style={{ scrollSnapType: snap ? 'x mandatory' : 'none' }}
        onPointerDown={yieldToUser}
        onWheel={yieldToUser}
        onTouchStart={yieldToUser}
        onKeyDown={yieldToUser}
        tabIndex={0}
        role="group"
        aria-label={t.region}
      >
        <div className="rw-track" ref={trackRef}>
          {doubled.map(({ r, key, ghost }) => (
            <div key={key} className="rw-slot" aria-hidden={ghost || undefined}>
              <Card review={r} lang={lang} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
