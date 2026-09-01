'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MENU_SLUG, loc, type MenuCategory, type MenuItem, type MenuOptionGroup, type Localized } from '@/lib/menu/types'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import MenuVersionBar from '@/components/MenuVersionBar'
import HappyHourCard from '@/components/HappyHourCard'
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
  icon: 'אייקון', he: 'עברית', en: 'English', ar: 'العربية',
  name: 'שם', note: 'תיאור', price: 'מחיר (מספר, טווח כמו 30/34, או ריק)',
  catTitle: 'שם הקטגוריה', catNote: 'הערת קטגוריה',
  mustTry: 'חובה לטעום', badgeNew: 'חדש', sold: 'אזל',
  // Out-of-stock overview (2026-08-20) — "put all the items marked out of
  // stock in the same category for the managers to return it to the menu
  // quickly... and to easily see which items are out of stock."
  outOfStockTitle: 'אזל מהמלאי',
  outOfStockHint: 'כל הפריטים שסומנו כ"אזל", מכל הקטגוריות, כדי שיהיה קל למצוא ולהחזיר למלאי בלחיצה אחת.',
  backInStock: '↩ החזרה למלאי',
  viewMenu: 'צפייה בתפריט', dash: '← ניהול',
  confirmDelCat: 'למחוק את הקטגוריה?',
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
  const delCat = (ci: number) => setConfirmReq({
    title: T.confirmDelCat,
    body: `"${loc(cats[ci]?.title, 'he') || ''}" וכל ${cats[ci]?.items?.length ?? 0} הפריטים שבה יימחקו מהטיוטה. השינוי ייכנס לתוקף רק אחרי שמירה.`,
    confirmLabel: T.del,
    onConfirm: () => edit((d) => { d.splice(ci, 1) }),
  })
  const moveCat = (ci: number, dir: -1 | 1) => edit((d) => { const j = ci + dir; if (j < 0 || j >= d.length) return;[d[ci], d[j]] = [d[j], d[ci]] })
  // item ops
  const addItem = (ci: number) => edit((d) => { d[ci].items.push({ he: 'פריט חדש', price: null }) })
  const delItem = (ci: number, ii: number) => edit((d) => { d[ci].items.splice(ii, 1) })
  const moveItem = (ci: number, ii: number, dir: -1 | 1) => edit((d) => { const j = ii + dir; const it = d[ci].items; if (j < 0 || j >= it.length) return;[it[ii], it[j]] = [it[j], it[ii]] })
  const restoreItem = (ci: number, ii: number) => { edit((d) => { d[ci].items[ii].available = undefined }); setStockJustRestored(true) }

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

      {cats.length === 0 && <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '10px 0' }}>{T.empty}</p>}

      {cats.map((cat, ci) => {
        const open = openCat === cat.id
        return (
          <div key={cat.id} className="rise" style={{ ...card, animationDelay: `${Math.min(ci, 8) * 35}ms` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input value={cat.icon ?? ''} onChange={(e) => edit((d) => { d[ci].icon = e.target.value })}
                aria-label={T.icon} style={{ ...input, width: 46, textAlign: 'center', fontSize: '1.1rem' }} />
              <input value={cat.title?.he ?? ''} onChange={(e) => edit((d) => { d[ci].title = { ...d[ci].title, he: e.target.value } })}
                placeholder={T.catTitle} style={{ ...input, flex: 1, fontWeight: 700 }} />
              <button onClick={() => moveCat(ci, -1)} className="press" style={iconBtn} aria-label="up">↑</button>
              <button onClick={() => moveCat(ci, 1)} className="press" style={iconBtn} aria-label="down">↓</button>
              <button onClick={() => setOpenCat(open ? null : cat.id)} className="press" style={iconBtn}>{open ? '▾' : '▸'}</button>
            </div>

            {open && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <LangRow label={T.catTitle} value={cat.title} onChange={(v) => edit((d) => { d[ci].title = v })} skipHe />
                <LangRow label={T.catNote} value={cat.note} onChange={(v) => edit((d) => { d[ci].note = v })} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {cat.items.map((it, ii) => (
                    <ItemEditor key={ii} item={it} onChange={(patch) => edit((d) => { Object.assign(d[ci].items[ii], patch) })}
                      onDelete={() => delItem(ci, ii)} onUp={() => moveItem(ci, ii, -1)} onDown={() => moveItem(ci, ii, 1)} />
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => addItem(ci)} className="press" style={ghost}>{T.addItem}</button>
                  <button onClick={() => delCat(ci)} className="press" style={{ ...ghost, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)', marginInlineStart: 'auto' }}>{T.del} {T.icon === '' ? '' : ''}🗑</button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <button onClick={addCat} className="press" style={{ ...ghost, alignSelf: 'flex-start' }}>{T.addCat}</button>

      {/* Sticky action bar */}
      <div style={bar}>
        <span style={{ fontSize: '0.8rem', color: dirty ? 'var(--neon-soft)' : 'var(--text-faint)', flex: 1 }}>
          {msg ?? (dirty ? T.unsaved : savedTick ? T.saved : '')}
        </span>
        <button onClick={() => save()} disabled={saving || !dirty} className="press" style={{ ...ghost, opacity: (saving || !dirty) ? 0.5 : 1 }}>{saving ? T.saving : T.save}</button>
        <button onClick={publish} disabled={publishing} className="press" style={{ ...primary, opacity: publishing ? 0.6 : 1 }}>{publishing ? T.publishing : T.publish}</button>
      </div>

      <ConfirmSheet request={confirmReq} onClose={() => setConfirmReq(null)} />
    </div>
  )
}

function ItemEditor({ item, onChange, onDelete, onUp, onDown }: {
  item: MenuItem; onChange: (patch: Partial<MenuItem>) => void
  onDelete: () => void; onUp: () => void; onDown: () => void
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
        <input value={item.he ?? ''} onChange={(e) => onChange({ he: e.target.value })} placeholder={T.name} style={{ ...input, flex: 1 }} />
        <input value={priceToInput(item.price)} onChange={(e) => onChange({ price: inputToPrice(e.target.value) })} placeholder="₪" dir="ltr" style={{ ...input, width: 84 }} />
        <button onClick={onUp} className="press" style={iconBtn} aria-label="up">↑</button>
        <button onClick={onDown} className="press" style={iconBtn} aria-label="down">↓</button>
        <button onClick={() => setOpen((v) => !v)} className="press" style={iconBtn}>{open ? '▾' : '▸'}</button>
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
            <button onClick={onDelete} className="press" style={{ ...ghost, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)', marginInlineStart: 'auto', padding: '5px 10px' }}>{T.del}</button>
          </div>

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{label}</span>
      {!skipHe && <input value={v.he ?? ''} onChange={(e) => set('he', e.target.value)} placeholder={T.he} style={input} />}
      <input value={v.en ?? ''} onChange={(e) => set('en', e.target.value)} placeholder={T.en} dir="ltr" style={input} />
      <input value={v.ar ?? ''} onChange={(e) => set('ar', e.target.value)} placeholder={T.ar} dir="rtl" style={input} />
    </div>
  )
}

const card: CSSProperties = { background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: 12 }
// Warm amber, not the delete-action red (#ff6b6b) already used elsewhere in
// this file — "out of stock" is a state to fix, not a destructive action to
// fear, so it gets its own distinct tone rather than borrowing danger's.
const outOfStockCard: CSSProperties = { background: 'rgba(255,178,64,0.06)', border: '1px solid rgba(255,178,64,0.28)', borderRadius: 14, padding: 12 }
const outOfStockCount: CSSProperties = { marginInlineStart: 'auto', borderRadius: 999, padding: '2px 9px', fontSize: '0.76rem', fontWeight: 700, color: '#ffb240', background: 'rgba(255,178,64,0.14)', border: '1px solid rgba(255,178,64,0.3)' }
const outOfStockRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-elev-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' }
const restoreBtn: CSSProperties = { flex: '0 0 auto', padding: '7px 11px', borderRadius: 9, border: '1px solid rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.1)', color: '#4ade80', fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }
const input: CSSProperties = { padding: '9px 11px', borderRadius: 9, border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)', color: 'var(--text)', fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none', width: '100%' }
const iconBtn: CSSProperties = { width: 32, height: 32, flex: '0 0 auto', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.9rem', fontFamily: 'inherit' }
const ghost: CSSProperties = { padding: '8px 13px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }
const primary: CSSProperties = { padding: '8px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)', color: '#fff', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
const chk: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-dim)', cursor: 'pointer' }
// Same look as `chk`, as a <button role="switch"> instead of a <label>+checkbox
// — the iOS-style Switch replaces every native checkbox in the owner surface.
const chkBtn: CSSProperties = { ...chk, background: 'none', border: 'none', padding: 0, font: 'inherit' }
const bar: CSSProperties = { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px calc(env(safe-area-inset-bottom) + 12px)', background: 'linear-gradient(to top, var(--bg) 60%, transparent)', maxWidth: 560, margin: '0 auto' }
