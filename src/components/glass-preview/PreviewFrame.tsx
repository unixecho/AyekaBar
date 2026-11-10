'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Glass, Menu, SearchField } from 'glisse'
import { ArrowRight, CalendarDays, ChevronDown, ChevronLeft, House, LayoutGrid, LogOut, Moon, Search, Sun, UserRound, X } from 'lucide-react'
import type { Tile } from '@/lib/dashboard/tiles'
import { completePreviewTool, parsePreviewUsage, rankPreviewTools, recordPreviewUse, type ToolUsage } from '@/lib/dashboard/preview-tools'
import PreviewNotifications from './PreviewNotifications'
import './preview.css'

const T = {
  preview: 'תצוגה מקדימה', back: 'חזרה ללוח הקיים', tools: 'כלים', search: 'חיפוש כלי או פעולה',
  account: 'החשבון שלי', signout: 'התנתקות', appearance: 'מראה', dark: 'כהה', light: 'בהיר',
  empty: 'לא נמצאו כלים. נסו שם אחר או מילה מתוך התיאור.', dashboard: 'לוח הבקרה',
  subtitle: 'כל מה שקורה באייכה בר, במקום אחד.', current: 'הלוח הקיים', forYou: 'בשבילך',
  forYouHint: 'הקיצורים מתעדכנים לפי הכלים שפתחת', suggested: 'מומלץ להתחיל',
  frequently: 'בשימוש שלך', completion: 'השלמה', reset: 'איפוס המלצות',
  device: 'ההמלצות נשמרות רק במכשיר הזה, בנפרד לכל איש צוות.', close: 'סגירת כלים', schedule: 'סידור',
}

function ToolLink({ tile, className, active, id, anchorRef }: {
  tile: Tile; className: string; active?: boolean; id?: string; anchorRef?: (node: HTMLAnchorElement | null) => void
}) {
  const body = <><span className="ag-tool-icon" aria-hidden="true">{tile.icon}</span><span className="ag-tool-copy"><strong>{tile.he}</strong><small>{tile.hint}</small></span><ChevronLeft size={16} aria-hidden="true" /></>
  const attrs = { className, 'data-preview-tool': tile.id, role: id ? 'option' : undefined, 'aria-selected': active, id, ref: anchorRef }
  return tile.external
    ? <a {...attrs} href={tile.href} target={tile.newTab ? '_blank' : undefined} rel={tile.newTab ? 'noopener noreferrer' : 'noopener'}>{body}</a>
    : <Link {...attrs} href={tile.href}>{body}</Link>
}

