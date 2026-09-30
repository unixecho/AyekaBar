'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MENU_SLUG, loc, type MenuCategory, type MenuItem, type MenuOptionGroup, type Localized } from '@/lib/menu/types'
import { mintUid } from '@/lib/menu/variants'
import { entryName, firstText, type ArchiveEntry } from '@/lib/menu/archive'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import ModalPortal from '@/components/ModalPortal'
import MenuVersionBar from '@/components/MenuVersionBar'
import HappyHourCard from '@/components/HappyHourCard'
import MenuCartCard from '@/components/MenuCartCard'
import Switch from '@/components/Switch'

const T = {
  // "עריכת התפריט" → "תפריט" on the dashboard tile (2026-08-29): versions,
  // Happy Hour, temp menus, stock and the public view all live behind this
  // one door, so naming it after only the editing is naming a third of it.
  // The heading here stays explicit about what the screen is.
  title: 'תפריט',
  loading: 'טוען תפריט…',
  loadErr: 'טעינת התפריט נכשלה.',
  save: 'שמירת טיוטה', saving: 'שומר…', saved: 'נשמר ✓',
  publish: 'פרסום', publishing: 'מפרסם…', published: 'פורסם ✓',
  publishHint: 'פרסום הופך את השינויים השמורים לגלויים ללקוחות.',
  unsaved: 'שינויים שלא נשמרו',
  addCat: '+ קטגוריה', addItem: '+ פריט', del: 'מחיקה',
  // 86 (2026-09-29): "make a way for items and categories to be 86'd and not
  // deleted... easy to understand for people who have no tech background."
  // Delete used to be the only way to take something off the menu, and it was
  // gone for good. Now the button says what the owner is actually trying to do
  // ("take it off the menu") and the answer to "what if I need it back?" is on
  // the confirmation itself, not in a manual. Written in the passive so it
  // reads the same to whoever holds the phone.
  archive: '86 · הורדה מהתפריט',
  archiveCat: '86 · הורדת הקטגוריה מהתפריט',
  archiveConfirm: 'כן, להוריד מהתפריט',
  archiveItemTitle: (name: string) => `להוריד את "${name}" מהתפריט?`,
  archiveItemBody: 'הוא יורד מהתפריט של הלקוחות מיד, אבל לא נמחק. הוא מחכה ברשימת 86 שבראש העמוד, ואפשר להחזיר אותו בלחיצה אחת.',
  archiveCatTitle: (name: string) => `להוריד את הקטגוריה "${name}" מהתפריט?`,
  archiveCatBody: (n: number) => `הקטגוריה וכל ${n} הפריטים שבה יורדים מהתפריט של הלקוחות מיד, אבל לא נמחקים. הכול מחכה ברשימת 86 שבראש העמוד, ואפשר להחזיר בלחיצה אחת.`,
  archivedMsg: (name: string) => `"${name}" ירד מהתפריט ✓ (מחכה ברשימת 86)`,
  restoredMsg: (name: string) => `"${name}" חזר לתפריט ✓`,
  soldVs86: 'אזל = הפריט נשאר בתפריט עם תווית "אזל". 86 = הפריט יורד מהתפריט לגמרי ונשמר ברשימת 86, ואפשר להחזיר אותו.',
  list86Title: '86 · ירדו מהתפריט',
  list86Hint: 'פריטים וקטגוריות שהורדו מהתפריט לא נמחקים — הם מחכים כאן. "החזרה לתפריט" מחזירה אותם בדיוק למקום שלהם, והלקוחות רואים אותם מיד.',
  list86Empty: 'אין כרגע כלום ברשימה. כשמורידים פריט או קטגוריה מהתפריט (כפתור 86), הם מופיעים כאן.',
  list86Load: 'טעינת רשימת 86 נכשלה.',
  list86Retry: 'ניסיון חוזר',
  restore: 'החזרה לתפריט',
  purge: 'מחיקה לצמיתות',
  purgeTitle: (name: string) => `למחוק את "${name}" לצמיתות?`,
  purgeBody: 'אחרי המחיקה אי אפשר להחזיר אותו. אם לא בטוחים, עדיף להשאיר אותו ברשימה.',
  kindCategory: 'קטגוריה',
  fromCat: 'מתוך',
  itemsWord: 'פריטים',
  actionFailed: 'הפעולה נכשלה. נסה/י שוב.',
  icon: 'אייקון', he: 'עברית', en: 'English', ar: 'العربية',
  name: 'שם', note: 'תיאור', price: 'מחיר (מספר, טווח כמו 30/34, או ריק)',
  catTitle: 'שם הקטגוריה', catNote: 'הערת קטגוריה',
  // A11y (WCAG 4.1.2 / 3.1.2): the category/item expand-collapse toggles had
  // no aria-label/aria-expanded at all, and the reorder arrows' aria-labels
  // were hardcoded English ("up"/"down") in an otherwise all-Hebrew RTL
  // app — found 2026-09-04.
  expand: 'הרחבה', collapse: 'כיווץ', moveUp: 'הזזה למעלה', moveDown: 'הזזה למטה',
  mustTry: 'חובה לטעום', badgeNew: 'חדש', sold: 'אזל',
  // Out-of-stock overview (2026-08-20) — "put all the items marked out of
  // stock in the same category for the managers to return it to the menu
  // quickly... and to easily see which items are out of stock."
  outOfStockTitle: 'אזל מהמלאי',
  outOfStockHint: 'כל הפריטים שסומנו כ"אזל", מכל הקטגוריות, כדי שיהיה קל למצוא ולהחזיר למלאי בלחיצה אחת.',
  backInStock: '↩ החזרה למלאי',
  viewMenu: 'צפייה בתפריט', dash: '← ניהול',
  // 2026-09-01: returning an item to stock only edits the DRAFT — the
  // out-of-stock dashboard signal disappears (it reads the draft) while
  // customers, who read `published`, still see the item as אזל until
  // someone separately remembers to hit "פרסום". The gap between "the
  // warning went away" and "it's actually visible to customers" read as a
  // bug, not two correctly-separate steps — so prompt for the second step
  // right where the first one just happened, instead of leaving it to a
  // signal the owner has to notice later.
  publishStockTitle: 'המוצר הוחזר למלאי בטיוטה',
  publishStockBody: 'הלקוחות עדיין רואים את התפריט הישן ולא יראו את המוצר עד שתפרסם/י.',
  publishStockNow: 'פרסם עכשיו',
  publishStockLater: 'אעשה זאת אחר כך',
  empty: 'אין עדיין קטגוריות. הוסף/י אחת למטה.',
  // Item options (item E, 2026-08-15) — same-priced named choices a price
  // split can't express: hookah flavor, a pasta sauce.
  options: 'אפשרויות (כמו טעם נרגילה)',
  optionGroupName: 'שם הקבוצה (למשל: טעם)',
  optionChoiceName: 'שם האפשרות (למשל: תפוח)',
  addChoice: '+ אפשרות',
  addOptionGroup: '+ קבוצת אפשרויות',
}

