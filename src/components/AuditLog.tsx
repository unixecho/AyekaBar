'use client'

import { useCallback, useEffect, useState } from 'react'

// Who changed the menu, what they changed, and when. Read-only by design —
// the log is append-only in the database and there is no edit affordance here.

interface Entry {
  id: number
  actor_name: string | null
  actor_email: string | null
  action: string
  summary: string | null
  detail: Record<string, unknown>
  created_at: string
}

const T = {
  title: 'יומן שינויים',
  subtitle: 'מי שינה מה בתפריט, בגרסאות וב-Happy Hour.',
  empty: 'אין עדיין שינויים מתועדים.',
  pending: 'היומן יתחיל להתמלא אחרי הרצת מיגרציה 014.',
  loadErr: 'טעינת היומן נכשלה.',
  unknown: 'לא ידוע',
  more: 'הצג/י עוד',
}

const ACTION_META: Record<string, { label: string; emoji: string; color: string }> = {
  'menu.save': { label: 'שמירת טיוטה', emoji: '📝', color: '#a8a5b0' },
  'menu.publish': { label: 'פרסום תפריט', emoji: '🚀', color: '#ff8a5c' },
  'variant.create': { label: 'גרסה חדשה', emoji: '✨', color: '#60a5fa' },
  'variant.update': { label: 'עדכון גרסה', emoji: '✏️', color: '#60a5fa' },
  'variant.delete': { label: 'מחיקת גרסה', emoji: '🗑️', color: '#ff6b6b' },
  'variant.activate': { label: 'החלפת תפריט מוצג', emoji: '🔀', color: '#2dd4bf' },
  'happy_hour.update': { label: 'Happy Hour', emoji: '🍹', color: '#f472b6' },
}

const fallbackMeta = { label: 'שינוי', emoji: '•', color: '#a8a5b0' }

function when(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דק׳`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}

/** Turn the structured detail into a short readable line. Kept here rather
 *  than baked into `summary` so old rows still render if the wording changes. */
function detailLine(e: Entry): string {
  const d = e.detail ?? {}
  const bits: string[] = []

  if (typeof d.hiddenItems === 'number' && d.hiddenItems > 0) bits.push(`${d.hiddenItems} פריטים מוסתרים`)
  if (typeof d.items === 'number') bits.push(`${d.items} פריטים`)
  else if (typeof d.categories === 'number') bits.push(`${d.categories} קטגוריות`)

  if (e.action === 'happy_hour.update') {
    if (typeof d.start === 'string' && typeof d.end === 'string') bits.push(`${d.start}–${d.end}`)
    if (Array.isArray(d.percents) && d.percents.length) bits.push(`${d.percents.join('/')}% הנחה`)
    if (typeof d.itemCount === 'number') bits.push(`${d.itemCount} פריטים`)
    if (Array.isArray(d.categories) && d.categories.length) bits.push((d.categories as string[]).join(', '))
  }

  return bits.join(' · ')
}

export default function AuditLog() {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [limit, setLimit] = useState(20)

  const load = useCallback(async (n: number) => {
    try {
      const res = await fetch(`/api/owner/audit?limit=${n}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setEntries(j.entries)
      setPending(!!j.pending)
      setErr(null)
    } catch {
      setEntries([])
      setErr(T.loadErr)
    }
  }, [])

  useEffect(() => { load(limit) }, [load, limit])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{T.title}</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.5 }}>{T.subtitle}</p>
      </div>

      {entries === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="sk" style={{ height: 62, borderRadius: 14 }} />
          ))}
        </div>
      ) : err ? (
        <p style={{ color: '#ff6b6b', fontSize: '0.85rem' }}>{err}</p>
      ) : entries.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>
          {pending ? T.pending : T.empty}
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map((e, i) => {
              const meta = ACTION_META[e.action] ?? fallbackMeta
              const extra = detailLine(e)
              return (
                <div key={e.id} className="rise" style={{
                  background: 'var(--bg-elev)', border: '1px solid var(--line)',
                  borderRadius: 14, padding: '12px 13px',
                  display: 'flex', alignItems: 'flex-start', gap: 11,
                  animationDelay: `${Math.min(i, 8) * 35}ms`,
                }}>
                  <span aria-hidden style={{
                    flex: '0 0 auto', width: 34, height: 34, borderRadius: 10,
                    display: 'grid', placeItems: 'center', fontSize: '1rem',
                    background: `${meta.color}1c`, border: `1px solid ${meta.color}44`,
                  }}>{meta.emoji}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)' }}>
                        {e.actor_name || e.actor_email?.split('@')[0] || T.unknown}
                      </span>
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 700, color: meta.color,
                        border: `1px solid ${meta.color}44`, background: `${meta.color}14`,
                        borderRadius: 999, padding: '1px 8px',
                      }}>{meta.label}</span>
                      <span style={{ marginInlineStart: 'auto', fontSize: '0.72rem', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                        {when(e.created_at)}
                      </span>
                    </div>

                    {e.summary && (
                      <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        {e.summary}
                      </p>
                    )}
                    {extra && (
                      <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                        {extra}
                      </p>
                    )}
                    <p style={{ margin: '3px 0 0', fontSize: '0.66rem', color: 'var(--text-faint)' }}>
                      {new Date(e.created_at).toLocaleString('he-IL')}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {entries.length >= limit && (
            <button type="button" onClick={() => setLimit((n) => n + 20)} className="press"
              style={{
                padding: '11px 0', borderRadius: 12, border: '1px solid var(--line-strong)',
                background: 'transparent', color: 'var(--text-dim)', fontSize: '0.86rem',
                fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}>
              {T.more}
            </button>
          )}
        </>
      )}
    </div>
  )
}
