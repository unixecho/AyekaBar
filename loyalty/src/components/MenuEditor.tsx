'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MENU_SLUG, type MenuCategory, type MenuItem, type Localized } from '@/lib/menu/types'

const T = {
  title: 'עורך התפריט',
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
  viewMenu: 'צפייה בתפריט', dash: '← ניהול',
  confirmDelCat: 'למחוק את הקטגוריה על כל הפריטים שלה?',
  empty: 'אין עדיין קטגוריות. הוסף/י אחת למטה.',
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

  async function save(): Promise<boolean> {
    if (!menuId) return false
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('menus').update({ draft: { categories: cats }, updated_at: new Date().toISOString() }).eq('id', menuId)
    setSaving(false)
    if (error) { setMsg(T.loadErr); return false }
    setDirty(false); setSavedTick(true); setTimeout(() => setSavedTick(false), 2000)
    return true
  }

  async function publish() {
    if (!menuId) return
    setPublishing(true); setMsg(null)
    if (dirty) { const ok = await save(); if (!ok) { setPublishing(false); return } }
    const { error } = await supabase.rpc('publish_menu', { p_menu_id: menuId })
    setPublishing(false)
    if (error) { setMsg('הפרסום נכשל.'); return }
    setPublishedAt(new Date().toISOString())
    setMsg(T.published)
    setTimeout(() => setMsg(null), 2500)
  }

  // category ops
  const addCat = () => edit((d) => { d.push({ id: 'cat-' + Date.now().toString(36), icon: '🍽️', title: { he: 'קטגוריה חדשה' }, items: [] }) })
  const delCat = (ci: number) => { if (confirm(T.confirmDelCat)) edit((d) => { d.splice(ci, 1) }) }
  const moveCat = (ci: number, dir: -1 | 1) => edit((d) => { const j = ci + dir; if (j < 0 || j >= d.length) return;[d[ci], d[j]] = [d[j], d[ci]] })
  // item ops
  const addItem = (ci: number) => edit((d) => { d[ci].items.push({ he: 'פריט חדש', price: null }) })
  const delItem = (ci: number, ii: number) => edit((d) => { d[ci].items.splice(ii, 1) })
  const moveItem = (ci: number, ii: number, dir: -1 | 1) => edit((d) => { const j = ii + dir; const it = d[ci].items; if (j < 0 || j >= it.length) return;[it[ii], it[j]] = [it[j], it[ii]] })

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

      {cats.length === 0 && <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '10px 0' }}>{T.empty}</p>}

      {cats.map((cat, ci) => {
        const open = openCat === cat.id
        return (
          <div key={cat.id} style={card}>
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
        <button onClick={save} disabled={saving || !dirty} className="press" style={{ ...ghost, opacity: (saving || !dirty) ? 0.5 : 1 }}>{saving ? T.saving : T.save}</button>
        <button onClick={publish} disabled={publishing} className="press" style={{ ...primary, opacity: publishing ? 0.6 : 1 }}>{publishing ? T.publishing : T.publish}</button>
      </div>
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
            <label style={chk}><input type="checkbox" checked={badges.includes('mustTry')} onChange={() => toggleBadge('mustTry')} /> {T.mustTry}</label>
            <label style={chk}><input type="checkbox" checked={badges.includes('new')} onChange={() => toggleBadge('new')} /> {T.badgeNew}</label>
            <label style={chk}><input type="checkbox" checked={item.available === false} onChange={(e) => onChange({ available: e.target.checked ? false : undefined })} /> {T.sold}</label>
            <button onClick={onDelete} className="press" style={{ ...ghost, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)', marginInlineStart: 'auto', padding: '5px 10px' }}>{T.del}</button>
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
const input: CSSProperties = { padding: '9px 11px', borderRadius: 9, border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)', color: 'var(--text)', fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none', width: '100%' }
const iconBtn: CSSProperties = { width: 32, height: 32, flex: '0 0 auto', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.9rem', fontFamily: 'inherit' }
const ghost: CSSProperties = { padding: '8px 13px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }
const primary: CSSProperties = { padding: '8px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)', color: '#fff', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
const chk: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-dim)', cursor: 'pointer' }
const bar: CSSProperties = { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px calc(env(safe-area-inset-bottom) + 12px)', background: 'linear-gradient(to top, var(--bg) 60%, transparent)', maxWidth: 560, margin: '0 auto' }