/** What /api/owner/menu-86 answers with. */
interface Reply86 {
  error?: string
  entries?: ArchiveEntry[]
  categories?: MenuCategory[]
  publishedAt?: string | null
}

function priceToInput(p: MenuItem['price']): string {
  if (p === null || p === undefined) return ''
  return String(p)
}
function inputToPrice(s: string): MenuItem['price'] {
  const v = s.trim()
  if (v === '') return null
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : v
}

export default function MenuEditor() {
  const supabase = createClient()
  const [menuId, setMenuId] = useState<string | null>(null)
  const [cats, setCats] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [savedTick, setSavedTick] = useState(false)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [openCat, setOpenCat] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  // See restoreItem() / save()'s own comments — tracks whether an item was
  // returned to stock since the last publish, so a successful save can
  // offer to publish immediately instead of leaving that step to a
  // dashboard signal the owner has to separately notice.
  const [stockJustRestored, setStockJustRestored] = useState(false)
  // The 86 list. Loaded from its own route (it is not part of the draft).
  const [entries, setEntries] = useState<ArchiveEntry[]>([])
  const [list86Open, setList86Open] = useState(false)
  const [list86Error, setList86Error] = useState(false)
  // One 86 action at a time: each one saves the draft first and then swaps the
  // editor's copy for the server's, so two overlapping would race on that swap.
  const [busy86, setBusy86] = useState(false)

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/menu-86', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setEntries(j.entries ?? [])
      setList86Error(false)
    } catch {
      setList86Error(true)
    }
  }, [])

  useEffect(() => { void loadEntries() }, [loadEntries])
  // The dashboard and other pages can deep-link straight to the list.
  useEffect(() => {
    if (window.location.hash === '#menu-86') setList86Open(true)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase
        .from('menus')
        .select('id, draft, published_at')
        .eq('slug', MENU_SLUG)
        .single()
      if (!alive) return
      if (error || !data) { setLoadError(true); setLoading(false); return }
      setMenuId(data.id)
      setCats((data.draft?.categories as MenuCategory[]) ?? [])
      setPublishedAt(data.published_at ?? null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [supabase])

  // clone-on-write helper
  const edit = useCallback((mut: (draft: MenuCategory[]) => void) => {
    setCats((prev) => { const next = structuredClone(prev); mut(next); return next })
    setDirty(true); setSavedTick(false)
  }, [])

  // `promptIfStockRestored` defaults on for the owner's own explicit Save
  // click, and is turned off for the internal save publish() already does
  // when the draft is dirty — no reason to offer "publish now?" to someone
  // who's already mid-publish.
  async function save(promptIfStockRestored = true): Promise<boolean> {
    // A11y (WCAG 2.4.3): the in-flight/nothing-to-save guard belongs HERE,
    // not on the Save button's `disabled` — disabling the button that
    // currently holds keyboard focus blurs it in every browser (see
    // AccountControls.tsx's save() for the same fix). aria-disabled below
    // doesn't block activation on its own, so this guard now does that job.
    if (saving || !dirty) return false
    if (!menuId) return false
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('menus').update({ draft: { categories: cats }, updated_at: new Date().toISOString() }).eq('id', menuId)
    setSaving(false)
    if (error) { setMsg(T.loadErr); return false }
    setDirty(false); setSavedTick(true); setTimeout(() => setSavedTick(false), 2000)
    // The draft is written straight from the browser under RLS, so the audit
    // trail is reported separately. Fire-and-forget: a failed log line must
    // never make a successful save look like it failed.
    void recordAudit('menu.save', 'שמר/ה טיוטת תפריט', { categories: cats.length })
    if (promptIfStockRestored && stockJustRestored) {
      setStockJustRestored(false)
      setConfirmReq({
        title: T.publishStockTitle,
        body: T.publishStockBody,
        confirmLabel: T.publishStockNow,
        onConfirm: () => { void publish() },
      })
    }
    return true
  }

  async function publish() {
    // A11y (WCAG 2.4.3): same fix as save() above — the guard moves into
    // the handler since the Publish button now uses aria-disabled.
    if (publishing) return
    if (!menuId) return
    setPublishing(true); setMsg(null)
    if (dirty) { const ok = await save(false); if (!ok) { setPublishing(false); return } }
    const { error } = await supabase.rpc('publish_menu', { p_menu_id: menuId })
    setPublishing(false)
    if (error) { setMsg('הפרסום נכשל.'); return }
    setPublishedAt(new Date().toISOString())
    void recordAudit('menu.publish', 'פרסם/ה את התפריט', {
      categories: cats.length,
      items: cats.reduce((n, c) => n + (c.items?.length ?? 0), 0),
    })
    setMsg(T.published)
    setTimeout(() => setMsg(null), 2500)
  }

  /** Report an editor action to the audit trail. Never surfaces an error: the
   *  change already succeeded, and a missing log line is better than telling
   *  the owner their publish failed when it didn't. */
  async function recordAudit(action: string, summary: string, detail: Record<string, unknown>) {
    try {
      await fetch('/api/owner/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, summary, detail }),
      })
    } catch { /* ignored on purpose */ }
  }

  // category ops
  const addCat = () => edit((d) => { d.push({ id: 'cat-' + Date.now().toString(36), icon: '🍽️', title: { he: 'קטגוריה חדשה' }, items: [] }) })
  const moveCat = (ci: number, dir: -1 | 1) => edit((d) => { const j = ci + dir; if (j < 0 || j >= d.length) return;[d[ci], d[j]] = [d[j], d[ci]] })
  // item ops. A new item gets its uid here rather than waiting for the version
  // bar to mint one on its next load: 86 addresses items by uid, and an item
  // that has one from birth never needs the by-position fallback.
  const addItem = (ci: number) => edit((d) => { d[ci].items.push({ uid: mintUid(), he: 'פריט חדש', price: null }) })
  const moveItem = (ci: number, ii: number, dir: -1 | 1) => edit((d) => { const j = ii + dir; const it = d[ci].items; if (j < 0 || j >= it.length) return;[it[ii], it[j]] = [it[j], it[ii]] })
  const restoreItem = (ci: number, ii: number) => { edit((d) => { d[ci].items[ii].available = undefined }); setStockJustRestored(true) }

  // ---- 86 ---------------------------------------------------------------
  // These do NOT go through edit()/save()/publish(). An 86 has to reach
  // customers now — see the note at the top of /api/owner/menu-86 — and the
  // server applies it to the draft and the live menu together.

  const flash = (text: string) => { setMsg(text); setTimeout(() => setMsg(null), 3500) }

  async function post86(body: Record<string, unknown>): Promise<{ ok: boolean; reply: Reply86 }> {
    try {
      const res = await fetch('/api/owner/menu-86', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      return { ok: res.ok, reply: (await res.json().catch(() => ({}))) as Reply86 }
    } catch {
      return { ok: false, reply: {} }
    }
  }

  /** Take something off the menu, or bring it back. Anything unsaved is saved
   *  first: the server works on the SAVED draft and hands it back, and swapping
   *  that in over unsaved edits would silently throw them away. */
  async function change86(body: Record<string, unknown>, doneText: string) {
    if (busy86) return
    setBusy86(true); setMsg(null)
    try {
      if (dirty && !(await save(false))) { setMsg(T.actionFailed); return }
      const { ok, reply } = await post86(body)
      if (!ok) {
        setMsg(reply.error ?? T.actionFailed)
        // The list may have changed even though the menu didn't.
        void loadEntries()
        return
      }
      if (reply.categories) setCats(reply.categories)
      if (reply.entries) setEntries(reply.entries)
      if (reply.publishedAt) setPublishedAt(reply.publishedAt)
      flash(doneText)
    } finally {
      setBusy86(false)
    }
  }

  const archiveItem = (ci: number, ii: number) => {
    const cat = cats[ci]; const item = cat?.items[ii]
    if (!cat || !item) return
    const name = firstText(item)
    setConfirmReq({
      title: T.archiveItemTitle(name), body: T.archiveItemBody, confirmLabel: T.archiveConfirm, tone: 'calm',
      onConfirm: () => { void change86({ action: 'archive', kind: 'item', categoryId: cat.id, uid: item.uid, index: ii }, T.archivedMsg(name)) },
    })
  }

  const archiveCat = (ci: number) => {
    const cat = cats[ci]
    if (!cat) return
    const name = firstText(cat.title)
    setConfirmReq({
      title: T.archiveCatTitle(name), body: T.archiveCatBody(cat.items?.length ?? 0), confirmLabel: T.archiveConfirm, tone: 'calm',
      onConfirm: () => { void change86({ action: 'archive', kind: 'category', categoryId: cat.id }, T.archivedMsg(name)) },
    })
  }

  const bringBack = (e: ArchiveEntry) => { void change86({ action: 'restore', entryId: e.id }, T.restoredMsg(entryName(e))) }

  const purgeEntry = (e: ArchiveEntry) => setConfirmReq({
    title: T.purgeTitle(entryName(e)), body: T.purgeBody, confirmLabel: T.purge,
    onConfirm: () => { void purge(e) },
  })

  // Not change86: this never touches the menu, so there is nothing to save
  // first and no draft to swap in.
  async function purge(e: ArchiveEntry) {
    if (busy86) return
    setBusy86(true); setMsg(null)
    try {
      const { ok, reply } = await post86({ action: 'purge', entryId: e.id })
      if (!ok) { setMsg(reply.error ?? T.actionFailed); void loadEntries(); return }
      if (reply.entries) setEntries(reply.entries)
    } finally {
      setBusy86(false)
    }
  }

  // Out-of-stock overview — a VIRTUAL grouping, not a real move: an item
  // stays in its actual category (deleting it out of "Cocktails" into a
  // real "Out of Stock" category would lose exactly the context a manager
  // needs to file it back correctly, the opposite of "return it to the
  // menu quickly"). Flattened across every category, in menu order, so
  // the list reads the same way the menu itself does.
  const outOfStock = cats.flatMap((cat, ci) =>
    cat.items
      .map((item, ii) => ({ ci, ii, item }))
      .filter(({ item }) => item.available === false)
      .map(({ ci: c, ii: i, item }) => ({ ci: c, ii: i, item, catIcon: cat.icon, catTitle: loc(cat.title, 'he') }))
  )

  if (loading) return <p style={{ color: 'var(--text-dim)', padding: '40px 0', textAlign: 'center' }}>{T.loading}</p>
  if (loadError) return <p style={{ color: '#ff6b6b', padding: '40px 0', textAlign: 'center' }}>{T.loadErr}</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{T.title}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/menu" target="_blank" className="press" style={ghost}>{T.viewMenu}</Link>
        </div>
      </div>

      <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: 0 }}>{T.publishHint}
        {publishedAt && <> <span style={{ color: 'var(--text-faint)' }}>· {new Date(publishedAt).toLocaleString('he-IL')}</span></>}
      </p>

      {/* Which version customers see, and the happy-hour window. Both sit
          above the item list because they decide what the item list means. */}
      <MenuVersionBar />
      <HappyHourCard categories={cats} />
      {/* Whether the menu offers customers a cart at all. Here rather than on
          the dashboard because it is a menu decision, and the menu editor is
          already where every other "what do customers see" switch lives. */}
      <MenuCartCard />

      {/* 2026-08-20: "put all the items marked out of stock in the same
          category for the managers to return it to the menu quickly...
          and to easily see which items are out of stock." Only rendered
          when there's actually something out — an always-present empty
          box would be exactly the kind of ambient clutter this page
          already avoids (see cats.length===0 right below, same posture). */}
      {outOfStock.length > 0 && (
        // `id` is a link target, not decoration: the dashboard's stock signal
        // deep-links to /owner/editor#out-of-stock, and without it the owner
        // lands at the top of a long page and has to hunt for the panel the
        // alert just told them about. scroll-margin keeps the heading clear of
        // the sticky save/publish bar.
        <div id="out-of-stock" style={{ ...outOfStockCard, scrollMarginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.05rem' }}>⚠️</span>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{T.outOfStockTitle}</h3>
            <span style={outOfStockCount}>{outOfStock.length}</span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: '4px 0 10px' }}>{T.outOfStockHint}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {outOfStock.map(({ ci, ii, item, catIcon, catTitle }) => (
              <div key={`${ci}-${ii}`} style={outOfStockRow}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <b style={{ fontSize: '0.9rem', color: 'var(--text)' }}>{item.he}</b>
                  <small style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>{catIcon} {catTitle}</small>
                </span>
                <button onClick={() => restoreItem(ci, ii)} className="press" style={restoreBtn}>{T.backInStock}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The 86 list. Always present (unlike the out-of-stock panel above), and
          on purpose: the whole point of 86 is that nothing is lost, and an owner
          who has never 86'd anything needs to be able to SEE where things will
          go before they trust the button. Collapsed, so it costs one line. */}
      <div id="menu-86" style={{ ...list86Card, scrollMarginTop: 16 }}>
        <button
          type="button" className="press" onClick={() => setList86Open((v) => !v)}
          aria-expanded={list86Open} aria-controls="menu-86-body" style={list86Head}
        >
          <span aria-hidden style={{ fontSize: '1.05rem' }}>🚫</span>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', flex: 1, textAlign: 'start' }}>{T.list86Title}</span>
          <span style={list86Count}>{entries.length}</span>
          <span aria-hidden style={{ color: 'var(--text-dim)' }}>{list86Open ? '▾' : '▸'}</span>
        </button>

        {list86Open && (
          <div id="menu-86-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: '0 0 2px', lineHeight: 1.55 }}>{T.list86Hint}</p>

            {list86Error && (
              <p role="alert" style={{ fontSize: '0.82rem', color: '#ff6b6b', margin: 0 }}>
                {T.list86Load}{' '}
                <button type="button" className="press" onClick={() => void loadEntries()} style={linkBtn}>{T.list86Retry}</button>
              </p>
            )}
            {!list86Error && entries.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-faint)', margin: 0 }}>{T.list86Empty}</p>
            )}

            {entries.map((e) => {
              const name = entryName(e)
              const icon = e.kind === 'item' ? e.from.icon : e.category.icon
              const sub = e.kind === 'item'
                ? `${T.fromCat} ${firstText(e.from.title)}`
                : `${T.kindCategory} · ${e.category.items?.length ?? 0} ${T.itemsWord}`
              const when = new Date(e.archivedAt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
              return (
                <div key={e.id} style={list86Row}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <b style={{ fontSize: '0.92rem', color: 'var(--text)' }}>{icon ? `${icon} ` : ''}{name}</b>
                    <small style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
                      {sub} · {when}{e.archivedBy ? ` · ${e.archivedBy}` : ''}
                    </small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button" onClick={() => bringBack(e)} className="press"
                      aria-disabled={busy86} aria-label={`${T.restore} — ${name}`}
                      style={{ ...restoreBtn, flex: 1, opacity: busy86 ? 0.6 : 1 }}
                    >
                      <span aria-hidden>↩ </span>{T.restore}
                    </button>
                    <button
                      type="button" onClick={() => purgeEntry(e)} className="press"
                      aria-disabled={busy86} aria-label={`${T.purge} — ${name}`}
                      style={{ ...linkBtn, color: '#ff6b6b', opacity: busy86 ? 0.6 : 1 }}
                    >
                      {T.purge}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {cats.length === 0 && <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '10px 0' }}>{T.empty}</p>}

      {cats.map((cat, ci) => {
        const open = openCat === cat.id
        return (
          <div key={cat.id} className="rise" style={{ ...card, animationDelay: `${Math.min(ci, 8) * 35}ms` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input value={cat.icon ?? ''} onChange={(e) => edit((d) => { d[ci].icon = e.target.value })}
                aria-label={T.icon} style={{ ...input, width: 46, textAlign: 'center', fontSize: '1.1rem' }} />
              <input value={cat.title?.he ?? ''} onChange={(e) => edit((d) => { d[ci].title = { ...d[ci].title, he: e.target.value } })}
                aria-label={T.catTitle} placeholder={T.catTitle} style={{ ...input, flex: 1, fontWeight: 700 }} />
              <button onClick={() => moveCat(ci, -1)} className="press" style={iconBtn} aria-label={T.moveUp}>↑</button>
              <button onClick={() => moveCat(ci, 1)} className="press" style={iconBtn} aria-label={T.moveDown}>↓</button>
              <button onClick={() => setOpenCat(open ? null : cat.id)} className="press" style={iconBtn}
                aria-expanded={open} aria-label={open ? T.collapse : T.expand}>{open ? '▾' : '▸'}</button>
            </div>

            {open && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <LangRow label={T.catTitle} value={cat.title} onChange={(v) => edit((d) => { d[ci].title = v })} skipHe />
                <LangRow label={T.catNote} value={cat.note} onChange={(v) => edit((d) => { d[ci].note = v })} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {cat.items.map((it, ii) => (
                    <ItemEditor key={ii} item={it} onChange={(patch) => edit((d) => { Object.assign(d[ci].items[ii], patch) })}
                      onArchive={() => archiveItem(ci, ii)} onUp={() => moveItem(ci, ii, -1)} onDown={() => moveItem(ci, ii, 1)} />
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => addItem(ci)} className="press" style={ghost}>{T.addItem}</button>
                  <button onClick={() => archiveCat(ci)} className="press" aria-disabled={busy86} style={{ ...ghost, ...archiveTone, marginInlineStart: 'auto' }}>{T.archiveCat}</button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <button onClick={addCat} className="press" style={{ ...ghost, alignSelf: 'flex-start' }}>{T.addCat}</button>

      {/* Sticky action bar — portalled to <body> (ModalPortal) so it is
          genuinely pinned to the viewport, not the page. It used to be left
          in the tree on purpose ("travels with its page during a
          transition"), but that reads identically to a bug: a
          transform-bearing ancestor during the page-enter animation makes it
          a `position: fixed` descendant of THAT element instead of the
          viewport, so on a long draft it scrolls away with the content
          instead of staying stuck above it. Portalling removes any ancestor
          transform from the equation, same fix as CartFab.tsx. */}
      <ModalPortal>
        <div className="editor-savebar" style={bar}>
          {/* A11y (WCAG 4.1.3): this line carries both the routine "unsaved
              changes" state and save/publish success/failure text, with no
              aria-live — a screen-reader user got no announcement either way.
              aria-live="polite" fits the mix better than role="alert", which
              is meant for pure errors, not the "יש שינויים" state this also
              shows. */}
          <span aria-live="polite" aria-atomic="true" style={{ fontSize: '0.8rem', color: dirty ? 'var(--neon-soft)' : 'var(--text-faint)', flex: 1 }}>
            {msg ?? (dirty ? T.unsaved : savedTick ? T.saved : '')}
          </span>
          <button onClick={() => save()} aria-disabled={saving || !dirty} aria-busy={saving} className="press" style={{ ...ghost, opacity: (saving || !dirty) ? 0.5 : 1 }}>{saving ? T.saving : T.save}</button>
          <button onClick={publish} aria-disabled={publishing} aria-busy={publishing} className="press" style={{ ...primary, opacity: publishing ? 0.6 : 1 }}>{publishing ? T.publishing : T.publish}</button>
        </div>
      </ModalPortal>

      <ConfirmSheet request={confirmReq} onClose={() => setConfirmReq(null)} />
    </div>
  )
}

function ItemEditor({ item, onChange, onArchive, onUp, onDown }: {
  item: MenuItem; onChange: (patch: Partial<MenuItem>) => void
  onArchive: () => void; onUp: () => void; onDown: () => void
}) {
  const [open, setOpen] = useState(false)
  const badges = item.badges ?? (item.badge ? [item.badge] : [])
  const toggleBadge = (b: string) => {
    const has = badges.includes(b)
    onChange({ badges: has ? badges.filter((x) => x !== b) : [...badges, b], badge: undefined })
  }

  // Option groups — ids minted once and kept stable (ayeka-staff snapshots
  // them into selected_options, same posture item uid/category id already
  // take: never re-derive an id from the label, which the owner can edit at
  // any time). slug() best-effort transliterates for readability but a
  // timestamp suffix is what actually guarantees uniqueness.
  const options = item.options ?? []
  const mintId = (label: string) => {
    // Not a URL or a DOM selector — just a stable snapshot id (029's own
    // comment) — so Hebrew/Arabic pass through untouched; only whitespace
    // needs collapsing. The timestamp suffix is what actually guarantees
    // uniqueness, same posture addCat's own id minting already takes.
    const slug = label.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24)
    return `${slug || 'opt'}-${Date.now().toString(36)}`
  }
  const addOptionGroup = () => onChange({
    options: [...options, { id: mintId('group'), label: { he: '' }, choices: [] }],
  })
  const updateGroup = (gi: number, patch: Partial<MenuOptionGroup>) => {
    const next = options.map((g, i) => (i === gi ? { ...g, ...patch } : g))
    onChange({ options: next })
  }
  const delGroup = (gi: number) => onChange({ options: options.filter((_, i) => i !== gi) })
  const addChoice = (gi: number) => {
    const next = options.map((g, i) => i === gi
      ? { ...g, choices: [...g.choices, { id: mintId('choice'), he: '' }] }
      : g)
    onChange({ options: next })
  }
  const updateChoice = (gi: number, ci: number, he: string) => {
    const next = options.map((g, i) => i === gi
      ? { ...g, choices: g.choices.map((c, j) => (j === ci ? { ...c, he } : c)) }
      : g)
    onChange({ options: next })
  }
  const delChoice = (gi: number, ci: number) => {
    const next = options.map((g, i) => i === gi ? { ...g, choices: g.choices.filter((_, j) => j !== ci) } : g)
    onChange({ options: next })
  }

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, background: 'var(--bg-elev-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input value={item.he ?? ''} onChange={(e) => onChange({ he: e.target.value })} aria-label={T.name} placeholder={T.name} style={{ ...input, flex: 1 }} />
        <input value={priceToInput(item.price)} onChange={(e) => onChange({ price: inputToPrice(e.target.value) })} aria-label={T.price} placeholder="₪" dir="ltr" style={{ ...input, width: 84 }} />
        <button onClick={onUp} className="press" style={iconBtn} aria-label={T.moveUp}>↑</button>
        <button onClick={onDown} className="press" style={iconBtn} aria-label={T.moveDown}>↓</button>
        <button onClick={() => setOpen((v) => !v)} className="press" style={iconBtn}
          aria-expanded={open} aria-label={open ? T.collapse : T.expand}>{open ? '▾' : '▸'}</button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          <LangRow label={T.name} value={item as Localized} onChange={(v) => onChange({ he: v.he, en: v.en, ar: v.ar })} skipHe />
          <LangRow label={T.note} value={item.note} onChange={(v) => onChange({ note: v })} />
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" role="switch" aria-checked={badges.includes('mustTry')} className="press" style={chkBtn} onClick={() => toggleBadge('mustTry')}>
              {T.mustTry} <Switch on={badges.includes('mustTry')} small />
            </button>
            <button type="button" role="switch" aria-checked={badges.includes('new')} className="press" style={chkBtn} onClick={() => toggleBadge('new')}>
              {T.badgeNew} <Switch on={badges.includes('new')} small />
            </button>
            <button
              type="button" role="switch" aria-checked={item.available === false} className="press" style={chkBtn}
              onClick={() => onChange({ available: item.available === false ? undefined : false })}
            >
              {T.sold} <Switch on={item.available === false} small />
            </button>
            <button onClick={onArchive} className="press" style={{ ...ghost, ...archiveTone, marginInlineStart: 'auto', padding: '5px 10px' }}>{T.archive}</button>
          </div>
          {/* "Sold out" and "86" look alike to someone who doesn't live in a
              kitchen — one line, right where the two controls sit. */}
          <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: 0, lineHeight: 1.5 }}>{T.soldVs86}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{T.options}</span>
            {options.map((g, gi) => (
              <div key={g.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={g.label.he ?? ''} onChange={(e) => updateGroup(gi, { label: { ...g.label, he: e.target.value } })}
                    placeholder={T.optionGroupName} style={{ ...input, flex: 1, fontWeight: 600 }} />
                  <button onClick={() => delGroup(gi)} className="press" style={iconBtn} aria-label={T.del}>🗑</button>
                </div>
                {g.choices.map((c, cix) => (
                  <div key={c.id} style={{ display: 'flex', gap: 6, paddingInlineStart: 14 }}>
                    <input value={c.he ?? ''} onChange={(e) => updateChoice(gi, cix, e.target.value)}
                      placeholder={T.optionChoiceName} style={{ ...input, flex: 1 }} />
                    <button onClick={() => delChoice(gi, cix)} className="press" style={iconBtn} aria-label={T.del}>✕</button>
                  </div>
                ))}
                <button onClick={() => addChoice(gi)} className="press" style={{ ...ghost, alignSelf: 'flex-start', fontSize: '0.78rem', padding: '4px 10px' }}>{T.addChoice}</button>
              </div>
            ))}
            <button onClick={addOptionGroup} className="press" style={{ ...ghost, alignSelf: 'flex-start' }}>{T.addOptionGroup}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function LangRow({ label, value, onChange, skipHe }: {
  label: string; value?: Localized; onChange: (v: Localized) => void; skipHe?: boolean
}) {
  const v = value ?? {}
  const set = (lang: keyof Localized, s: string) => onChange({ ...v, [lang]: s || undefined })
  // A11y (WCAG 1.3.1 / 3.3.2): the group's own label was a bare <span>, not
  // linked to any of the three inputs — each one's only textual cue was a
  // language-name placeholder ("עברית"/"English"/"العربية"), which
  // disappears the moment there's a value and never said WHAT field this
  // is to begin with. Each input's aria-label now combines both — found
  // 2026-09-04.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{label}</span>
      {!skipHe && <input value={v.he ?? ''} onChange={(e) => set('he', e.target.value)} aria-label={`${label} — ${T.he}`} placeholder={T.he} style={input} />}
      <input value={v.en ?? ''} onChange={(e) => set('en', e.target.value)} aria-label={`${label} — ${T.en}`} placeholder={T.en} dir="ltr" style={input} />
      <input value={v.ar ?? ''} onChange={(e) => set('ar', e.target.value)} aria-label={`${label} — ${T.ar}`} placeholder={T.ar} dir="rtl" style={input} />
    </div>
  )
}

const card: CSSProperties = { background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: 12 }
// Warm amber, not the delete-action red (#ff6b6b) already used elsewhere in
// this file — "out of stock" is a state to fix, not a destructive action to
// fear, so it gets its own distinct tone rather than borrowing danger's.
const outOfStockCard: CSSProperties = { background: 'rgba(255,178,64,0.06)', border: '1px solid rgba(255,178,64,0.28)', borderRadius: 14, padding: 12 }
const outOfStockCount: CSSProperties = { marginInlineStart: 'auto', borderRadius: 999, padding: '2px 9px', fontSize: '0.76rem', fontWeight: 700, color: '#ffb240', background: 'rgba(255,178,64,0.14)', border: '1px solid rgba(255,178,64,0.3)' }
// 86 shares the out-of-stock amber: like a sold-out item it is a state to
// manage, not a destructive act to fear (nothing is deleted), so it must not
// borrow the delete-red the rest of this file reserves for the irreversible.
const archiveTone: CSSProperties = { color: '#ffb240', borderColor: 'rgba(255,178,64,0.35)' }
const list86Card: CSSProperties = { background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: 12 }
const list86Head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'inherit' }
const list86Count: CSSProperties = { borderRadius: 999, padding: '2px 9px', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-dim)', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line-strong)' }
const list86Row: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-elev-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 10px' }
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: '7px 4px', font: 'inherit', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer', textDecoration: 'underline' }
const outOfStockRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-elev-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' }
const restoreBtn: CSSProperties = { flex: '0 0 auto', padding: '7px 11px', borderRadius: 9, border: '1px solid rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.1)', color: '#4ade80', fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }
const input: CSSProperties = { padding: '9px 11px', borderRadius: 9, border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)', color: 'var(--text)', fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none', width: '100%' }
const iconBtn: CSSProperties = { width: 32, height: 32, flex: '0 0 auto', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.9rem', fontFamily: 'inherit' }
const ghost: CSSProperties = { padding: '8px 13px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }
const primary: CSSProperties = { padding: '8px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)', color: 'var(--bg)', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
const chk: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-dim)', cursor: 'pointer' }
// Same look as `chk`, as a <button role="switch"> instead of a <label>+checkbox
// — the iOS-style Switch replaces every native checkbox in the owner surface.
const chkBtn: CSSProperties = { ...chk, background: 'none', border: 'none', padding: 0, font: 'inherit' }
const bar: CSSProperties = { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px calc(env(safe-area-inset-bottom) + 12px)', background: 'linear-gradient(to top, var(--bg) 60%, transparent)', maxWidth: 560, margin: '0 auto' }
