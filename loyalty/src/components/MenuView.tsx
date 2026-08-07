'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import {
  LANGS, RTL, MENU_UI, loc, fmtPrice,
  type Lang, type MenuData, type MenuCategory, type MenuItem,
} from '@/lib/menu/types'
import { fetchMenuClient, fetchMenuStamp, fetchHappyHour } from '@/lib/menu/client'
import { applyHappyHour, isHappyHourActive, type HappyHour, type DiscountedItem } from '@/lib/menu/variants'
import LanguageSwitch from '@/components/LanguageSwitch'

const POLL_MS = 30_000

export default function MenuView({ initial }: { initial: MenuData | null }) {
  const [menu, setMenu] = useState<MenuData | null>(initial)
  const [loading, setLoading] = useState(initial === null)
  const [happyHour, setHappyHour] = useState<HappyHour | null>(null)
  // Re-evaluate every minute so the discount appears and disappears on time
  // for a customer sitting with the menu open.
  const [, setMinuteTick] = useState(0)
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
  const categories = useMemo(
    () => (menu ? applyHappyHour(menu.categories, happyHour) : []),
    // minuteTick is intentionally not referenced here — the state update alone
    // re-runs this on each tick, which is what makes the window close on time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu, happyHour, happyActive],
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
  useEffect(() => {
    const setH = () => document.documentElement.style.setProperty('--sticky-h', `${stickyRef.current?.offsetHeight ?? 108}px`)
    setH()
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

  return (
    <div className="menu-page">
      <div className="app-bg" aria-hidden />
      <div className="menu-scrim" aria-hidden />

      <div className="menu-sticky" ref={stickyRef}>
        <header className="menu-topbar">
          {/* Same control as the portal and team page — inline so it sits in
              the sticky topbar rather than floating over the menu. */}
          <div className="rise" style={{ animationDelay: '20ms' }}>
            <LanguageSwitch lang={lang} onChange={pickLang} variant="inline" />
          </div>

          <div className="menu-brand rise" style={{ animationDelay: '90ms' }}>{brand}</div>

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
      </div>

      {/* Say why prices are lower than the printed menu, and until when. */}
      {happyActive && happyHour && (
        <div
          className="rise"
          style={{
            margin: '10px 14px 0', padding: '10px 14px', borderRadius: 13,
            display: 'flex', alignItems: 'center', gap: 9,
            background: 'linear-gradient(135deg, rgba(255,94,58,0.18), rgba(255,138,92,0.08))',
            border: '1px solid rgba(255,94,58,0.32)',
          }}
        >
          <span aria-hidden style={{ fontSize: '1.05rem' }}>🍹</span>
          <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.9rem' }}>
            {MENU_UI.happyHour[lang]}
          </span>
          <span dir="ltr" style={{ marginInlineStart: 'auto', fontSize: '0.82rem', fontWeight: 600, color: 'var(--neon-soft)' }}>
            {MENU_UI.happyHourUntil[lang]} {happyHour.end}
          </span>
        </div>
      )}

      <main className="menu-main">
        {loading ? (
          <MenuSkeleton />
        ) : !menu || categories.length === 0 ? (
          <p className="menu-empty">{MENU_UI.unavailable[lang]}</p>
        ) : (
          categories.map((cat, i) => (
            <CategorySection key={cat.id} cat={cat} lang={lang} open={cat.id === openId}
              badges={menu.badges} delay={Math.min(i, 8) * 45} onToggle={() => openCategory(cat.id)} />
          ))
        )}
      </main>

      <footer className="menu-footer">{menu ? MENU_UI.footer[lang] : ''}</footer>
    </div>
  )
}

function CategorySection({
  cat, lang, open, badges, delay, onToggle,
}: {
  cat: MenuCategory; lang: Lang; open: boolean
  badges: Record<string, { he?: string; en?: string; ar?: string }>; delay: number; onToggle: () => void
}) {
  return (
    <section className={`cat rise${open ? ' open' : ''}`} id={`cat-${cat.id}`} style={{ animationDelay: `${delay}ms` }}>
      <button className="cat-head" type="button" aria-expanded={open} onClick={onToggle}>
        <span className="ic">{cat.icon ?? ''}</span>
        <span className="ttl">{loc(cat.title, lang)}</span>
        <span className="count">{cat.items.length} {MENU_UI.items[lang]}</span>
        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <div className="cat-body">
        <div className="cat-body-inner">
          <div className="cat-pad">
            {cat.note && <div className="cat-note">{loc(cat.note, lang)}</div>}
            {cat.items.map((it, i) => (
              <ItemRow key={i} it={it} i={i} lang={lang} badges={badges} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ItemRow({
  it, i, lang, badges,
}: {
  it: MenuItem; i: number; lang: Lang
  badges: Record<string, { he?: string; en?: string; ar?: string }>
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
        {it.note && <div className="item-note">{loc(it.note, lang)}</div>}
      </div>
      {price && (
        <div className="price">
          {wasPrice && (
            <span
              title={MENU_UI.wasPrice[lang]}
              style={{
                display: 'block', fontSize: '0.72em', fontWeight: 600,
                color: 'var(--text-faint)', textDecoration: 'line-through',
                lineHeight: 1.1, marginBottom: 1,
              }}
            >{wasPrice}₪</span>
          )}
          <span style={wasPrice ? { color: 'var(--neon-soft)' } : undefined}>
            {price}<span className="cur">₪</span>
          </span>
        </div>
      )}
    </div>
  )
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
