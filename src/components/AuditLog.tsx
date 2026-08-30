'use client'

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'

// Who changed the menu, what they changed, and when. Read-only by design —
// the log is append-only in the database and there is no edit affordance here.
//
// 2026-08-30: "the updates need to be collapsible just like in the OMS with
// large orders sent to the kitchen... a drop down will show... what was
// edited, changed etc, fit every event to their use case." Mirrors
// ayeka-staff's EventFeed rule exactly: a row is collapsible ONLY when its
// `detail` actually carries something beyond the one-line summary already
// shown (a lone ready-mark stays a plain line there; a bare `{categories: 4}`
// count stays a plain line here) — expandDetailFor() below returns null for
// exactly those, and the row renders with no chevron at all rather than a
// dropdown that opens onto nothing. Every action gets its OWN rendering,
// shaped to what that action's detail actually carries — a save/publish's
// counts read differently from Happy Hour's rule list or a temp variant's
// expiry, which is the "fit every event to their use case" part.

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
  fieldEnabled: 'מצב',
  on: 'פעיל',
  off: 'כבוי',
  fieldWindow: 'שעות',
  fieldDiscount: 'הנחה',
  fieldItems: 'פריטים',
  fieldCategories: 'קטגוריות',
  fieldHidden: 'פריטים מוסתרים בגרסה זו',
  fieldRenamedFrom: 'שם קודם',
  fieldTempUntil: 'זמנית עד',
  fieldExpireAction: 'בתום הזמן',
  expireBack: 'חוזר לתפריט הראשי',
  expireArchive: 'עובר לארכיון',
}

const ACTION_META: Record<string, { label: string; emoji: string; color: string }> = {
  'menu.save': { label: 'שמירת טיוטה', emoji: '📝', color: '#a8a5b0' },
  'menu.publish': { label: 'פרסום תפריט', emoji: '🚀', color: '#ff8a5c' },
  'variant.create': { label: 'גרסה חדשה', emoji: '✨', color: '#60a5fa' },
  'variant.update': { label: 'עדכון גרסה', emoji: '✏️', color: '#60a5fa' },
  'variant.delete': { label: 'מחיקת גרסה', emoji: '🗑️', color: '#ff6b6b' },
  'variant.activate': { label: 'החלפת תפריט מוצג', emoji: '🔀', color: '#2dd4bf' },
  'variant.default': { label: 'הגדרת תפריט ראשי', emoji: '⭐', color: '#fbbf24' },
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.78rem' }}>
      <span style={{ color: 'var(--text-faint)' }}>{label}</span>
      <span style={{ color: 'var(--text-dim)', textAlign: 'end' }}>{children}</span>
    </div>
  )
}

function Chips({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end' }}>
      {items.map((c, i) => (
        <span key={i} style={{
          fontSize: '0.72rem', color: 'var(--text-dim)', background: 'var(--bg-elev-2)',
          border: '1px solid var(--line)', borderRadius: 999, padding: '2px 8px',
        }}>{c}</span>
      ))}
    </div>
  )
}

/** Everything worth showing beyond the one-liner detailLine() already put
 *  inline — or null when there genuinely isn't more (a bare `{categories:
 *  N}` count on a save/publish, a delete that only ever recorded a name).
 *  Returning null is what keeps THOSE rows plain and un-chevroned, exactly
 *  the OMS EventFeed rule for a non-collapsible line. */
function expandDetailFor(e: Entry): ReactNode | null {
  const d = e.detail ?? {}

  if (e.action === 'happy_hour.update') {
    if (d.enabled !== true) return null // "כיבה/תה" already says everything there is to say
    const rows: ReactNode[] = [
      <Field key="enabled" label={T.fieldEnabled}>{T.on}</Field>,
    ]
    if (typeof d.start === 'string' && typeof d.end === 'string') {
      rows.push(<Field key="window" label={T.fieldWindow}><span dir="ltr">{d.start}–{d.end}</span></Field>)
    }
    if (Array.isArray(d.percents) && d.percents.length) {
      rows.push(<Field key="discount" label={T.fieldDiscount}>{(d.percents as number[]).join('/')}%</Field>)
    }
    if (typeof d.itemCount === 'number') {
      rows.push(<Field key="items" label={T.fieldItems}>{d.itemCount}</Field>)
    }
    if (Array.isArray(d.categories) && d.categories.length) {
      rows.push(
        <div key="cats" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{T.fieldCategories}</span>
          <Chips items={d.categories as string[]} />
        </div>
      )
    }
    return rows
  }

  if (e.action === 'variant.create' || e.action === 'variant.update') {
    const rows: ReactNode[] = []
    if (typeof d.renamedFrom === 'string') {
      rows.push(<Field key="renamed" label={T.fieldRenamedFrom}>{d.renamedFrom}</Field>)
    }
    if (typeof d.hiddenItems === 'number' && d.hiddenItems > 0) {
      rows.push(<Field key="hidden" label={T.fieldHidden}>{d.hiddenItems}</Field>)
    }
    if (typeof d.until === 'string') {
      rows.push(<Field key="until" label={T.fieldTempUntil}>{new Date(d.until).toLocaleString('he-IL')}</Field>)
      rows.push(
        <Field key="expire" label={T.fieldExpireAction}>
          {d.expireAction === 'archive' ? T.expireArchive : T.expireBack}
        </Field>
      )
    }
    return rows.length ? rows : null
  }

  if (e.action === 'variant.activate' && typeof d.until === 'string') {
    return [
      <Field key="until" label={T.fieldTempUntil}>{new Date(d.until).toLocaleString('he-IL')}</Field>,
      <Field key="expire" label={T.fieldExpireAction}>
        {d.expireAction === 'archive' ? T.expireArchive : T.expireBack}
      </Field>,
    ]
  }

  return null
}

export default function AuditLog() {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [limit, setLimit] = useState(20)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggle = (id: number) =>
    setOpen((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n })

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
              const expanded = expandDetailFor(e)
              const isOpen = open.has(e.id)

              const head = (
                <>
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

                  {expanded && (
                    <span aria-hidden style={{
                      flex: '0 0 auto', alignSelf: 'center', color: 'var(--text-faint)', fontSize: '0.8rem',
                      transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s var(--ease)',
                    }}>▾</span>
                  )}
                </>
              )

              const rowStyle: CSSProperties = {
                background: 'var(--bg-elev)', border: '1px solid var(--line)',
                borderRadius: 14, animationDelay: `${Math.min(i, 8) * 35}ms`,
              }

              return (
                <div key={e.id} className="rise" style={rowStyle}>
                  {expanded ? (
                    <button
                      type="button" className="press" onClick={() => toggle(e.id)} aria-expanded={isOpen}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'flex-start', gap: 11,
                        padding: '12px 13px', background: 'none', border: 'none', font: 'inherit',
                        color: 'inherit', textAlign: 'start', cursor: 'pointer',
                      }}
                    >
                      {head}
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 13px' }}>
                      {head}
                    </div>
                  )}
                  {expanded && isOpen && (
                    <div className="rise" style={{
                      display: 'flex', flexDirection: 'column', gap: 6,
                      margin: '0 13px 12px', paddingTop: 10, borderTop: '1px solid var(--line)',
                    }}>
                      {expanded}
                    </div>
                  )}
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
