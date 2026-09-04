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
// The arrows and the dots underneath drive that same scrollLeft, so all four
// ways of moving the wall (drift, swipe, arrow, dot) are the one mechanism.
//
// FOUR THINGS THAT LOOK LIKE BUGS AND ARE NOT
// 1. The track is forced to `direction: ltr` even on the Hebrew (RTL) portal.
//    In an RTL scroller, scrollLeft runs from 0 down to negative, so every
//    wrap calculation would need a per-direction branch. The card ORDER is
//    decorative here — it's a marquee, not a reading sequence — so pinning
//    the track to LTR buys one code path in every browser. Each card still
//    sets its own `dir` from the language it was written in. The arrows are
//    physical for the same reason: the left one moves the wall left, in every
//    language, which is what the motion itself shows.
// 2. The list is rendered twice. That is what makes the loop seamless: once
//    scrollLeft passes one copy's width we subtract that width, and since the
//    content at both points is identical the jump is invisible. The second
//    copy is aria-hidden so a screen reader hears each quote once.
// 3. Scroll snapping is toggled, not set once. With `scroll-snap-type` on
//    while we drive scrollLeft from rAF, the browser yanks the scroller back
//    to the nearest snap point every frame and the whole wall stutters. Snap
//    is therefore OFF whenever we are moving it and ON while the user is.
// 4. An arrow/dot glide is stored as a DISTANCE STILL TO TRAVEL, never as a
//    target scrollLeft. The seamless wrap rewrites scrollLeft mid-glide; a
//    remembered target would suddenly be one full loop away, and the wall
//    would bolt sideways. Relative distance is immune to that.
// 5. The drift never reads `el.scrollLeft` back to compute its next step —
//    it keeps its own float in `posRef` and only ever WRITES to the DOM.
//    `scrollLeft`'s getter reports whole pixels on most setups, and at this
//    drift's speed a single frame's nudge is well under a pixel (26px/s at
//    60fps ≈ 0.4px/frame). Read that rounded value back and add the next
//    nudge to *it*, and every frame's progress gets thrown away before the
//    next one arrives — the position rounds right back to where it started,
//    forever. Keeping the running total in JS instead of the DOM is what
//    lets the fractional part survive from frame to frame; only the value
//    actually written to `scrollLeft` gets rounded, once, for display.

/** Drift speed. Slow enough to read a quote as it passes. */
const SPEED_PX_S = 26
/** How long after the last interaction the drift picks back up. */
const IDLE_MS = 2500
/** Glide time for a one-card arrow tap; longer hops get a little more. */
const GLIDE_BASE_MS = 340
const GLIDE_PER_CARD_MS = 130
const GLIDE_MAX_MS = 900

