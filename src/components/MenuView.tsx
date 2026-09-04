'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import {
  LANGS, RTL, MENU_UI, loc, fmtPrice, applyResolvedVariant,
  type Lang, type MenuData, type MenuCategory, type MenuItem,
} from '@/lib/menu/types'
import { fetchMenuClient, fetchMenuStamp, fetchHappyHour } from '@/lib/menu/client'
import { applyHappyHour, isHappyHourActive, type HappyHour, type DiscountedItem } from '@/lib/menu/variants'
import LanguageSwitch from '@/components/LanguageSwitch'
import CartProvider, { type CartActionAvailability } from '@/components/cart/CartProvider'
import CartFab from '@/components/cart/CartFab'
import CartTutorial from '@/components/cart/CartTutorial'
import CartSheet from '@/components/cart/CartSheet'
import DinerStrip from '@/components/cart/DinerStrip'
import AddToCartControl from '@/components/cart/AddToCartControl'
import FeedbackButton from '@/components/FeedbackButton'

const POLL_MS = 30_000

/** Owner-switched off, or the whole cart feature absent: the menu renders
 *  exactly as it did before any of it existed. Nothing below `cartEnabled`
 *  is mounted, so a disabled cart costs a customer nothing — not a provider,
 *  not a stylesheet's worth of layout, not a localStorage read. */
