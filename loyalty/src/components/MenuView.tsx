'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import {
  LANGS, RTL, MENU_UI, loc, fmtPrice,
  type Lang, type MenuData, type MenuCategory, type MenuItem,
} from '@/lib/menu/types'
import { fetchMenuClient, fetchMenuStamp } from '@/lib/menu/client'

const POLL_MS = 30_000

export default function MenuView({ initial }: { initial: MenuData | null }) {
  const [menu, setMenu] = useState<MenuData | null>(initial)
  const [loading, setLoading] = useState(initial === null)
  const [lang, setLang] = useState<Lang>('he')
  const [openId, setOpenId] = useState<string | null>(initial?.categories[0]?.id ?? null)
  const [langOpen, setLangOpen] = useState(false)

  const langRef = useRef<HTMLDivElement>(null)
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
    setLang(l); localStorage.setItem('siteLanguage', l); setLangOpen(false)
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

  // Close the language menu on outside click / Escape.
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLangOpen(false) }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey) }
  }, [])

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

  function openCategory(id: string) {
    const next = openId === id ? null : id
    setOpenId(next)
    if (next) {
      requestAnimationFrame(() => {
        const sec = document.getElementById(`cat-${id}`)
        const stickyH = stickyRef.current?.offsetHeight ?? 0
        if (sec) window.scrollTo({ top: sec.getBoundingClientRect().top + window.pageYOffset - (stickyH + 10), behavior: 'smooth' })
      })
    }
  }

  const brand = menu ? (loc(menu.name, lang) || 'אייכה בר') : 'אייכה בר'

  return (
    <div className="menu-page">
      <div className="menu-scrim" aria-hidden />

      <div className="menu-sticky" ref={stickyRef}>
        <header className="menu-topbar">
          <div className={`menu-lang${langOpen ? ' open' : ''}`} ref={langRef}>
            <button className="menu-globe" aria-label="Language" aria-expanded={langOpen}
              onClick={(e) => { e.stopPropagation(); setLangOpen((v) => !v) }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
                <path d="M12 3c2.5 2.5 3.8 5.8 3.8 9S14.5 18.5 12 21C9.5 18.5 8.2 15.2 8.2 12S9.5 5.5 12 3z" />
              </svg>
            </button>
            <div className="menu-lang-menu" role="menu">
              {LANGS.map((l) => (
                <button key={l} role="menuitem" className={`menu-lang-opt${l === lang ? ' active' : ''}`}
                  onClick={() => pickLang(l)}>{MENU_UI.langName[l]}</button>
              ))}
            </div>
          </div>

          <div className="menu-brand">{brand}</div>

          <Link className="menu-back" href="/" aria-label={MENU_UI.back[lang]}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12H5" /><path d="M15 6l6 6-6 6" />
            </svg>
          </Link>
        </header>

        {menu && menu.categories.length > 0 && (
          <div className="menu-chips-wrap">
            <nav className="menu-chips" ref={chipsRef} aria-label="categories">
              {menu.categories.map((cat) => (
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

      <main className="menu-main">
        {loading ? (
          <MenuSkeleton />
        ) : !menu || menu.categories.length === 0 ? (
          <p className="menu-empty">{MENU_UI.unavailable[lang]}</p>
        ) : (
          menu.categories.map((cat) => (
            <CategorySection key={cat.id} cat={cat} lang={lang} open={cat.id === openId}
              badges={menu.badges} onToggle={() => openCategory(cat.id)} />
          ))
        )}
      </main>

      <footer className="menu-footer">{menu ? MENU_UI.footer[lang] : ''}</footer>
    </div>
  )
}

function CategorySection({
  cat, lang, open, badges, onToggle,
}: {
  cat: MenuCategory; lang: Lang; open: boolean
  badges: Record<string, { he?: string; en?: string; ar?: string }>; onToggle: () => void
}) {
  return (
    <section className={`cat${open ? ' open' : ''}`} id={`cat-${cat.id}`}>
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
      {price && <div className="price">{price}<span className="cur">₪</span></div>}
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