export default function PreviewFrame({ children, tiles, backHref, staffId, mode = 'preview', scheduleHref, secondaryLink }: {
  children: ReactNode; tiles: Tile[]; backHref: string; staffId: string; mode?: 'preview' | 'live'; scheduleHref?: string;
  secondaryLink?: { href: string; label: string }
}) {
  const router = useRouter()
  const [look, setLook] = useState<'dark' | 'light'>('dark')
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [usage, setUsage] = useState<ToolUsage>({})
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const resultRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const validIds = useMemo(() => new Set(tiles.map((tile) => tile.id)), [tiles])

  useEffect(() => {
    setMounted(true)
    try { setUsage(parsePreviewUsage(localStorage.getItem(`ayeka.preview.tools.v1:${staffId}`), validIds)) }
    catch { setUsage({}) }
  }, [staffId, validIds])

  const remember = useCallback((id: string) => {
    if (!validIds.has(id)) return
    setUsage((previous) => {
      const next = recordPreviewUse(previous, id)
      try { localStorage.setItem(`ayeka.preview.tools.v1:${staffId}`, JSON.stringify(next)) } catch { /* memory still works for this visit */ }
      return next
    })
  }, [staffId, validIds])

  // PageTransitions captures links before React onClick; document capture still sees both home and finder links.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link) return
      const tile = link.dataset.previewTool
        ? tiles.find((item) => item.id === link.dataset.previewTool)
        : document.querySelector('.ag-main')?.contains(link) ? tiles.find((item) => item.href === link.getAttribute('href')) : null
      if (tile) remember(tile.id)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [remember, tiles])

  useEffect(() => {
    if (!expanded) return
    panelRef.current?.querySelector('input')?.focus()
    const panel = panelRef.current
    const fixClearLabel = () => panel?.querySelectorAll('.lg-input-clear').forEach((button) => button.setAttribute('aria-label', 'ניקוי החיפוש'))
    fixClearLabel()
    const observer = new MutationObserver(fixClearLabel)
    if (panel) observer.observe(panel, { childList: true, subtree: true })
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') closeDock() }
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('keydown', escape); observer.disconnect() }
  }, [expanded])

  const ranked = useMemo(() => rankPreviewTools(tiles, usage), [tiles, usage])
  const results = useMemo(() => rankPreviewTools(tiles, usage, query).slice(0, query.trim() ? 8 : 6), [tiles, usage, query])
  const completion = useMemo(() => completePreviewTool(results, query), [results, query])
  const hasHistory = Object.keys(usage).length > 0

  function closeDock() { setExpanded(false); requestAnimationFrame(() => toggleRef.current?.focus()) }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(Math.max(results.length - 1, 0), index + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) }
    else if (event.key === 'Tab' && completion && !event.shiftKey) { event.preventDefault(); setQuery(completion); setActive(0) }
    else if (event.key === 'Enter' && results[active]) { event.preventDefault(); resultRefs.current[active]?.click() }
    else if (event.key === 'Escape') { event.preventDefault(); closeDock() }
  }

  async function signOut() {
    const response = await fetch('/api/auth/signout', { method: 'POST' })
    if (response.ok) { router.push('/login'); router.refresh() }
  }

  const dock = <div className={`ayeka-glass-preview ag-floating look-${look}`} lang="he" dir="rtl">
    {expanded && <button className="ag-dock-scrim" type="button" aria-label={T.close} onClick={closeDock} />}
    <nav className={`ag-dock${expanded ? ' is-expanded' : ''}`} aria-label="ניווט ראשי">
      <div className="ag-dock-stack">
        {expanded && <div className="ag-dock-panel" ref={panelRef} id="ag-tool-panel">
          <div className="ag-dock-panel-head"><div><h2>{T.tools}</h2><p>{hasHistory ? T.forYouHint : T.suggested}</p></div><button type="button" aria-label={T.close} onClick={closeDock}><X size={20} /></button></div>
          <SearchField aria-label={T.search} placeholder={T.search} role="combobox" aria-expanded="true" aria-controls="ag-tool-results" aria-autocomplete="list"
            aria-activedescendant={results[active] ? `ag-tool-${active}` : undefined} autoComplete="off" enterKeyHint="search"
            value={query} onValueChange={(value) => { setQuery(value.slice(0, 60)); setActive(0) }} onKeyDown={onSearchKey} />
          {completion && <button className="ag-completion" type="button" onClick={() => { setQuery(completion); setActive(0); panelRef.current?.querySelector('input')?.focus() }}>
            <Search size={14} aria-hidden="true" /><span>{T.completion}: <strong>{completion}</strong></span><kbd>Tab</kbd>
          </button>}
          <div className="ag-tool-results" id="ag-tool-results" role="listbox" aria-label="תוצאות חיפוש כלים">
            {!query.trim() && <p className="ag-results-label">{hasHistory ? T.frequently : T.suggested}</p>}
            {results.map((tile, index) => <ToolLink key={tile.id} tile={tile} id={`ag-tool-${index}`} className={`ag-tool-result${active === index ? ' is-active' : ''}`} active={active === index}
              anchorRef={(node) => { resultRefs.current[index] = node }} />)}
            {!results.length && <p className="ag-tool-empty" role="status">{T.empty}</p>}
          </div>
          <div className="ag-dock-panel-foot"><small>{T.device}</small><button type="button" onClick={() => { setUsage({}); try { localStorage.removeItem(`ayeka.preview.tools.v1:${staffId}`) } catch { /* no stored history */ } }}>{T.reset}</button></div>
        </div>}
        <Glass className="ag-dock-inner">
          <a href="#main" aria-current="page" onClick={() => setExpanded(false)}><House size={21} /><span>{T.dashboard}</span></a>
          <button ref={toggleRef} className={expanded ? 'is-active' : ''} type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="ag-tool-panel"><LayoutGrid size={21} /><span>{T.tools}</span>{expanded ? <ChevronDown className="ag-dock-chevron" size={13} /> : null}</button>
          {mode === 'preview'
            ? <Link href={backHref}><ArrowRight size={21} /><span>{T.current}</span></Link>
            : <Link href={scheduleHref ?? '/staff/schedule'}><CalendarDays size={21} /><span>{T.schedule}</span></Link>}
        </Glass>
      </div>
    </nav>
  </div>

  return <div className={`ayeka-glass-preview look-${look}`} lang="he" dir="rtl">
    <div className="ag-backdrop" aria-hidden="true" />
    <header className="ag-top"><Glass className="ag-top-inner">
      <span className="ag-brand"><img src="/assets/logo.svg" alt="" width={35} height={35} /></span>
      <strong>אייכה בר</strong>{mode === 'preview' && <span className="ag-preview-label">{T.preview}</span>}<span className="ag-top-spacer" />
      <PreviewNotifications scheduleHref={scheduleHref ?? (backHref.startsWith('/staff') ? '/staff/schedule' : '/owner/schedule')} />
      <Menu aria-label={T.account} align="start" icon={<UserRound size={19} />} items={[
        ...(mode === 'preview' ? [{ label: <Link href={backHref}>{T.back}</Link>, icon: <ArrowRight size={17} /> }] : []),
        ...(secondaryLink ? [{ label: <Link href={secondaryLink.href}>{secondaryLink.label}</Link>, icon: <ArrowRight size={17} /> }] : []),
        { label: T.signout, icon: <LogOut size={17} />, destructive: true, onSelect: () => void signOut() },
      ]} />
    </Glass></header>
    <main id="main" className="ag-main" tabIndex={-1}>
      <div className="ag-welcome"><div><h1>{T.dashboard}</h1><p>{T.subtitle}</p></div>{mode === 'preview' && <span>{T.preview}</span>}</div>
      <div className="ag-toolbar">{mode === 'preview' && <Link href={backHref} className="ag-return"><ArrowRight size={15} aria-hidden="true" />{T.back}</Link>}
        <button className="ag-appearance" type="button" onClick={() => setLook(look === 'dark' ? 'light' : 'dark')} aria-label={`${T.appearance}: ${look === 'dark' ? T.dark : T.light}`}>{look === 'dark' ? <Moon size={17} /> : <Sun size={17} />}</button>
      </div>
      <section className="ag-shortcuts" aria-labelledby="ag-shortcuts-title"><div className="ag-shortcuts-head"><h2 id="ag-shortcuts-title">{T.forYou}</h2><span>{T.forYouHint}</span></div>
        <Glass className="ag-shortcut-list">{ranked.slice(0, 3).map((tile) => <ToolLink key={tile.id} tile={tile} className="ag-shortcut" />)}</Glass>
      </section>
      {children}
    </main>
    {mounted && createPortal(dock, document.body)}
  </div>
}