export default function MenuView({
  initial, cartEnabled = false, cartActions = { ordering: false, call: false }, feedbackEnabled = true,
}: {
  initial: MenuData | null
  cartEnabled?: boolean
  cartActions?: CartActionAvailability
  /** The owner's switch for the feedback box — same prop the portal takes.
   *  See FeedbackButton's own note. */
  feedbackEnabled?: boolean
}) {
  const [menu, setMenu] = useState<MenuData | null>(initial)
  const [loading, setLoading] = useState(initial === null)
  const [happyHour, setHappyHour] = useState<HappyHour | null>(null)
  // Re-evaluate every minute so a scheduled menu version and the Happy Hour
  // window both start and end on time for a customer sitting with the page open.
  const [minuteTick, setMinuteTick] = useState(0)
  const [lang, setLang] = useState<Lang>('he')
  const [openId, setOpenId] = useState<string | null>(initial?.categories[0]?.id ?? null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)

  // Restore saved language, sync <html> dir/lang.
  useEffect(() => {
    const saved = localStorage.getItem('siteLanguage')
    if (saved && (LANGS as string[]).includes(saved)) setLang(saved as Lang)
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = RTL[lang] ? 'rtl' : 'ltr'
  }, [lang])

  function pickLang(l: Lang) {
    setLang(l); localStorage.setItem('siteLanguage', l)
  }

  // If the server couldn't fetch, try from the client.
  useEffect(() => {
    if (initial) return
    let alive = true
    fetchMenuClient().then((m) => {
      if (!alive) return
      setMenu(m); setLoading(false)
      setOpenId((cur) => cur ?? m?.categories[0]?.id ?? null)
    })
    return () => { alive = false }
  }, [initial])

  // Live updates: poll the publish stamp; refetch the menu when it changes.
  const stampRef = useRef<string | null>(initial?.publishedAt ?? null)
  const refresh = useCallback(async () => {
    const stamp = await fetchMenuStamp()
    if (stamp && stamp !== stampRef.current) {
      const fresh = await fetchMenuClient()
      if (fresh) {
        stampRef.current = fresh.publishedAt
        setMenu(fresh)
        setOpenId((cur) => (cur && fresh.categories.some((c) => c.id === cur)) ? cur : (fresh.categories[0]?.id ?? null))
      }
    }
  }, [])
  useEffect(() => {
    const id = setInterval(refresh, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh])

  // Happy hour is read client-side and re-checked every minute, so the window
  // opens and closes on time instead of whenever a cache expires.
  useEffect(() => {
    let alive = true
    fetchHappyHour().then((hh) => { if (alive) setHappyHour(hh) })
    const poll = setInterval(() => { fetchHappyHour().then((hh) => { if (alive) setHappyHour(hh) }) }, POLL_MS * 4)
    const tick = setInterval(() => setMinuteTick((n) => n + 1), 60_000)
    return () => { alive = false; clearInterval(poll); clearInterval(tick) }
  }, [])

  const happyActive = isHappyHourActive(happyHour)

  // Resolve the scheduled version, then apply Happy Hour on top. Both are
  // time-dependent, so both are recomputed on the minute tick — that's what
  // makes "יום שישי" take over and hand back automatically without a reload.
  const resolved = useMemo(
    () => (menu ? applyResolvedVariant(menu) : null),
    // minuteTick is intentionally unreferenced: the state update alone re-runs
    // this, which is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu, minuteTick],
  )
  const variantLabel = resolved?.variantName ? loc(resolved.variantName, lang) : ''
  const categories = useMemo(
    () => (resolved ? applyHappyHour(resolved.categories, happyHour) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved, happyHour, happyActive, minuteTick],
  )

  const centerChip = useCallback((id: string | null, instant = false) => {
    const chips = chipsRef.current
    if (!chips || !id) return
    const fits = chips.scrollWidth <= chips.clientWidth + 1
    chips.classList.toggle('fits', fits)
    if (fits) return
    const chip = chips.querySelector<HTMLElement>(`[data-chip="${id}"]`)
    chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: instant ? 'auto' : 'smooth' })
  }, [])

  useEffect(() => { centerChip(openId, true) }, [openId, menu, lang, centerChip])

  // Track sticky-header height in a CSS var so scroll-margin-top lands an opened
  // category's top just below the sticky bar.
  //
  // A ResizeObserver rather than the old resize-listener-plus-dependency-list:
  // the bar's own height now changes for reasons that are not a viewport
  // resize and are not in any dep array — the cart's diner strip appears
  // inside it on the first add, and grows a row as names are added. Observing
  // the element itself is the only version of this that cannot go stale.
  // Falls back to the window listener where ResizeObserver is missing.
  useEffect(() => {
    const setH = () => document.documentElement.style.setProperty('--sticky-h', `${stickyRef.current?.offsetHeight ?? 108}px`)
    setH()
    const el = stickyRef.current
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(setH)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', setH)
    return () => window.removeEventListener('resize', setH)
  }, [menu, lang])

  // On open, scroll so the category's TOP sits under the sticky bar — but wait
  // for the accordion (and the collapsing sibling) to finish animating, so we
  // scroll to the settled position, not the pre-collapse one. Skip on mount.
  const firstOpen = useRef(true)
  useEffect(() => {
    if (firstOpen.current) { firstOpen.current = false; return }
    if (!openId) return
    const sec = document.getElementById(`cat-${openId}`)
    if (!sec) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let done = false
    const go = () => { if (done) return; done = true; sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }) }
    const body = sec.querySelector('.cat-body')
    const onEnd = (e: Event) => { if ((e as TransitionEvent).propertyName === 'grid-template-rows') go() }
    body?.addEventListener('transitionend', onEnd)
    const fallback = window.setTimeout(go, 520)
    return () => { body?.removeEventListener('transitionend', onEnd); clearTimeout(fallback) }
  }, [openId])

  function openCategory(id: string) {
    setOpenId((cur) => (cur === id ? null : id))
  }

  const brand = menu ? (loc(menu.name, lang) || 'אייכה בר') : 'אייכה בר'

  const page = (
    <div className="menu-page">
      <div className="app-bg" aria-hidden />
      <div className="menu-scrim" aria-hidden />

      <div className="menu-sticky" ref={stickyRef}>
        <header className="menu-topbar">
          {/* .menu-topbar centres its children, so this has to be pulled out
              of the flow the way the old .menu-lang rule did — otherwise the
              globe sits inline next to the brand and shoves the title over. */}
          <div className="rise" style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            zIndex: 50, animationDelay: '20ms',
          }}>
            <LanguageSwitch lang={lang} onChange={pickLang} variant="inline" />
          </div>

          <h1 className="menu-brand rise" style={{ animationDelay: '90ms' }}>{brand}</h1>

          <Link className="menu-back rise" href="/" aria-label={MENU_UI.back[lang]} style={{ animationDelay: '20ms' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12H5" /><path d="M15 6l6 6-6 6" />
            </svg>
          </Link>
        </header>

        {menu && categories.length > 0 && (
          <div className="menu-chips-wrap rise" style={{ animationDelay: '160ms' }}>
            <nav className="menu-chips" ref={chipsRef} aria-label="categories">
              {categories.map((cat) => (
                <button key={cat.id} data-chip={cat.id} type="button"
                  className={`menu-chip${cat.id === openId ? ' active' : ''}`}
                  onClick={() => openCategory(cat.id)}>
                  <span className="ic">{cat.icon ?? ''}</span>{loc(cat.title, lang)}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Inside the sticky bar, under the chips: "who am I adding for?" has
            to stay answerable while scrolling the menu, because that is when
            the answer changes. Renders nothing until the cart has something
            in it. */}
        {cartEnabled && <DinerStrip lang={lang} />}
      </div>

      {/* Which version of the menu this is, right under the nav bar. */}
      {variantLabel && (
        <div className="menu-version-banner rise" style={{ animationDelay: '120ms' }}>
          <span aria-hidden>🍽️</span>
          <span>{variantLabel}</span>
        </div>
      )}

      {/* A11y (WCAG 4.1.3): a persistent, visually-hidden announcer — the
          banner below is aria-live="polite" too, but it's conditionally
          MOUNTED, so the window opening mid-visit renders a brand-new node
          with content already inside it. Screen readers reliably announce
          MUTATIONS to an existing live region, not the arrival of one —
          same class of gap A9 fixed for the cart's first add. Found
          2026-09-04. This span always exists; only its text changes. */}
      <span aria-live="polite" aria-atomic="true" style={srOnly}>
        {happyActive && happyHour ? `${MENU_UI.happyHour[lang]}: ${MENU_UI.happyHourSub[lang]}` : ''}
      </span>

      {/* Happy hour leads the page when it's live — centred, ahead of every
          category, because a discount nobody notices may as well not exist.
          Plain now, not aria-live — the persistent span above owns the
          announcement; this section stays a normal, fully-discoverable
          part of the page (its own <h2>, reachable by heading navigation)
          for a visitor who lands here fresh, mid-window, and never heard
          any live announcement at all. */}
      {happyActive && happyHour && (
        <section className="menu-hh rise" style={{ animationDelay: '150ms' }}>
          <span className="menu-hh-glow" aria-hidden />
          <span className="menu-hh-emoji" aria-hidden>🍹</span>
          <h2 className="menu-hh-title">{MENU_UI.happyHour[lang]}</h2>
          <p className="menu-hh-sub">
            {MENU_UI.happyHourSub[lang]}
          </p>
          <span className="menu-hh-window" dir="ltr">
            {happyHour.start} – {happyHour.end}
          </span>
        </section>
      )}

      <main id="main" className="menu-main">
        {loading ? (
          <MenuSkeleton />
        ) : !menu || categories.length === 0 ? (
          <p className="menu-empty">{MENU_UI.unavailable[lang]}</p>
        ) : (
          categories.map((cat, i) => (
            <CategorySection key={cat.id} cat={cat} lang={lang} open={cat.id === openId}
              badges={menu.badges} delay={Math.min(i, 8) * 45} onToggle={() => openCategory(cat.id)}
              cartEnabled={cartEnabled} />
          ))
        )}
      </main>

      {/* Extra clearance so the floating cart button never covers the last
          line of the footer on a short menu. Only when there is a button. */}
      <footer className="menu-footer" style={cartEnabled ? { paddingBottom: 110 } : undefined}>
        {menu ? MENU_UI.footer[lang] : ''}
        {/* A11y backlog A14 (WCAG 2.2 3.2.6 Consistent Help): the portal has
            had an accessibility-statement link and a feedback trigger since
            2026-09-01; /menu had neither, only the back arrow to "/". Same
            two links, same relative order, same footer position — a
            "consistent help mechanism" means literally that. */}
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', gap: 16 }}>
          <Link href="/accessibility" className="tap44" style={{ color: 'var(--text-faint)', textDecoration: 'underline', fontSize: '0.8rem' }}>
            {MENU_UI.accessibility[lang]}
          </Link>
          <FeedbackButton lang={lang} enabled={feedbackEnabled} variant="link" />
        </div>
      </footer>

      {cartEnabled && (
        <>
          <CartFab lang={lang} />
          <CartSheet lang={lang} />
          {/* The one-time walkthrough. Mounted here rather than inside the FAB
              because closing it is what SUMMONS the FAB — it has to outlive
              the thing it introduces. */}
          <CartTutorial lang={lang} />
        </>
      )}
    </div>
  )

  if (!cartEnabled) return page
  return <CartProvider lang={lang} actions={cartActions}>{page}</CartProvider>
}

function CategorySection({
  cat, lang, open, badges, delay, onToggle, cartEnabled,
}: {
  cat: MenuCategory; lang: Lang; open: boolean
  badges: Record<string, { he?: string; en?: string; ar?: string }>; delay: number; onToggle: () => void
  cartEnabled: boolean
}) {
  // A11y: a closed category was ONLY hidden visually (0-height grid track +
  // overflow:hidden) — every item row's real <button> (add-to-cart, the
  // stepper) stayed fully keyboard-focusable while invisible. Found
  // 2026-09-04: a keyboard user tabbing sequentially, rather than via the
  // category headings, passed through every closed category's entire
  // button set before reaching the next visible control — the exact
  // failure mode CartFab.tsx's own header already documents and guards
  // against for its own hidden state (aria-hidden + tabIndex=-1 on top of
  // opacity:0), just never applied here. `inert` does both jobs in one
  // attribute — removes the whole closed subtree from the tab order AND
  // the accessibility tree — set imperatively via a ref rather than as a
  // JSX prop, since this codebase's TS/React version doesn't have `inert`
  // in its JSX attribute typings.
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.inert = !open
  }, [open])

  return (
    <section className={`cat rise${open ? ' open' : ''}`} id={`cat-${cat.id}`} style={{ animationDelay: `${delay}ms` }}>
      {/* The button is WRAPPED IN A HEADING, which is the WAI-ARIA accordion
          pattern and not a decoration. Audited against the live site
          2026-09-02: the menu page had ZERO headings — 95 items and nothing
          for a screen-reader user to navigate by, so reaching the cocktails
          meant arrowing through the food one line at a time. The heading
          gives them the category list; the button inside it still does the
          expanding. `.cat-h` carries no visual style of its own (see
          globals.css) so nothing about the design moves. */}
      <h2 className="cat-h">
      <button className="cat-head" type="button" aria-expanded={open} onClick={onToggle}>
        <span className="ic">{cat.icon ?? ''}</span>
        <span className="ttl">{loc(cat.title, lang)}</span>
        <span className="count">{cat.items.length} {MENU_UI.items[lang]}</span>
        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      </h2>
      <div className="cat-body" ref={bodyRef}>
        <div className="cat-body-inner">
          <div className="cat-pad">
            {/* Test the RESOLVED string, not the object: a note of `{}` or
                `{he: ''}` is truthy and rendered an empty bordered box. */}
            {loc(cat.note, lang) && <div className="cat-note">{loc(cat.note, lang)}</div>}
            {cat.items.map((it, i) => (
              // Keyed by uid where there is one: a menu republished mid-visit
              // reorders items, and an index key would then hand a row's
              // React state (an open choice sheet, say) to a different drink.
              <ItemRow key={it.uid ?? `i${i}`} it={it} i={i} lang={lang} badges={badges}
                categoryId={cat.id} categoryTitle={cat.title} cartEnabled={cartEnabled} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ItemRow({
  it, i, lang, badges, categoryId, categoryTitle, cartEnabled,
}: {
  it: MenuItem; i: number; lang: Lang
  badges: Record<string, { he?: string; en?: string; ar?: string }>
  categoryId: string
  categoryTitle: { he?: string; en?: string; ar?: string }
  cartEnabled: boolean
}) {
  const blist = it.badges ?? (it.badge ? [it.badge] : [])
  const price = fmtPrice(it.price)
  const d = it as DiscountedItem
  const wasPrice = d.discountPercent ? fmtPrice(d.originalPrice) : ''
  return (
    <div className={`item${it.available === false ? ' sold' : ''}`} style={{ ['--i' as string]: i } as CSSProperties}>
      {it.image && <img className="item-thumb" src={it.image} alt="" loading="lazy" />}
      <div className="item-main">
        <div className="item-top">
          <span className="item-name">{loc(it, lang)}</span>
          {blist.map((bk) => badges[bk] && (
            <span key={bk} className={`badge ${bk}`}>{loc(badges[bk], lang)}</span>
          ))}
          {it.available === false && <span className="badge sold-badge">{MENU_UI.sold[lang]}</span>}
        </div>
        {loc(it.note, lang) && <div className="item-note">{loc(it.note, lang)}</div>}
        {/* Item E, 2026-08-15: "we want the customers to know the available
            flavours" — read-only here, no selection (customers can't order
            yet, CLAUDE.md's own boundary). Same choices ayeka-staff's
            waiters pick from when they add the line. */}
        {it.options?.map((g) => g.choices.length > 0 && (
          <div className="item-note" key={g.id}>
            {loc(g.label, lang)}: {g.choices.map((c) => loc(c, lang)).filter(Boolean).join(', ')}
          </div>
        ))}
      </div>
      {/* Price and the add control share a column so a long item name on a
          390px phone squeezes the NAME (which wraps) rather than pushing the
          price and the button onto each other. */}
      {(price || cartEnabled) && (
        <div className="item-tail">
          {price && (
            <div className="price">
              {wasPrice && (
                // A11y (WCAG 1.3.1): `title` alone is mouse-hover-only and
                // unreliable on screen readers — the strikethrough is
                // CSS-only, so a screen-reader user heard two numbers with
                // no indication which was the old one. Real (visually
                // hidden) text now says so directly; `title` stays for a
                // sighted mouse user hovering it. Found 2026-09-04.
                <span
                  title={MENU_UI.wasPrice[lang]}
                  style={{
                    display: 'block', fontSize: '0.72em', fontWeight: 600,
                    color: 'var(--text-faint)', textDecoration: 'line-through',
                    lineHeight: 1.1, marginBottom: 1,
                  }}
                ><span style={srOnly}>{MENU_UI.wasPrice[lang]}: </span>{wasPrice}₪</span>
              )}
              <span style={wasPrice ? { color: 'var(--neon-soft)' } : undefined}>
                {price}<span className="cur">₪</span>
              </span>
            </div>
          )}
          {cartEnabled && (
            // Happy Hour rewrites `it.price` in place before this renders
            // (applyHappyHour, above), so the cart snapshots the DISCOUNTED
            // price the customer is actually looking at — which is the whole
            // point of snapshotting rather than re-reading the menu later.
            <AddToCartControl item={it} categoryId={categoryId} categoryTitle={categoryTitle} lang={lang} />
          )}
        </div>
      )}
    </div>
  )
}

/** Visually hidden but still reachable by assistive tech — same technique
 *  (and same values) as AddToCartControl.tsx's own srOnly. */
const srOnly: CSSProperties = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden',
  clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0, padding: 0, margin: -1,
}

function MenuSkeleton() {
  return (
    <div>
      {[0, 1, 2].map((c) => (
        <section className="cat" key={c} style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="sk" style={{ width: 40, height: 40, borderRadius: 12 }} />
            <div className="sk" style={{ width: '45%', height: 16, borderRadius: 6 }} />
          </div>
        </section>
      ))}
    </div>
  )
}