// Every card is attributed the same generic way, regardless of whether the
// stored review carries a real name — the wall never surfaces a reviewer's
// identity. `PortalReview.author` still exists in the data model (a future
// owner-side editor may want it for its own reference) but nothing here reads
// it for display.
const I18N: Record<Lang, {
  eyebrow: string; anonymous: string; region: string; onGoogle: string
  prev: string; next: string; goTo: (n: number) => string
}> = {
  he: {
    eyebrow: 'מה אומרים עלינו',
    anonymous: 'ביקורת מגוגל',
    region: 'ביקורות לקוחות',
    onGoogle: 'לצפייה בכל הביקורות',
    prev: 'הביקורת הקודמת',
    next: 'הביקורת הבאה',
    goTo: (n) => `מעבר לביקורת ${n}`,
  },
  en: {
    eyebrow: 'What people say',
    anonymous: 'Google review',
    region: 'Customer reviews',
    onGoogle: 'See all reviews',
    prev: 'Previous review',
    next: 'Next review',
    goTo: (n) => `Go to review ${n}`,
  },
  ar: {
    eyebrow: 'ماذا يقولون عنا',
    anonymous: 'مراجعة من جوجل',
    region: 'تقييمات العملاء',
    onGoogle: 'عرض كل التقييمات',
    prev: 'التقييم السابق',
    next: 'التقييم التالي',
    goTo: (n) => `الانتقال إلى التقييم ${n}`,
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

/** Physical chevrons — see note 1 at the top; deliberately not `.dir-flip`. */
function Chevron({ back }: { back: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor"
      strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={back ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

/** Fewest cards to travel from `from` to `to` on a loop of `n` — either way round. */
function shortestHop(from: number, to: number, n: number): number {
  const forward = ((to - from) % n + n) % n
  return forward > n / 2 ? forward - n : forward
}

/** Keep a position inside [0, period) — pure, so it's cheap to call every
 *  frame against the accumulator without touching the DOM. See note 5 up top. */
function wrapValue(x: number, period: number): number {
  if (period <= 0) return x
  if (x >= period) return x - period
  if (x < 0) return x + period
  return x
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
  /** Centre of the first card in scroll coordinates — where the dots count from. */
  const originRef = useRef(0)
  /** In-flight arrow/dot glide. Relative distance only — see note 4 up top. */
  const glideRef = useRef<{ dist: number; moved: number; start: number; dur: number } | null>(null)
  /** Mirrors `reduced` for the callbacks, which must not re-create on it. */
  const reducedRef = useRef(false)
  // Our own float copy of the scroll position, accumulated independent of the
  // DOM. See note 5 up top: `el.scrollLeft` is where every prior version of
  // this drift silently died.
  const posRef = useRef(0)

  const [inView, setInView] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [snap, setSnap] = useState(false)
  const [active, setActive] = useState(0)

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
    // offsetLeft is layout-only (scrolling never changes it) and both elements
    // resolve to the same offsetParent, so the difference is the card's offset
    // inside the track — i.e. its position in scroll coordinates.
    originRef.current = first ? first.offsetLeft - track.offsetLeft + first.offsetWidth / 2 : 0
  }, [count])

  /** One-off DOM sync for the non-animated paths (reduced motion, manual
   *  jumps) — the animated path wraps `posRef.current` directly instead. */
  const wrap = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollLeft = wrapValue(el.scrollLeft, periodRef.current)
  }, [])

  /** Which card is centred right now — the one the dots light up for. */
  const syncActive = useCallback(() => {
    const el = scrollerRef.current
    const period = periodRef.current
    if (!el || period <= 0 || count === 0) return
    const stride = period / count
    const centre = el.scrollLeft + el.clientWidth / 2
    const i = Math.round((centre - originRef.current) / stride)
    const wrapped = ((i % count) + count) % count
    setActive((prev) => (prev === wrapped ? prev : wrapped))
  }, [count])

  /** Any real input wins: stop drifting, hand snapping back to the browser. */
  const yieldToUser = useCallback(() => {
    resumeAtRef.current = performance.now() + IDLE_MS
    setSnap(true)
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
    snapTimerRef.current = setTimeout(() => setSnap(false), IDLE_MS)
  }, [])

  /** Move the wall by whole cards, from an arrow tap or a dot tap. */
  const glide = useCallback((cards: number) => {
    const el = scrollerRef.current
    const period = periodRef.current
    if (!el || period <= 0 || !cards) return
    const stride = period / count
    const now = performance.now()

    // Snapping must be off while WE drive scrollLeft, for the same reason it is
    // off during the drift (note 3). A glide lands on an exact card boundary
    // anyway, so nothing is lost by not re-arming it afterwards.
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
    setSnap(false)

    if (reducedRef.current) {
      el.scrollLeft += cards * stride
      wrap()
      // Keep the accumulator honest — see note 5 up top — so a later toggle
      // out of reduced motion resumes drift from here, not a stale value.
      posRef.current = el.scrollLeft
      syncActive()
      resumeAtRef.current = now + IDLE_MS
      return
    }

    // Rapid taps add up instead of cancelling each other: whatever the previous
    // glide had left to travel is carried into the new one.
    const inFlight = glideRef.current
    const dist = cards * stride + (inFlight ? inFlight.dist - inFlight.moved : 0)
    const dur = Math.min(GLIDE_MAX_MS, GLIDE_BASE_MS + GLIDE_PER_CARD_MS * Math.abs(dist / stride))

    glideRef.current = { dist, moved: 0, start: now, dur }
    resumeAtRef.current = now + dur + IDLE_MS
  }, [count, wrap, syncActive])

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
    syncActive()
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { measure(); syncActive() })
    ro.observe(track)
    return () => ro.disconnect()
  }, [measure, syncActive])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { reducedRef.current = mq.matches; setReduced(mq.matches) }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // No rAF under reduced motion: there is no drift to run, and a glide takes
  // the instant branch above rather than animating.
  useEffect(() => {
    if (!inView || reduced) return
    let raf = 0
    let last = performance.now()
    posRef.current = scrollerRef.current?.scrollLeft ?? 0

    const step = (now: number) => {
      // Cap the delta so a backgrounded tab doesn't return and lurch forward.
      const dt = Math.min(now - last, 50)
      last = now
      const el = scrollerRef.current
      if (!el) { raf = requestAnimationFrame(step); return }

      const g = glideRef.current
      if (g) {
        const p = Math.min(1, (now - g.start) / g.dur)
        const eased = 1 - Math.pow(1 - p, 3)
        const want = g.dist * eased
        posRef.current += want - g.moved
        g.moved = want
        if (p >= 1) glideRef.current = null
        posRef.current = wrapValue(posRef.current, periodRef.current)
        el.scrollLeft = posRef.current
      } else if (!document.hidden && now >= resumeAtRef.current) {
        // Accumulated in `posRef`, never derived from `el.scrollLeft` — see
        // note 5 up top. This is the one line that was silently going nowhere.
        posRef.current += (SPEED_PX_S * dt) / 1000
        posRef.current = wrapValue(posRef.current, periodRef.current)
        el.scrollLeft = posRef.current
      } else {
        // Not driving right now (mid-interaction or cooling down): track
        // whatever native scrolling/touch is doing, so the accumulator isn't
        // stale the instant the drift is allowed to take back over.
        posRef.current = el.scrollLeft
      }

      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [inView, reduced])

  // Nothing to brag about yet — render nothing rather than an empty heading.
  if (!items.length) return null

  const doubled = [
    ...items.map((r) => ({ r, key: `a-${r.id}`, ghost: false })),
    ...items.map((r) => ({ r, key: `b-${r.id}`, ghost: true })),
  ]
  /** One quote can't be paged through — controls would be furniture. */
  const paged = count > 1

  return (
    <section id="reviews" ref={sectionRef} className={`rw${inView ? ' in' : ''}`} aria-label={t.region}>
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
        {/* A11y backlog A5 (WCAG 2.2 2.5.8): a standalone link, not inline in
            a sentence, so the spec's inline-text exception doesn't cover it
            — tap44 grows its real hit area to 44px without moving anything
            visually (same technique as Portal's/menu's footer links). */}
        <a className="rw-count tap44" href={block.url} target="_blank" rel="noopener noreferrer">
          {t.onGoogle}
        </a>
      </header>

      <div className="rw-stage">
        {paged && (
          <button type="button" className="rw-arrow rw-arrow-back" aria-label={t.prev} onClick={() => glide(-1)}>
            <Chevron back />
          </button>
        )}

        <div
          ref={scrollerRef}
          className="rw-scroller"
          style={{ scrollSnapType: snap ? 'x mandatory' : 'none' }}
          onScroll={syncActive}
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

        {paged && (
          <button type="button" className="rw-arrow rw-arrow-fwd" aria-label={t.next} onClick={() => glide(1)}>
            <Chevron back={false} />
          </button>
        )}
      </div>

      {paged && (
        <div className="rw-dots">
          {items.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className={`rw-dot${i === active ? ' is-on' : ''}`}
              aria-label={t.goTo(i + 1)}
              aria-current={i === active || undefined}
              onClick={() => glide(shortestHop(active, i, count))}
            />
          ))}
        </div>
      )}
    </section>
  )
}
